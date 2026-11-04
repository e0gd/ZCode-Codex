import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { NativeSubagentItem, NativeSubagentUpdate } from "@zcode/contracts";
import { nativeCodexChildSessionId } from "@zcode/contracts";

type RecordValue = Record<string, unknown>;
export interface NativeTranscriptRecord { turnId?: string; item: RecordValue }
export const record = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const recordError = (value: unknown): { code: number } | undefined => {
  const error = record(value);
  return Number.isInteger(error.code) ? { code: error.code as number } : undefined;
};
export const identifier = (value: unknown): string => {
  if (typeof value !== "string" || !value || value.length > 512) {
    throw new Error("Codex returned an invalid identifier.");
  }
  return value;
};
export type RpcMessage = { method: string; params: RecordValue; id?: string | number };

export interface NativeChildRelation {
  agentId: string;
  parentAgentId?: string;
  parentToolCallId: string;
  prompt: string;
  agentType: string;
}

const childTaskEnvelopePrefix = "c2a-msg-v1:";
const maximumEncodedChildTaskLength = 1024 * 1024;

function childTaskDisplay(text: string): string {
  // 官方子任务带传输封装；仅在展示边界剥一层，不能改执行参数或反复解码关系状态。
  if (!text.startsWith(childTaskEnvelopePrefix) || text.length > childTaskEnvelopePrefix.length + maximumEncodedChildTaskLength) return text;
  const encoded = text.slice(childTaskEnvelopePrefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || (encoded.includes("=") && encoded.length % 4 !== 0)) return text;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) return text;
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return text; }
}

function childTaskCard(item: RecordValue): RecordValue {
  return typeof item.prompt === "string" ? { ...item, prompt: childTaskDisplay(item.prompt) } : item;
}

function childTaskDescription(item: RecordValue): string {
  return typeof item.prompt === "string" ? item.prompt : typeof item.agentPath === "string" ? item.agentPath : "Codex";
}

export function nativeToolName(item: RecordValue): string {
  return item.type === "commandExecution" ? "Bash" : item.type === "fileChange" ? "Edit"
    : (item.type === "collabAgentToolCall" && item.tool === "spawnAgent") || (item.type === "subAgentActivity" && item.kind === "started") ? "Agent"
      : typeof item.tool === "string" ? item.tool : String(item.type);
}

export function nativeToolInput(item: RecordValue): RecordValue {
  if (nativeToolName(item) !== "Agent") return item;
  const display = childTaskCard(item);
  return { ...display, executionBackend: "codex", description: childTaskDescription(display).slice(0, 160), subagent_type: "Codex", run_in_background: true };
}

export function nativeToolOutput(item: RecordValue, sessionId: string): string {
  const activityLaunch = item.type === "subAgentActivity" && item.kind === "started";
  const agentId = activityLaunch ? item.agentThreadId
    : item.type === "collabAgentToolCall" && item.tool === "spawnAgent" && item.status === "completed" && Array.isArray(item.receiverThreadIds)
      ? item.receiverThreadIds[0] : undefined;
  // launch ACK 必须持久化稳定 child 身份；只靠内存 Spawned 事件，重启后嵌套目录也会丢失。
  if (typeof agentId === "string") {
    const display = childTaskCard(item);
    return JSON.stringify({ ...display, status: "async_launched", agentId,
      childSessionId: nativeCodexChildSessionId(sessionId, agentId), agentType: "Codex", description: childTaskDescription(display) });
  }
  return typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : JSON.stringify(item.result ?? item.changes ?? item.contentItems ?? item);
}

/** Transport observations only. Core persists sessions and publishes product events. */
export class NativeChildObserver {
  readonly children = new Map<string, NativeChildRelation & {
    turnId?: string; inputText?: string; status: NativeSubagentUpdate["status"]; items: Map<string, NativeSubagentItem>; retiredTurns: Set<string>;
  }>();

  constructor(private readonly emit: (event: NativeSubagentUpdate) => Promise<void>, private readonly rootSessionId: string) {}

  restore(relations: NativeChildRelation[]): void {
    for (const relation of relations) this.children.set(relation.agentId, { ...relation, status: "success", items: new Map(), retiredTurns: new Set() });
  }

  relations(): NativeChildRelation[] {
    return [...this.children.values()].map(({ agentId, parentAgentId, parentToolCallId, prompt, agentType }) =>
      ({ agentId, parentAgentId, parentToolCallId, prompt, agentType }));
  }

  get running(): boolean { return [...this.children.values()].some(child => child.status === "running"); }

  private async publish(agentId: string): Promise<void> {
    const child = this.children.get(agentId)!;
    const { retiredTurns: _retired, ...observation } = child;
    await this.emit({ type: "subagentUpdated", ...observation, prompt: childTaskDisplay(child.prompt), items: [...child.items.values()] });
  }

