import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ModelSelection, NativeCodexModelConfig, NativeCodexModelResolver, NativeCodexReasoningEffort, NativeTurnApproval, NativeTurnEvent, NativeTurnExecutor } from "@zcode/contracts";
import type { Provider, ProviderModel } from "@zcode/provider";
import { compileModelOptionMap } from "@zcode/model-option-map";
import { CodexConnection, identifier, record, type RpcMessage } from "./connection.js";

type ExecuteInput = Parameters<NativeTurnExecutor["execute"]>[0];
export interface NativeCodexOptions {
  workspacePath: string;
  binaryPath: string;
  codexHome: string;
  stateDirectory?: string;
  model?: string;
  resolveModel?: NativeCodexModelResolver;
  provider?: string;
  baseUrl?: string;
  skillRoots?: string[];
  configOverrides?: string[];
  env?: NodeJS.ProcessEnv;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const pathKey = (value: string) => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
const abortError = () => Object.assign(new Error("Native Codex turn was cancelled."), { name: "AbortError" });
const toolTypes = new Set(["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "collabAgentToolCall", "webSearch", "imageView", "imageGeneration"]);
const invalidRequestCode = -32600;
const invalidParamsCode = -32602;
const approvalFailureCode = -32603;
const nativeEfforts = new Set<NativeCodexReasoningEffort>(["none", "minimal", "low", "medium", "high", "xhigh"]);

/** Convert already-authorized registry facts, never submission-supplied provider configuration. */
export function resolveNativeCodexModelConfig(selection: ModelSelection, provider: Provider, model: ProviderModel): NativeCodexModelConfig {
  if (selection.providerId !== provider.providerId || selection.modelId !== model.modelId) throw new Error("Native Codex provider/model lookup does not match the selection.");
  const api = provider.config.api;
  const access = provider.config.access;
  if (api.type !== "openai-responses") throw new Error("Native Codex requires a configured OpenAI Responses provider.");
  if (access.type === "zhipu-account" || !access.apiKey?.trim()) throw new Error("Native Codex requires configured API-key authentication.");
  if (api.headers && Object.keys(api.headers).length) throw new Error("Native Codex does not support this provider's custom headers.");
  const level = selection.options?.reasoningLevel;
  if (level === undefined || !model.config.optionSpecs.reasoningLevel.values.includes(level)) throw new Error("Native Codex reasoning level is not supported by the selected model.");
  // 使用 Provider 自己的选项映射；不能把 UI 档位当成 API effort，或静默丢掉其它 body 变更。
  const patch = compileModelOptionMap(model.config.optionSpecs.reasoningLevel.map, "reasoningLevel").evaluate(level);
  const keys = Object.keys(patch);
  if (!keys.length && level === "disabled") return { modelId: model.modelId, baseUrl: api.baseUrl, apiKey: access.apiKey };
  // JsonValue 包含只读数组；先收窄为 unknown，避免 Array.isArray 无法排除 readonly 数组。
  const reasoning: unknown = patch.reasoning;
  if (keys.length !== 1 || !reasoning || Array.isArray(reasoning) || typeof reasoning !== "object" || !("effort" in reasoning) || Object.keys(reasoning).length !== 1 || typeof reasoning.effort !== "string" || !nativeEfforts.has(reasoning.effort as NativeCodexReasoningEffort)) {
    throw new Error("Native Codex cannot represent the selected model's reasoning option mapping.");
  }
  return { modelId: model.modelId, baseUrl: api.baseUrl, apiKey: access.apiKey, reasoningEffort: reasoning.effort as NativeCodexReasoningEffort };
}

function nativePermission(permission: ExecuteInput["permission"]) {
  // 每轮覆盖启动、恢复和 turn 权限，避免上轮 yolo 持久化后污染普通模式。
  const readOnly = permission.planEnabled || permission.mode === "plan";
  const fullAccess = !readOnly && permission.mode === "yolo";
  const sandbox = readOnly ? "read-only" : fullAccess ? "danger-full-access" : "workspace-write";
  const approvalPolicy = readOnly || fullAccess ? "never" : permission.mode === "guarded" ? "untrusted" : "on-request";
  const sandboxPolicy = readOnly
    ? { type: "readOnly" }
    : fullAccess
      ? { type: "dangerFullAccess" }
      : { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
  return { sandbox, approvalPolicy, sandboxPolicy };
}

function toolIdentifier(value: unknown): string {
  const id = identifier(value);
  if (id.trim() !== id || /\p{Cc}/u.test(id)) throw new Error("Codex returned an invalid tool item identifier.");
  return id;
}

function validateMcpOverrides(value: unknown): string[] {
  if (!Array.isArray(value) || value.length % 2 !== 0) {
    throw new Error("Native Codex MCP overrides must be an array of -c and mcp_servers setting pairs.");
  }
  for (let index = 0; index < value.length; index += 2) {
    if (value[index] !== "-c" || typeof value[index + 1] !== "string" || !/^mcp_servers\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*=/.test(value[index + 1])) {
      throw new Error("Native Codex MCP overrides may only configure mcp_servers settings.");
    }
  }
  return [...value] as string[];
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

/** The gateway owns admission. This adapter rejects concurrent access rather than adding a queue. */
export class NativeCodexExecutor implements NativeTurnExecutor {
  constructor(private readonly options: NativeCodexOptions) {}

  async execute(input: ExecuteInput): ReturnType<NativeTurnExecutor["execute"]> {
    input.signal.throwIfAborted();
    input = { ...input, permission: { ...input.permission } };
    const configOverrides = validateMcpOverrides(this.options.configOverrides ?? []);
    const resolvedModel = input.modelSelection
      ? await this.options.resolveModel?.(input.modelSelection)
      : undefined;
    if (input.modelSelection && !resolvedModel) throw new Error("Native Codex model selection resolver is unavailable.");
    const workspace = await realpath(this.options.workspacePath);
    if (pathKey(workspace) !== pathKey(this.options.workspacePath)) {
      throw new Error("Native Codex workspace must use its exact canonical path.");
    }
    const home = await realpath(this.options.codexHome);
    const state = resolve(this.options.stateDirectory ?? join(home, "zcode-native"));
    await mkdir(state, { recursive: true, mode: 0o700 });
    const canonicalState = await realpath(state);
    const inside = relative(workspace, canonicalState);
    if (!inside || (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside))) {
      throw new Error("Native Codex state must be outside the project workspace.");
    }
    const directory = join(canonicalState, hash(pathKey(workspace)), hash(input.sessionId));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lock = join(directory, "active.lock");
    try { await mkdir(lock); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("This native session is already active or has an unreconciled process lock. Inspect its Codex thread before clearing the lock.");
      }
      throw error;
    }
    try { return await this.run(input, workspace, directory, configOverrides, resolvedModel); }
    finally { await rm(lock, { recursive: true, force: true }); }
  }

  private async run(input: ExecuteInput, workspace: string, directory: string, configOverrides: string[], resolvedModel?: NativeCodexModelConfig): ReturnType<NativeTurnExecutor["execute"]> {
    let connection: CodexConnection | undefined;
    const permission = nativePermission(input.permission);
    let threadId = "";
    let turnId = "";
    let text = "";
    let toolCallCount = 0;
    let finished = false;
    let starting = false;
    let sequence = Promise.resolve();
    const buffered: RpcMessage[] = [];
    const messages = new Map<string, string>();
    const completedMessages = new Set<string>();
    const startedTools = new Map<string, string>();
    const completedTools = new Set<string>();
    let complete!: () => void;
    let reject!: (error: Error) => void;
    const done = new Promise<void>((resolveDone, rejectDone) => { complete = resolveDone; reject = rejectDone; });
    // Handshake/storage errors can precede awaiting turn completion.
    void done.catch(() => {});
    const fail = (error: Error) => { if (!finished) { finished = true; reject(error); connection?.close(error); } };
    const emit = async (event: NativeTurnEvent) => {
      if (finished || input.signal.aborted) return;
      await input.onEvent(event);
    };
    const startText = async (itemId: string) => {
      if (messages.has(itemId)) return;
      messages.set(itemId, "");
      await emit({ type: "textStarted", itemId });
    };
    const startTool = async (id: string, name: string, toolInput: Record<string, unknown>) => {
      const startedName = startedTools.get(id);
      if (startedName && startedName !== name) throw new Error("Codex approval does not match its tool item.");
      if (startedName) return;
      startedTools.set(id, name); toolCallCount++;
      await emit({ type: "toolStarted", id, name, input: toolInput });
    };
    const handle = async (message: RpcMessage) => {
      if (finished) return;
      const p = message.params;
      if (message.id !== undefined) {
        if (p.threadId !== threadId || p.turnId !== turnId || input.signal.aborted) {
          const error = new Error("Codex approval request does not belong to the active turn. No permission was granted.");
          connection?.send({ id: message.id, error: { code: invalidRequestCode, message: error.message } });
          throw error;
        }
        if (message.method !== "item/commandExecution/requestApproval" && message.method !== "item/fileChange/requestApproval") {
          connection?.send({ id: message.id, error: { code: -32601, message: "Native ZCode does not support this server request (including tool user input)." } });
          throw Object.assign(new Error("Codex requested an unsupported interaction. No permission was granted."), { code: "NATIVE_CODEX_UNSUPPORTED_INTERACTION" });
        }
        let toolCallId: string;
        try { toolCallId = toolIdentifier(p.itemId); }
        catch {
          const error = new Error("Codex approval request has an invalid tool item identifier. No permission was granted.");
          connection?.send({ id: message.id, error: { code: invalidParamsCode, message: error.message } });
          throw error;
        }
        const command = message.method === "item/commandExecution/requestApproval";
        const name = command ? "Bash" : "Edit";
        try {
          if (completedTools.has(toolCallId)) throw new Error("Codex requested approval for a completed tool item.");
          // 审批 RPC id 与工具 itemId 不同；先持久化工具再请求权限，且后到的 started 不重复建卡。
          await startTool(toolCallId, name, { ...p, id: toolCallId, type: command ? "commandExecution" : "fileChange" });
          if (finished || input.signal.aborted) return;
          const request: NativeTurnApproval = {
            id: String(message.id), toolCallId, name,
            input: p, ...(typeof p.reason === "string" ? { reason: p.reason } : {}),
          };
          const decision = await input.requestApproval(request);
          if (!finished && !input.signal.aborted) connection?.send({ id: message.id, result: { decision: decision === "allow" ? "accept" : "decline" } });
        } catch (error) {
          if (!finished && !input.signal.aborted) connection?.send({ id: message.id, error: { code: approvalFailureCode, message: "Native approval failed. No permission was granted." } });
          throw error;
        }
        return;
      }
      if (p.threadId !== threadId) return;
      const incomingTurn = typeof p.turnId === "string" ? p.turnId : record(p.turn).id;
      if (incomingTurn !== turnId) return;
      if (message.method === "item/agentMessage/delta") {
        const id = identifier(p.itemId);
        if (typeof p.delta !== "string") throw new Error("Codex returned an invalid text delta.");
        if (completedMessages.has(id)) throw new Error("Codex returned text after item completion.");
        await startText(id);
        messages.set(id, (messages.get(id) ?? "") + p.delta);
        text += p.delta;
        await emit({ type: "textDelta", itemId: id, delta: p.delta });
      } else if (message.method === "item/started" || message.method === "item/completed") {
        const item = record(p.item);
        const id = identifier(item.id);
        if (item.type === "contextCompaction") {
          // item 身份由 Core 统一去重；旧 thread/compacted 无 item 身份，不能合成成功。
          await emit({
            type: message.method === "item/started" ? "contextCompactionStarted" : "contextCompactionCompleted",
            threadId, turnId, itemId: id,
          });
        } else if (item.type === "agentMessage") {
          // 原先抹去 item 身份并累加整轮文本，导致工具后的结论写回工具前的段落。
          await startText(id);
          if (message.method === "item/completed") {
            if (typeof item.text !== "string") throw new Error("Codex returned invalid completed text.");
            const streamed = messages.get(id) ?? "";
            if (!item.text.startsWith(streamed) || (completedMessages.has(id) && item.text !== streamed)) {
              throw Object.assign(new Error("Codex completed text disagrees with the streamed text."), { code: "NATIVE_CODEX_FINAL_TEXT_MISMATCH" });
            }
            if (completedMessages.has(id)) return;
            const remainder = item.text.slice(streamed.length);
            if (remainder) { text += remainder; await emit({ type: "textDelta", itemId: id, delta: remainder }); }
            messages.set(id, item.text);
            completedMessages.add(id);
            await emit({ type: "textCompleted", itemId: id });
          }
        } else if (typeof item.type === "string" && toolTypes.has(item.type)) {
          const name = item.type === "commandExecution" ? "Bash" : item.type === "fileChange" ? "Edit" : typeof item.tool === "string" ? item.tool : item.type;
          await startTool(toolIdentifier(id), name, item);
          if (message.method === "item/completed" && !completedTools.has(id)) {
            completedTools.add(id);
            const output = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : JSON.stringify(item.result ?? item.changes ?? item.contentItems ?? item);
            await emit({ type: "toolCompleted", id, name, output,
              failed: item.status === "failed" || item.status === "declined" || item.success === false || (typeof item.exitCode === "number" && item.exitCode !== 0) });
          }
        }
      } else if (message.method === "turn/completed") {
        const turn = record(p.turn);
        if (turn.status === "interrupted" || input.signal.aborted) throw abortError();
        if (turn.status !== "completed") throw new Error("Official Codex turn failed. Inspect its thread before submitting another input.");
        finished = true; complete();
      } else if (message.method === "error" && p.willRetry !== true) {
        throw new Error("Official Codex reported a turn error.");
      }
    };
    const enqueue = (message: RpcMessage) => {
      sequence = sequence.then(() => handle(message));
      void sequence.catch(error => fail(error instanceof Error ? error : new Error("Native event delivery failed.")));
    };
    const onAbort = () => {
      // 中断先发到官方进程，再关闭连接；取消不会重放已发送的提示词。
      if (connection && threadId && turnId) {
        void connection.request("turn/interrupt", { threadId, turnId }).finally(() => fail(abortError())).catch(() => {});
      } else if (!starting) fail(abortError());
    };
    input.signal.addEventListener("abort", onAbort, { once: true });
    try {
      input.signal.throwIfAborted();
      // 显式选择必须覆盖启动器默认值；每轮解析自己的 Provider，不能复用另一 Provider 的密钥。
      const model = resolvedModel?.modelId ?? this.options.model ?? "gpt-6.1-sol";
      const provider = resolvedModel ? "zcode_api" : this.options.provider ?? "zcode_api";
      const baseUrl = resolvedModel?.baseUrl ?? this.options.baseUrl;
      const effort = resolvedModel?.reasoningEffort;
      if (!/^[A-Za-z0-9_-]+$/.test(provider)) throw new Error("Invalid native Codex provider identifier.");
      if (effort !== undefined && !["none", "minimal", "low", "medium", "high", "xhigh"].includes(effort)) throw new Error("Unsupported native Codex reasoning effort.");
      if (baseUrl) {
        const url = new URL(baseUrl);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Native Codex base URL must not contain credentials or query parameters.");
      }
      const providerAliases = resolvedModel ? [...new Set(["zcode_api", "zcode_selected", provider])] : [provider];
      const connect = async (activeProvider: string) => {
      connection = new CodexConnection({
        binaryPath: this.options.binaryPath,
        args: ["app-server", "--stdio", "-c", `model=${JSON.stringify(model)}`, "-c", `model_provider=${JSON.stringify(activeProvider)}`,
          ...[...new Set([...providerAliases, activeProvider])].flatMap(alias => [
            ...(baseUrl ? ["-c", `model_providers.${alias}.base_url=${JSON.stringify(baseUrl)}`] : []),
            ...(resolvedModel ? ["-c", `model_providers.${alias}.name="ZCode selected provider"`, "-c", `model_providers.${alias}.wire_api="responses"`, "-c", `model_providers.${alias}.requires_openai_auth=false`, "-c", `model_providers.${alias}.supports_websockets=false`] : []),
            "-c", `model_providers.${alias}.env_key="CODEX_ZCODE_API_KEY"`,
          ]),
          ...(effort !== undefined ? ["-c", `model_reasoning_effort=${JSON.stringify(effort)}`] : []),
          "-c", 'shell_environment_policy.exclude=["CODEX_ZCODE_API_KEY"]',
          "-c", `sandbox_mode=${JSON.stringify(permission.sandbox)}`, "-c", `approval_policy=${JSON.stringify(permission.approvalPolicy)}`, ...configOverrides],
        cwd: workspace, env: { ...(this.options.env ?? process.env), CODEX_HOME: this.options.codexHome, ...(resolvedModel ? { CODEX_ZCODE_API_KEY: resolvedModel.apiKey } : {}) },
        onFailure: fail,
        onMessage: message => { if (starting) buffered.push(message); else enqueue(message); },
      });
      await connection.request("initialize", {
        clientInfo: { name: "zcode_native_codex", title: "ZCode Native Codex", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      });
      connection.send({ method: "initialized", params: {} });
      if (this.options.skillRoots?.length) {
        await connection.request("skills/extraRoots/set", { extraRoots: this.options.skillRoots });
      }
      return connection;
      };
      connection = await connect(provider);
      const settings = { cwd: workspace, model, modelProvider: provider, sandbox: permission.sandbox, approvalPolicy: permission.approvalPolicy,
        ...(resolvedModel ? { config: { model_reasoning_effort: effort ?? null } } : {}) };

      const mapPath = join(directory, "thread.json");
      let saved: Record<string, unknown> | undefined;
      try { saved = record(JSON.parse(await readFile(mapPath, "utf8"))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Native Codex thread mapping is unreadable; refusing to fork."); }
      if (saved) {
        if (saved.version !== 1 || saved.workspace !== pathKey(workspace) || saved.sessionId !== input.sessionId) throw new Error("Native Codex thread mapping does not match this session.");
        threadId = identifier(saved.threadId);
        const read = record(await connection.request("thread/read", { threadId, includeTurns: false }));
        const thread = record(read.thread);
        if (typeof thread.id !== "string" || thread.id !== threadId || thread.cwd !== workspace || typeof thread.modelProvider !== "string" || !/^[A-Za-z0-9_-]+$/.test(thread.modelProvider)) {
          throw new Error("Codex thread metadata does not match this session or has no valid provider identity; refusing to fork.");
        }
        // Codex 0.166 恢复时校验进程级 Provider；旧别名先重建只读元数据进程，不能重试输入或另开线程。
        if (thread.modelProvider !== provider) {
          connection.close();
          input.signal.throwIfAborted();
          connection = await connect(thread.modelProvider);
        }
        const resumed = record(await connection.request("thread/resume", { ...settings, modelProvider: thread.modelProvider, threadId, excludeTurns: true }));
        if (record(resumed.thread).id !== threadId) throw new Error("Codex resumed a different thread.");
      } else {
        const created = record(await connection.request("thread/start", settings));
        threadId = identifier(record(created.thread).id);
        await atomicWrite(mapPath, { version: 1, workspace: pathKey(workspace), sessionId: input.sessionId, threadId });
      }
      input.signal.throwIfAborted();
      // Persist before dispatch: an ambiguous failed turn must never be automatically replayed.
      const receipt = await open(join(directory, `input-${hash(input.inputId)}.json`), "wx", 0o600).catch(error => {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("This native input was already dispatched or has an uncertain outcome; it will not be replayed.");
        throw error;
      });
      try { await receipt.writeFile(JSON.stringify({ inputId: input.inputId, threadId })); await receipt.sync(); }
      finally { await receipt.close(); }
      input.signal.throwIfAborted();
      starting = true;
      const started = record(await connection.request("turn/start", { threadId, model, ...(resolvedModel ? { effort: effort ?? null } : {}), approvalPolicy: permission.approvalPolicy, sandboxPolicy: permission.sandboxPolicy, input: [{ type: "text", text: input.text, text_elements: [] }] }));
      turnId = identifier(record(started.turn).id);
      starting = false;
      for (const message of buffered) enqueue(message);
      if (input.signal.aborted) onAbort();
      await done;
      await sequence;
      return { text, threadId, toolCallCount };
    } finally {
      finished = true;
      input.signal.removeEventListener("abort", onAbort);
      connection?.close();
    }
  }
}

export interface NativeCodexDiscoveryOptions {
  env?: NodeJS.ProcessEnv;
  binaryPath?: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

function environmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (env[name] !== undefined) return env[name];
  const key = Object.keys(env).find(key => key.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

async function executablePath(candidate: string, platform: NodeJS.Platform): Promise<string | undefined> {
  if (!isAbsolute(candidate) || /\.(?:cmd|bat|ps1)$/iu.test(candidate)) return undefined;
  if (platform === "win32" && ![".exe", ".com"].includes(extname(candidate).toLowerCase())) return undefined;
  try {
    if (!(await stat(candidate)).isFile()) return undefined;
    if (platform !== "win32") await access(candidate, constants.X_OK);
    const canonical = await realpath(candidate);
    if (platform === "win32" && ![".exe", ".com"].includes(extname(canonical).toLowerCase())) return undefined;
    return canonical;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES" || code === "EPERM") return undefined;
    throw error;
  }
}

function vendorBinaries(root: string, target: string, fileName: string): string[] {
  return ["codex", "bin"].map(directory => join(root, "vendor", target, directory, fileName));
}

/** Read-only, bounded local discovery; never run npm, a shell wrapper, or a workspace command. */
export async function discoverNativeCodexBinary(options: NativeCodexDiscoveryOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const override = options.binaryPath ?? env.ZCODE_CODEX_BINARY;
  if (override !== undefined) {
    const found = await executablePath(override, platform);
    if (!found) throw new Error("ZCODE_CODEX_BINARY must point to an existing absolute native executable; shell wrappers are unsupported.");
    return found;
  }
  const architecture = arch === "x64" ? "x86_64" : arch === "arm64" ? "aarch64" : undefined;
  const system = platform === "win32" ? "pc-windows-msvc" : platform === "darwin" ? "apple-darwin" : platform === "linux" ? "unknown-linux-musl" : undefined;
  if (!architecture || !system) throw new Error("The installed Codex discovery does not support this operating system or architecture; configure ZCODE_CODEX_BINARY explicitly.");
  const target = `${architecture}-${system}`;
  const fileName = platform === "win32" ? "codex.exe" : "codex";
  const paths = (environmentValue(env, "PATH") ?? "").split(platform === "win32" ? ";" : ":")
    .map(entry => entry.replace(/^"|"$/gu, ""))
    .filter(entry => isAbsolute(entry));
  const candidates: string[] = [];
  for (const directory of paths) {
    candidates.push(join(directory, fileName));
    const packageRoots = [
      join(directory, "node_modules", "@openai"),
      join(directory, "..", "lib", "node_modules", "@openai"),
    ];
    for (const packages of packageRoots) {
      const core = join(packages, "codex");
      const platformPackage = `codex-${platform}-${arch}`;
      candidates.push(...vendorBinaries(core, target, fileName));
      candidates.push(...vendorBinaries(join(packages, platformPackage), target, fileName));
      candidates.push(...vendorBinaries(join(core, "node_modules", "@openai", platformPackage), target, fileName));
    }
  }
  if (platform === "win32") {
    const localAppData = environmentValue(env, "LOCALAPPDATA");
    if (localAppData && isAbsolute(localAppData)) {
      const installed = join(localAppData, "Programs", "Codex");
      candidates.push(...vendorBinaries(join(installed, "package"), target, fileName));
      candidates.push(join(installed, "resources", fileName));
    }
  }
  for (const candidate of new Set(candidates)) {
    const found = await executablePath(candidate, platform);
    if (found) return found;
  }
  throw new Error("Codex executable was not found. Install the official Codex CLI and add it to PATH, or configure ZCODE_CODEX_BINARY.");
}

export interface NativeCodexProjectOptions {
  workspacePath: string;
  env?: NodeJS.ProcessEnv;
  binaryPath?: string;
  codexHome?: string;
  resolveModel?: NativeCodexModelResolver;
}

/** Project-authoritative selection; ordinary CODEX_HOME belongs to the user's separate Codex installation. */
export async function createNativeCodexExecutor(options: NativeCodexProjectOptions): Promise<NativeTurnExecutor> {
  const env = options.env ?? process.env;
  const binaryPath = await discoverNativeCodexBinary({ env, binaryPath: options.binaryPath });
  const dataBase = env.ZCODE_DATA_BASE_DIR?.trim() || env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
  const codexHome = options.codexHome ?? env.ZCODE_CODEX_HOME ?? join(dataBase, ".zcode", "codex-home");
  if (!isAbsolute(codexHome)) throw new Error("ZCODE_CODEX_HOME must be an absolute independent data directory.");
  const workspace = await realpath(options.workspacePath);
  const assertIndependentHome = (home: string) => {
    const inside = relative(workspace, home);
    if (!inside || (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside))) {
      throw new Error("Native Codex home must be outside the project workspace.");
    }
  };
  assertIndependentHome(resolve(codexHome));
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  const canonicalHome = await realpath(codexHome);
  assertIndependentHome(canonicalHome);
  return new NativeCodexExecutor({
    workspacePath: options.workspacePath,
    binaryPath,
    codexHome: canonicalHome,
    ...(options.resolveModel ? { resolveModel: options.resolveModel } : {}),
    ...nativeCodexEnvironmentOptions(env),
    env: { ...env },
  });
}

function nativeCodexEnvironmentOptions(env: NodeJS.ProcessEnv): Pick<NativeCodexOptions, "configOverrides" | "skillRoots" | "baseUrl" | "stateDirectory" | "model" | "provider"> {
  const configOverrides = env.ZCODE_CODEX_MCP_OVERRIDES_JSON === undefined
    ? undefined
    : validateMcpOverrides(JSON.parse(env.ZCODE_CODEX_MCP_OVERRIDES_JSON));
  let skillRoots: string[] | undefined;
  if (env.ZCODE_CODEX_SKILL_ROOTS) {
    const parsed: unknown = JSON.parse(env.ZCODE_CODEX_SKILL_ROOTS);
    if (!Array.isArray(parsed) || !parsed.every(root => typeof root === "string" && isAbsolute(root))) throw new Error("ZCODE_CODEX_SKILL_ROOTS must be a JSON array of absolute paths.");
    skillRoots = parsed as string[];
  }
  return {
    ...(configOverrides ? { configOverrides } : {}),
    ...(skillRoots ? { skillRoots } : {}),
    ...(env.ZCODE_CODEX_BASE_URL ? { baseUrl: env.ZCODE_CODEX_BASE_URL } : {}),
    ...(env.ZCODE_CODEX_STATE_DIR ? { stateDirectory: env.ZCODE_CODEX_STATE_DIR } : {}),
    ...(env.ZCODE_CODEX_MODEL ? { model: env.ZCODE_CODEX_MODEL } : {}),
    ...(env.ZCODE_CODEX_PROVIDER ? { provider: env.ZCODE_CODEX_PROVIDER } : {}),
  };
}

/** Synchronous opt-in selection; all filesystem/process work remains in execute. */
export function createNativeCodexExecutorFromEnv(workspacePath: string, env: NodeJS.ProcessEnv = process.env, resolveModel?: NativeCodexModelResolver): NativeTurnExecutor | undefined {
  const selected = env.ZCODE_CODEX_WORKSPACE;
  if (!selected || pathKey(selected) !== pathKey(workspacePath)) return undefined;
  if (!isAbsolute(selected) || !env.ZCODE_CODEX_BINARY || !isAbsolute(env.ZCODE_CODEX_BINARY) || !env.CODEX_HOME || !isAbsolute(env.CODEX_HOME)) {
    throw new Error("Native Codex requires absolute ZCODE_CODEX_WORKSPACE, ZCODE_CODEX_BINARY and CODEX_HOME paths.");
  }
  return new NativeCodexExecutor({ workspacePath: selected, binaryPath: env.ZCODE_CODEX_BINARY, codexHome: env.CODEX_HOME,
    ...(resolveModel ? { resolveModel } : {}),
    ...nativeCodexEnvironmentOptions(env),
    env: { ...env },
  });
}