  async collaboration(item: RecordValue, parentAgentId?: string): Promise<boolean> {
    // 新版 collaboration 发 subAgentActivity，旧桥只认 collabAgentToolCall，真实派生因此不可见。
    // 仅 started 注册关系；completed/interrupted 是活动提示，不能替代子轮的权威终态。
    if (item.type === "subAgentActivity") {
      if (item.kind !== "started") return false;
      const agentId = identifier(item.agentThreadId);
      if (this.children.has(agentId)) return false;
      this.children.set(agentId, { agentId, parentAgentId, parentToolCallId: identifier(item.id),
        prompt: typeof item.prompt === "string" ? item.prompt : typeof item.agentPath === "string" ? item.agentPath : "Codex", agentType: "Codex",
        status: "running", items: new Map(), retiredTurns: new Set() });
      await this.publish(agentId);
      return true;
    }
    if (item.type !== "collabAgentToolCall") return false;
    let added = false;
    for (const value of Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []) {
      const agentId = identifier(value);
      if (!this.children.has(agentId) && item.tool === "spawnAgent" && item.status !== "failed") {
        this.children.set(agentId, { agentId, parentAgentId, parentToolCallId: identifier(item.id),
          prompt: typeof item.prompt === "string" ? item.prompt : "", agentType: "Codex",
          status: "running", items: new Map(), retiredTurns: new Set() });
        added = true;
        await this.publish(agentId);
      }
      const child = this.children.get(agentId);
      if (!child) continue;
      const state = record(record(item.agentsStates)[agentId]);
      if (state.status === "running" || state.status === "pendingInit") {
        if (child.status !== "running") {
          if (child.turnId) child.retiredTurns.add(child.turnId);
          child.status = "running"; child.turnId = undefined; child.inputText = undefined; child.items.clear(); await this.publish(agentId);
        }
      } else if (["completed", "errored", "interrupted", "shutdown", "notFound"].includes(String(state.status))) {
        child.status = state.status === "completed" ? "success" : state.status === "errored" || state.status === "notFound" ? "failed" : "cancelled";
        await this.publish(agentId);
      }
    }
    return added;
  }

  acceptsCurrentItem(message: RpcMessage): boolean {
    const child = this.children.get(String(message.params.threadId));
    const turnId = message.params.turnId;
    return typeof turnId === "string" && child?.status === "running" && child.turnId === turnId && !child.retiredTurns.has(turnId);
  }

  async transcript(agentId: string, records: NativeTranscriptRecord[]): Promise<void> {
    const child = this.children.get(agentId);
    if (!child || child.status !== "running") return;
    let changed = false;
    for (const { turnId, item } of records) {
      if (turnId !== child.turnId || !turnId || child.retiredTurns.has(turnId)) continue;
      if (typeof item.call_id !== "string") continue;
      const id = identifier(item.call_id);
      const previous = child.items.get(id);
      if (item.type === "function_call" || item.type === "custom_tool_call") {
        if (previous || typeof item.name !== "string") continue;
        let input: RecordValue;
        if (item.type === "custom_tool_call") input = { code: typeof item.input === "string" ? item.input : "" };
        else { try { input = record(JSON.parse(String(item.arguments))); } catch { input = { arguments: String(item.arguments ?? "") }; } }
        child.items.set(id, { type: "tool", id, name: item.name, input, output: "", completed: false, failed: false }); changed = true;
      } else if ((item.type === "function_call_output" || item.type === "custom_tool_call_output") && previous?.type === "tool" && !previous.completed) {
        const output = typeof item.output === "string" ? item.output : Array.isArray(item.output)
          ? item.output.flatMap(value => { const part = record(value); return ["input_text", "output_text", "text"].includes(String(part.type)) && typeof part.text === "string" ? [part.text] : []; }).join("\n") : "";
        child.items.set(id, { ...previous, output, completed: true, failed: item.is_error === true }); changed = true;
      }
    }
    if (changed) await this.publish(agentId);
  }

  async notification(message: RpcMessage): Promise<boolean> {
    const p = message.params;
    const child = this.children.get(String(p.threadId));
    if (!child) return false;
    const nativeTurnId = typeof p.turnId === "string" ? p.turnId : record(p.turn).id;
    if (typeof nativeTurnId !== "string") return true;
    if (child.retiredTurns.has(nativeTurnId)) return true;
    if (child.turnId === nativeTurnId && child.status !== "running") return true;
    if (child.turnId !== nativeTurnId) {
      // 新轮只能由 started/item 通知建立；迟到的旧轮终态不能覆盖新工作。
      if (message.method === "turn/completed" || message.method === "error") return true;
      if (child.turnId) child.retiredTurns.add(child.turnId);
      child.turnId = nativeTurnId; child.inputText = undefined; child.items.clear(); child.status = "running";
    }
    if (message.method === "turn/started") {
      // 新版子线程可能先长时间只执行 exec；轮开始就发布输入，不能等最终 agentMessage 才建可见会话。
    } else if (message.method === "item/commandExecution/outputDelta" || message.method === "item/fileChange/outputDelta") {
      const previous = child.items.get(String(p.itemId));
      if (previous?.type !== "tool" || previous.completed || typeof p.delta !== "string") return true;
      child.items.set(previous.id, { ...previous, output: previous.output + p.delta });
    } else if (message.method === "item/agentMessage/delta") {
      const id = identifier(p.itemId); const previous = child.items.get(id);
      if (previous?.completed || typeof p.delta !== "string") return true;
      child.items.set(id, { type: "text", id, text: (previous?.type === "text" ? previous.text : "") + p.delta, completed: false });
    } else if (message.method === "item/started" || message.method === "item/completed") {
      const item = record(p.item); const id = identifier(item.id); const completed = message.method === "item/completed";
      if (child.items.get(id)?.completed) return true;
      if (item.type === "userMessage") {
        child.inputText = (Array.isArray(item.content) ? item.content : []).flatMap(value => {
          const part = record(value);
          return typeof part.text === "string" ? [childTaskDisplay(part.text)] : [];
        }).join("\n");
      } else if (item.type === "agentMessage") {
        const previous = child.items.get(id);
        child.items.set(id, { type: "text", id, text: typeof item.text === "string" && (completed || !previous) ? item.text : previous?.type === "text" ? previous.text : "", completed });
      } else if (["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "collabAgentToolCall", "webSearch", "imageView", "imageGeneration"].includes(String(item.type)) || (item.type === "subAgentActivity" && item.kind === "started")) {
        child.items.set(id, { type: "tool", id, name: nativeToolName(item), input: nativeToolInput(item),
          output: completed ? nativeToolOutput(item, this.rootSessionId) : typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "", completed,
          failed: item.status === "failed" || item.status === "declined" || item.success === false || (typeof item.exitCode === "number" && item.exitCode !== 0) });
      } else return true;
    } else if (message.method === "turn/completed") {
      const status = record(p.turn).status;
      child.status = status === "completed" ? "success" : status === "interrupted" ? "cancelled" : "failed";
    } else if (message.method === "error" && p.willRetry !== true) child.status = "failed";
    else return true;
    await this.publish(child.agentId);
    return true;
  }

}

/** One stdio connection; never retries a possibly accepted request. */
export class CodexConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private failure?: Error;
  private readonly onFailure: (error: Error) => void;
  private readonly pending = new Map<number, {
    method: string;
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(options: {
    binaryPath: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    onMessage(message: RpcMessage): void;
    onFailure(error: Error): void;
  }) {
    this.onFailure = options.onFailure;
    this.child = spawn(options.binaryPath, options.args, {
      cwd: options.cwd, env: options.env, shell: false, windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const fail = (message: string) => {
      if (this.failure) return;
      const error = new Error(message);
      this.close(error);
      options.onFailure(error);
    };
    this.child.on("error", () => fail("Official Codex could not start."));
    this.child.on("exit", () => fail("Official Codex disconnected; the input was not retried."));
    this.child.stdin.on("error", () => fail("Official Codex input connection closed."));
    // Diagnostics can contain provider credentials: drain without persisting or logging.
    this.child.stderr.on("data", () => {});
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    this.child.stdout.on("data", (chunk: Buffer) => {
      if (this.failure) return;
      buffer += decoder.write(chunk);
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > 16 * 1024 * 1024) return fail("Codex protocol frame too large.");
        if (!line.trim()) continue;
        try {
          const message = record(JSON.parse(line));
          if (typeof message.method === "string") {
            if (message.id !== undefined && typeof message.id !== "string" && typeof message.id !== "number") {
              return fail("Invalid Codex request identifier.");
            }
            options.onMessage({ method: message.method, params: record(message.params),
              ...(message.id !== undefined ? { id: message.id as string | number } : {}) });
          } else {
            const request = this.pending.get(message.id as number);
            if (!request) continue;
            this.pending.delete(message.id as number);
            clearTimeout(request.timer);
            if (message.error || !("result" in message)) {
              const responseError = recordError(message.error);
              request.reject(responseError
                ? new Error(`Codex ${request.method} failed (${responseError.code}).`)
                : new Error(`Codex ${request.method} returned an invalid response.`));
            } else request.resolve(message.result);
          }
        } catch {
          return fail("Codex sent an invalid protocol message.");
        }
      }
      if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) fail("Codex protocol buffer too large.");
    });
  }

  send(message: RecordValue): void {
    if (this.failure) throw this.failure;
    if (!this.child.stdin.writable || this.child.stdin.writableLength > 1024 * 1024) {
      throw new Error("Codex input connection is unavailable.");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method: string, params: RecordValue): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`Codex ${method} timed out; the operation was not retried.`);
        this.close(error);
        this.onFailure(error);
        reject(error);
      }, 60_000);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close(error = new Error("Codex connection closed.")): void {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.child.kill();
  }
}
