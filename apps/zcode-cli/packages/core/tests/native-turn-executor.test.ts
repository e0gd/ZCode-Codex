import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import {
  CoreErrorType,
  EventReducer,
  createSessionId,
  nativeCodexChildSessionId,
  SessionEventType,
  type NativeTurnExecutor,
  type PermissionBrokerPort,
  type PermissionBrokerResult,
  type PermissionRequestedPayload,
  type SessionStorePort,
} from "@zcode/contracts";
import type { AgentRuntimeDeps } from "../src/runtime/types.js";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { createRecordingMessageStore } from "./runtime-output-token-continuation-test-helpers.js";

function fixture(nativeTurnExecutor: NativeTurnExecutor, deps: Partial<AgentRuntimeDeps> = {}) {
  const modelFactory = vi.fn(() => {
    throw new Error("ZCode model loop must not run");
  });
  const sessionId = createSessionId("native-codex-regression");
  const eventStore = deps.eventStore ?? createTestSessionEventStore();
  const runtime = createTestAgentRuntime(
    sessionId,
    {
      workingDirectory: process.cwd(),
      titleGeneration: { enabled: false },
    },
    { ...deps, eventStore, modelFactory, nativeTurnExecutor },
  );
  return { runtime, modelFactory, sessionId, eventStore };
}

const TOOL_ID = "codex-item-42";
const APPROVAL_ID = "rpc-approval-7";
const INPUT_ID = "native-approval-input";
const REQUEST_ID = `native-codex:${INPUT_ID}:${APPROVAL_ID}`;
const TOOL_INPUT = { command: "test command, never executed" };
const APPROVAL = {
  id: APPROVAL_ID,
  toolCallId: TOOL_ID,
  name: "Bash",
  input: TOOL_INPUT,
  reason: "Native sandbox approval",
};

function pendingBroker(asyncRegistration = false) {
  const pending = new Map<
    string,
    ReturnType<typeof Promise.withResolvers<PermissionBrokerResult>>
  >();
  const registered = Promise.withResolvers<void>();
  const called = Promise.withResolvers<void>();
  const aborts = vi.fn();
  const requestPermission = vi.fn<PermissionBrokerPort["requestPermission"]>((request, options) => {
    const response = Promise.withResolvers<PermissionBrokerResult>();
    const onAbort = () => {
      aborts();
      pending.delete(request.requestId);
      response.reject(options?.signal?.reason ?? new Error("broker cancelled"));
    };
    const register = () => {
      options?.signal?.throwIfAborted();
      pending.set(request.requestId, response);
      options?.signal?.addEventListener("abort", onAbort, { once: true });
    };
    const barrier = asyncRegistration ? registered.promise.then(register) : undefined;
    if (!asyncRegistration) register();
    called.resolve();
    const promise = response.promise.finally(() => {
      options?.signal?.removeEventListener("abort", onAbort);
      pending.delete(request.requestId);
    });
    return barrier ? Object.assign(promise, { registered: barrier }) : promise;
  });
  return {
    broker: { requestPermission },
    pending,
    called: called.promise,
    register: () => registered.resolve(),
    aborts,
    resolve(requestId: string, result: PermissionBrokerResult) {
      const response = pending.get(requestId);
      if (!response) throw new Error(`Broker was not registered: ${requestId}`);
      response.resolve(result);
    },
    reject(requestId: string, error: Error) {
      const response = pending.get(requestId);
      if (!response) throw new Error(`Broker was not registered: ${requestId}`);
      response.reject(error);
    },
  };
}

function approvalExecutor(decisions: string[]): NativeTurnExecutor {
  return {
    async execute(input) {
      await input.onEvent({ type: "toolStarted", id: TOOL_ID, name: "Bash", input: TOOL_INPUT });
      decisions.push(await input.requestApproval(APPROVAL));
      await input.onEvent({
        type: "toolCompleted",
        id: TOOL_ID,
        name: "Bash",
        output: "native result",
        failed: decisions.at(-1) !== "allow",
      });
      return { text: "done", threadId: "codex-thread", toolCallCount: 1 };
    },
  };
}

describe("native turn execution", () => {
  it("retains nested parent identity and reopens the same child with its follow-up input", async () => {
    const store = createRecordingMessageStore();
    const initial = { type: "subagentUpdated" as const, agentId: "a", parentToolCallId: "spawn-a", prompt: "Original task", agentType: "Codex", status: "running" as const, items: [] };
    const { runtime, sessionId, eventStore } = fixture({ async execute(input) {
      await input.onEvent({ ...initial, turnId: "a1" });
      await input.onEvent({ ...initial, agentId: "b", parentAgentId: "a", parentToolCallId: "spawn-b", turnId: "b1", status: "success" });
      await input.onEvent({ ...initial, turnId: "a1", status: "success" });
      await input.onEvent({ ...initial, turnId: "a2", inputText: "Follow-up input" });
      await input.onEvent({ ...initial, turnId: "a2", inputText: "Follow-up input", status: "success" });
      return { text: "", threadId: "parent", toolCallCount: 0 };
    } }, { sessionStore: store as unknown as SessionStorePort });
    await runtime.executeTurn("Explicit delegation");
    const a = nativeCodexChildSessionId(sessionId, "a"), b = nativeCodexChildSessionId(sessionId, "b");
    expect(await store.getSession(b)).toMatchObject({ parentID: a });
    expect(store.savedMessages.filter(m => m.sessionID === a && m.role === "assistant")).toHaveLength(2);
    expect(store.savedParts.some(p => p.sessionID === a && p.text === "Follow-up input")).toBe(true);
    expect((await eventStore.getEvents(a)).some(e => e.type === SessionEventType.SubagentSpawned && (e.payload as any).childSessionId === b)).toBe(true);
  });
  it.each(["failed", "cancelled"] as const)("settles child transcript/tool state on %s native execution", async status => {
    const store = createRecordingMessageStore();
    const upsertToolUsage = vi.fn(async () => {});
    Object.assign(store, { upsertToolUsage, recordModelUsage: vi.fn(), upsertTurnUsage: vi.fn(), pruneUsage: vi.fn() });
    const observation = { type: "subagentUpdated" as const, agentId: "child", parentToolCallId: "spawn", prompt: "Read files", agentType: "Codex", status: "running" as const, turnId: "child-turn",
      items: [{ type: "tool" as const, id: "bash", name: "Bash", input: { command: "read only fixture" }, output: "", completed: false, failed: false }] };
    const { runtime, eventStore, sessionId } = fixture({ async execute(input) {
      await input.onEvent(observation);
      throw Object.assign(new Error("fixture disconnected"), { name: status === "cancelled" ? "AbortError" : "Error" });
    } }, { sessionStore: store as unknown as SessionStorePort });
    await expect(runtime.executeTurn("Please delegate")).rejects.toBeDefined();
    const childId = nativeCodexChildSessionId(sessionId, "child");
    expect(store.savedMessages.find(m => m.sessionID === childId && m.role === "assistant")?.error?.name).toBe(status === "cancelled" ? "AbortError" : "Error");
    expect(store.savedParts.find(p => p.sessionID === childId && p.type === "tool")?.state.status).toBe("error");
    expect(upsertToolUsage).toHaveBeenCalledWith(expect.objectContaining({ sessionID: childId, toolCallID: "bash" }));
    expect((await eventStore.getEvents(sessionId)).filter(e => e.type === SessionEventType.SubagentStopped)).toHaveLength(1);
  });

  it("persists native children before spawn and publishes child output on its own session", async () => {
    const store = createRecordingMessageStore(); const received: any[] = [];
    const childId = nativeCodexChildSessionId("sess_native-codex-regression", "child-1");
    const observation = { type: "subagentUpdated" as const, agentId: "child-1", parentToolCallId: "spawn", prompt: "Inspect files", agentType: "Codex", status: "running" as const, items: [] };
    const { runtime, eventStore, sessionId, modelFactory } = fixture({ async execute(input) {
      await input.onEvent({ type: "toolStarted", id: "spawn", name: "Agent", input: { prompt: "Inspect files", run_in_background: true } });
      await input.onEvent(observation); await input.onEvent(observation);
      await input.onEvent({ type: "toolCompleted", id: "spawn", name: "Agent", output: "spawned" });
      await input.onEvent({ ...observation, turnId: "child-turn", items: [{ type: "text", id: "text", text: "Live output", completed: false }] });
      await input.onEvent({ ...observation, turnId: "child-turn", status: "success", items: [{ type: "text", id: "text", text: "Live output done", completed: true }] });
      return { text: "", threadId: "parent", toolCallCount: 1 };
    } }, { sessionStore: store as unknown as SessionStorePort });
    runtime.subscribeEvents({ async onSessionEvent(event) {
      received.push(event);
      if (event.type === SessionEventType.SubagentSpawned) expect(await store.getSession(childId)).toMatchObject({ parentID: sessionId, taskType: "subagent_child" });
    } });
    await runtime.executeTurn("Please delegate");
    const parent = await eventStore.getEvents(sessionId); const child = await eventStore.getEvents(childId);
    expect(parent.filter(e => e.type === SessionEventType.SubagentSpawned)).toHaveLength(1);
    expect(parent.filter(e => e.type === SessionEventType.SubagentStopped)).toHaveLength(1);
    expect(child.some(e => e.type === SessionEventType.TurnComplete)).toBe(true);
    expect(received.some(e => e.sessionId === childId && e.type === SessionEventType.ModelStreaming)).toBe(true);
    expect(store.savedParts.some(p => p.sessionID === childId && p.type === "text" && p.text === "Live output done")).toBe(true);
    expect(parent.some(e => e.type === SessionEventType.ModelStreaming && JSON.stringify(e.payload).includes("Live output"))).toBe(false);
    expect(modelFactory).not.toHaveBeenCalled();
  });
  const questionInput = { questions: [{ question: "Where to host?", header: "Host", options: [{ label: "Existing site", description: "Keep URL" }, { label: "New server", description: "Deploy separately" }], multiSelect: false as const }], metadata: { source: "native-codex" } };
  const questionExecutor = (answer: (answers: Record<string, string>) => void, signal?: AbortSignal): NativeTurnExecutor => ({ async execute(input) {
    await input.onEvent({ type: "toolStarted", id: "question-item", name: "AskUserQuestion", input: questionInput });
    const answers = await input.requestUserInput({ id: "question-rpc", toolCallId: "question-item", questions: questionInput.questions }, { signal: signal ?? input.signal });
    answer(answers);
    await input.onEvent({ type: "toolCompleted", id: "question-item", name: "AskUserQuestion", output: JSON.stringify({ questions: questionInput.questions, answers }) });
    return { text: "", threadId: "thread", toolCallCount: 1 };
  } });

  it.each(["build", "yolo", "plan"] as const)("publishes real question buttons and awaits answers in %s mode", async mode => {
    const broker = pendingBroker(); const answer = vi.fn(); const store = createRecordingMessageStore();
    const { runtime, eventStore, sessionId, modelFactory } = fixture(questionExecutor(answer), { permissionBroker: broker.broker, sessionStore: store as unknown as SessionStorePort });
    runtime.updateConfig({ mode });
    runtime.subscribeEvents({ onSessionEvent(event) {
      if (event.type === SessionEventType.PermissionRequested) {
        const payload = event.payload as PermissionRequestedPayload;
        expect(payload).toMatchObject({ toolName: "AskUserQuestion", input: questionInput, riskLevel: "low" });
        broker.resolve(payload.requestId, { decision: "modify", modifiedInput: { ...questionInput, answers: { "Where to host?": "Existing site" } } });
      }
    } });
    const result = await runtime.executeTurn("ask", undefined, { inputId: "question-input" });
    expect(answer).toHaveBeenCalledWith({ "Where to host?": "Existing site" });
    expect(result.events.filter(e => e.type === SessionEventType.PermissionRequested)).toHaveLength(1);
    expect(result.events.filter(e => e.type === SessionEventType.PermissionResolved)).toHaveLength(1);
    expect(broker.pending.size).toBe(0);
    expect(modelFactory).not.toHaveBeenCalled();
    expect(store.savedParts.filter(p => p.type === "tool").at(-1)).toMatchObject({ tool: "AskUserQuestion", state: { status: "completed", output: expect.stringContaining("Existing site") } });
  });

  it("clears the published native question before failing on native connection cancellation", async () => {
    const broker = pendingBroker(); const controller = new AbortController(); const answer = vi.fn();
    const { runtime, eventStore, sessionId } = fixture(questionExecutor(answer, controller.signal), { permissionBroker: broker.broker });
    runtime.subscribeEvents({ onSessionEvent(event) { if (event.type === SessionEventType.PermissionRequested) controller.abort(new Error("native disconnected")); } });
    await expect(runtime.executeTurn("ask")).rejects.toBeDefined();
    const events = await eventStore.getEvents(sessionId);
    expect(events.filter(e => e.type === SessionEventType.PermissionResolved)).toHaveLength(1);
    expect(broker.pending.size).toBe(0);
    expect(answer).not.toHaveBeenCalled();
  });

  it.each(["deny", "invalid"])("does not fabricate an answer from %s", async outcome => {
    const broker = pendingBroker(); const answer = vi.fn();
    const { runtime, eventStore, sessionId } = fixture(questionExecutor(answer), { permissionBroker: broker.broker });
    runtime.subscribeEvents({ onSessionEvent(event) {
      if (event.type !== SessionEventType.PermissionRequested) return;
      broker.resolve((event.payload as PermissionRequestedPayload).requestId, outcome === "deny" ? { decision: "deny" } : { decision: "modify", modifiedInput: { ...questionInput, answers: { "Unknown question": "Invented preference" } } });
    } });
    const turn = runtime.executeTurn("ask");
    if (outcome === "deny") { await turn; expect(answer).toHaveBeenCalledWith({}); }
    else { await expect(turn).rejects.toBeDefined(); expect(answer).not.toHaveBeenCalled(); }
  });

  it("owns compact identity/dedupe and persists ordered truthful automatic markers", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    try {
      const store = createRecordingMessageStore();
      const identity = { threadId: "native-thread", turnId: "native-turn", itemId: "compact-item" };
      const { runtime, modelFactory } = fixture({ async execute(input) {
        await input.onEvent({ type: "textDelta", itemId: "before", delta: "before" });
        for (const type of ["contextCompactionStarted", "contextCompactionStarted", "contextCompactionCompleted", "contextCompactionCompleted", "contextCompactionStarted"] as const) {
          await input.onEvent({ type, ...identity });
        }
        await input.onEvent({ type: "textDelta", itemId: "after", delta: "after" });
        await input.onEvent({ type: "contextCompactionCompleted", ...identity, itemId: "completed-only" });
        return { text: "beforeafter", threadId: identity.threadId, toolCallCount: 0 };
      } }, { sessionStore: store as unknown as SessionStorePort });
      const result = await runtime.executeTurn("automatic compact", undefined, {
        intent: { sourceCommandId: "compact-notice-input", queueItemId: "compact-notice-input", clientId: "test", kind: "sendText", admissionSeq: 1, admittedAt: Date.now(), requestedDelivery: "auto", admittedDelivery: "startNow", modelSelection: { providerId: "selected-provider", modelId: "selected-model" } },
      });
      const compact = result.events.filter(event => event.type === SessionEventType.CompactStarted || event.type === SessionEventType.CompactCompleted || event.type === SessionEventType.CompactFailed);
      expect(compact.map(event => event.type)).toEqual([SessionEventType.CompactStarted, SessionEventType.CompactCompleted, SessionEventType.CompactCompleted]);
      const payloads = compact.map(event => event.payload as Record<string, unknown>);
      expect(payloads[0]!.operationId).toBe(payloads[1]!.operationId);
      expect(payloads[2]!.operationId).not.toBe(payloads[0]!.operationId);
      for (const payload of payloads) {
        expect(payload).toMatchObject({ trigger: "auto", phase: "mid_turn", display: "separator" });
        for (const absent of ["preCompactTokenCount", "postCompactTokenCount", "truePostCompactTokenCount", "summaryMessageId", "boundaryId", "tailStartMessageId", "sourceCommandId"]) expect(payload[absent]).toBeUndefined();
      }
      const parts = [...new Map(store.savedParts.filter(part => part.type === "compaction" || part.metadata?.executionBackend === "codex").map(part => [part.id, part])).values()];
      expect(parts.map(part => part.type === "text" ? part.text : part.type)).toEqual(["before", "compaction", "after", "compaction"]);
      expect(new Set(parts.map(part => part.messageID)).size).toBe(1);
      expect(parts.filter(part => part.type === "compaction").map(part => part.timelineStatus)).toEqual(["completed", "completed"]);
      expect(store.savedMessages.find(message => message.id === parts[0]!.messageID)).toMatchObject({ providerId: "selected-provider", modelId: "selected-model", finish: "stop" });
      expect(result.events.filter(event => event.type === SessionEventType.TurnStarted)).toHaveLength(1);
      expect(result.events.filter(event => event.type === SessionEventType.TurnComplete)).toHaveLength(1);
      expect(modelFactory).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });

  it.each(["error", "cancel", "native-interrupted", "missing-completion"])("settles pending compact operations on %s without inferring success", async outcome => {
    const store = createRecordingMessageStore(); const controller = new AbortController();
    const { runtime, eventStore, sessionId, modelFactory } = fixture({ async execute(input) {
      const identity = { threadId: "thread", turnId: "turn", itemId: "complete" };
      await input.onEvent({ type: "contextCompactionCompleted", ...identity });
      await input.onEvent({ type: "textDelta", itemId: "before", delta: "before" });
      await input.onEvent({ type: "contextCompactionStarted", ...identity, itemId: "pending" });
      if (outcome === "error") throw new Error("private provider detail");
      if (outcome === "cancel") { controller.abort(); input.signal.throwIfAborted(); }
      if (outcome === "native-interrupted") throw Object.assign(new Error("native interrupted"), { name: "AbortError" });
      return { text: "before", threadId: "thread", toolCallCount: 0 };
    } }, { sessionStore: store as unknown as SessionStorePort });
    const turn = runtime.executeTurn("compact pending", undefined, { abortSignal: controller.signal });
    if (outcome === "missing-completion") await turn; else await expect(turn).rejects.toBeDefined();
    const events = await eventStore.getEvents(sessionId);
    const compact = events.filter(event => event.type === SessionEventType.CompactStarted || event.type === SessionEventType.CompactCompleted || event.type === SessionEventType.CompactFailed);
    expect(compact.map(event => event.type)).toEqual([SessionEventType.CompactCompleted, SessionEventType.CompactStarted, SessionEventType.CompactFailed]);
    expect(compact.at(-1)!.payload).toMatchObject({ status: outcome === "error" ? "failed" : "interrupted", reason: outcome === "error" ? "api_error" : outcome === "missing-completion" ? "unknown" : "cancelled" });
    expect(JSON.stringify(compact)).not.toContain("private provider detail");
    const parts = [...new Map(store.savedParts.filter(part => part.type === "compaction").map(part => [part.id, part])).values()];
    expect(parts.map(part => part.timelineStatus)).toEqual(["completed", outcome === "error" ? "failed" : "interrupted"]);
    expect(parts.every(part => typeof part.time.end === "number")).toBe(true);
    expect(modelFactory).not.toHaveBeenCalled();
  });

  it.each(["failure", "abort"])("drains an in-flight compact start before %s terminal cleanup", async outcome => {
    const eventStore = createTestSessionEventStore(); const controller = new AbortController();
    const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
    const append = eventStore.append.bind(eventStore);
    vi.spyOn(eventStore, "append").mockImplementation(async event => {
      if (event.type === SessionEventType.CompactStarted) { entered.resolve(); await release.promise; }
      return append(event);
    });
    let delivery: Promise<void> | undefined;
    const { runtime, sessionId } = fixture({ async execute(input) {
      delivery = input.onEvent({ type: "contextCompactionStarted", threadId: "thread", turnId: "turn", itemId: "pending" });
      await entered.promise;
      // 模拟 app-server 连接在 Core 事件持久化期间失败/取消，而非等待 onEvent 完成。
      if (outcome === "abort") { controller.abort(); input.signal.throwIfAborted(); }
      throw new Error("transport closed");
    } }, { eventStore });
    const turn = runtime.executeTurn("in-flight compact", undefined, { abortSignal: controller.signal });
    const settled = turn.then(() => "resolved", () => "rejected");
    await entered.promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    release.resolve();
    expect(await settled).toBe("rejected");
    await delivery;
    const events = (await eventStore.getEvents(sessionId)).filter(event => event.type === SessionEventType.CompactStarted || event.type === SessionEventType.CompactFailed);
    expect(events.map(event => event.type)).toEqual([SessionEventType.CompactStarted, SessionEventType.CompactFailed]);
    expect(events.at(-1)!.payload).toMatchObject({ status: outcome === "abort" ? "interrupted" : "failed" });
  });

  it("recovers a native started marker as interrupted without rewriting its assistant", async () => {
    const store = createRecordingMessageStore();
    const { runtime } = fixture({ async execute() { return { text: "", threadId: "thread", toolCallCount: 0 }; } }, { sessionStore: store as unknown as SessionStorePort });
    const { recoverInterruptedCompactTimelines } = await import("../src/runtime/methods/compact-persistence.js");
    const part = { id: "native-compact-part", sessionID: "native-session", messageID: "native-assistant", type: "compaction", auto: true, operationId: "native-operation", timelineStatus: "started", time: { start: 1 }, metadata: { executionBackend: "codex", nativeThreadId: "thread", nativeTurnId: "turn", nativeItemId: "item" } };
    const message = { info: { id: part.messageID, role: "assistant", modelId: "chosen-model", providerId: "chosen-provider", time: { created: 1 } }, parts: [part] };
    expect(await recoverInterruptedCompactTimelines.call(runtime as never, [message] as never, {} as never)).toBe(1);
    expect(part).toMatchObject({ timelineStatus: "interrupted", reason: "cancelled", time: { start: 1, end: expect.any(Number) } });
    expect(store.savedMessages).toHaveLength(0);
    expect(store.savedParts).toHaveLength(1);
    expect(store.savedParts[0]).toMatchObject({ id: part.id, messageID: part.messageID, timelineStatus: "interrupted", metadata: part.metadata });
  });
  it.each([false, true])("persists text/tool/text segments with stable order (same item: %s)", async sameItem => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    try {
      const store = createRecordingMessageStore();
      const { runtime } = fixture({ async execute(input) {
        await input.onEvent({ type: "textStarted", itemId: "before" });
        await input.onEvent({ type: "textDelta", itemId: "before", delta: "will send" });
        if (!sameItem) await input.onEvent({ type: "textCompleted", itemId: "before" });
        for (const id of ["tool-a", "tool-b"]) {
          await input.onEvent({ type: "toolStarted", id, name: "Bash", input: {} });
          await input.onEvent({ type: "toolStarted", id, name: "Bash", input: {} });
        }
        for (const id of ["tool-b", "tool-a"]) {
          await input.onEvent({ type: "toolCompleted", id, name: "Bash", output: "ok" });
        }
        const itemId = sameItem ? "before" : "after";
        await input.onEvent({ type: "textStarted", itemId });
        await input.onEvent({ type: "textStarted", itemId });
        await input.onEvent({ type: "textDelta", itemId, delta: "executed success" });
        await input.onEvent({ type: "textCompleted", itemId });
        await input.onEvent({ type: "textCompleted", itemId });
        return { text: "will sendexecuted success", threadId: "thread", toolCallCount: 2 };
      } }, { sessionStore: store as unknown as SessionStorePort });
      const result = await runtime.executeTurn("chronology");
      const parts = [...new Map(store.savedParts.filter(part => part.type === "tool" || part.metadata?.executionBackend === "codex").map(part => [part.id, part])).values()];
      expect(parts.map(part => part.type === "text" ? part.text : part.callID)).toEqual(["will send", "tool-a", "tool-b", "executed success"]);
      expect(new Set(parts.map(part => part.messageID)).size).toBe(1);
      expect(new Set(parts.map(part => part.id)).size).toBe(4);
      const chronology = result.events.flatMap(event => {
        const payload = event.payload as { kind?: string; delta?: string; toolCallId?: string };
        if (event.type === SessionEventType.ModelStreaming && payload.kind !== "text_delta") return [payload.kind];
        if (event.type === SessionEventType.ToolCallScheduled) return [payload.toolCallId];
        return [];
      });
      expect(chronology).toEqual(["text_start", "text_end", "tool-a", "tool-b", "text_start", "text_end"]);
    } finally { clock.mockRestore(); }
  });

  it("omits empty text parts and rows in a tool-only turn", async () => {
    const store = createRecordingMessageStore();
    const { runtime } = fixture({ async execute(input) {
      await input.onEvent({ type: "textStarted", itemId: "empty" });
      await input.onEvent({ type: "textDelta", itemId: "empty", delta: "" });
      await input.onEvent({ type: "textCompleted", itemId: "empty" });
      await input.onEvent({ type: "toolStarted", id: TOOL_ID, name: "Bash", input: {} });
      await input.onEvent({ type: "toolCompleted", id: TOOL_ID, name: "Bash", output: "ok" });
      return { text: "", threadId: "thread", toolCallCount: 1 };
    } }, { sessionStore: store as unknown as SessionStorePort });
    const result = await runtime.executeTurn("tool only");
    expect(store.savedParts.some(part => part.metadata?.executionBackend === "codex")).toBe(false);
    expect(result.events.some(event => event.type === SessionEventType.ModelStreaming)).toBe(false);
  });

  it.each(["suffix", "mismatch", "failure", "cancel"])("preserves separate observed parts on %s", async outcome => {
    const store = createRecordingMessageStore();
    const controller = new AbortController();
    const { runtime, modelFactory, eventStore, sessionId } = fixture({ async execute(input) {
      await input.onEvent({ type: "textDelta", itemId: "before", delta: "before" });
      await input.onEvent({ type: "toolStarted", id: TOOL_ID, name: "Bash", input: {} });
      await input.onEvent({ type: "textDelta", itemId: "after", delta: "partial" });
      if (outcome === "failure") throw new Error("disconnected");
      if (outcome === "cancel") { controller.abort(); input.signal.throwIfAborted(); }
      return { text: outcome === "mismatch" ? "wrong" : "beforepartial suffix", threadId: "thread", toolCallCount: 1 };
    } }, { sessionStore: store as unknown as SessionStorePort });
    const turn = runtime.executeTurn("segments", undefined, { abortSignal: controller.signal });
    if (outcome === "suffix") await turn;
    else await expect(turn).rejects.toBeDefined();
    const parts = [...new Map(store.savedParts.filter(part => part.type === "tool" || part.metadata?.executionBackend === "codex").map(part => [part.id, part])).values()];
    expect(parts.map(part => part.type === "text" ? part.text : part.callID)).toEqual(outcome === "suffix" ? ["before", TOOL_ID, "partial", " suffix"] : ["before", TOOL_ID, "partial"]);
    if (outcome === "cancel" || outcome === "failure" || outcome === "mismatch") {
      const partial = parts.at(-1)!;
      expect(partial.time.start).toEqual(expect.any(Number));
      expect(partial.time.end).toBeUndefined();
      const persisted = store.savedMessages.filter(message => message.role === "assistant").at(-1)!;
      expect(persisted.error).toMatchObject(outcome === "cancel"
        ? { name: "AbortError", data: { turnResult: "cancelled" } }
        : { name: "Error" });
      const events = await eventStore.getEvents(sessionId);
      expect(events.filter(event => event.type === SessionEventType.ModelStreaming && (event.payload as { kind?: string }).kind === "text_end")).toHaveLength(1);
    }
    expect(modelFactory).not.toHaveBeenCalled();
  });

  it.each([
    ["yolo", false, "allow"],
    ["yolo", true, "deny"],
    ["build", true, "deny"],
  ] as const)("handles %s plan=%s without broker or permission events", async (mode, planEnabled, decision) => {
    const broker = pendingBroker(); const decisions: string[] = [];
    const execute = vi.fn<NativeTurnExecutor["execute"]>(approvalExecutor(decisions).execute);
    const { runtime, eventStore, sessionId } = fixture({ execute }, { permissionBroker: broker.broker });
    runtime.updateConfig({ mode, planEnabled });
    await runtime.executeTurn("mode test", undefined, { inputId: INPUT_ID });
    expect(execute.mock.calls[0]![0].permission).toEqual({ mode, planEnabled });
    expect(decisions).toEqual([decision]);
    expect(broker.broker.requestPermission).not.toHaveBeenCalled();
    expect((await eventStore.getEvents(sessionId)).some(event => event.type === SessionEventType.PermissionRequested || event.type === SessionEventType.PermissionResolved)).toBe(false);
  });

  it.each([
    ["build to yolo", { mode: "build", planEnabled: false }, { mode: "yolo", planEnabled: false }, { mode: "yolo", planEnabled: false }, true],
    ["yolo to build", { mode: "yolo", planEnabled: false }, { mode: "build", planEnabled: false }, { mode: "build", planEnabled: false }, true],
    ["omitted mode", { mode: "yolo", planEnabled: false }, {}, { mode: "yolo", planEnabled: false }, false],
    ["plan enabled", { mode: "yolo", planEnabled: false }, { planEnabled: true }, { mode: "yolo", planEnabled: true }, true],
    ["plan disabled", { mode: "yolo", planEnabled: true }, { planEnabled: false }, { mode: "yolo", planEnabled: false }, true],
    ["legacy plan", { mode: "yolo", planEnabled: false }, { mode: "plan" }, { mode: "yolo", planEnabled: true }, true],
  ] as const)("consumes submitted execution state before native capture (%s)", async (_label, initial, submitted, expected, changed) => {
    const execute = vi.fn<NativeTurnExecutor["execute"]>(async () => ({ text: "done", threadId: "codex-thread", toolCallCount: 0 }));
    const saveSessionEntry = vi.fn<SessionStorePort["saveSessionEntry"]>(async entry => entry);
    const store = { ...createRecordingMessageStore(), saveSessionEntry };
    const { runtime, eventStore, sessionId, modelFactory } = fixture({ execute }, { sessionStore: store as unknown as SessionStorePort });
    runtime.updateConfig(initial);
    await runtime.executeTurn("submitted mode", undefined, {
      inputId: INPUT_ID,
      intent: {
        sourceCommandId: INPUT_ID, queueItemId: INPUT_ID, clientId: "mobile-mode-regression", kind: "sendText",
        admissionSeq: 1, admittedAt: Date.now(), requestedDelivery: "auto", admittedDelivery: "startNow",
        // 与 V4 一样携带 Selection；native 应只消费 Mode/Plan，不能创建 ZCode Model。
        modelSelection: { providerId: "test", modelId: "must-not-create" },
        ...submitted,
      },
    });
    expect(execute.mock.calls[0]![0].permission).toEqual(expected);
    expect(execute.mock.calls[0]![0].modelSelection).toEqual({ providerId: "test", modelId: "must-not-create" });
    expect({ mode: runtime.getMode(), planEnabled: runtime.getPlanEnabled() }).toEqual(expected);
    const events = await eventStore.getEvents(sessionId);
    const changes = events.filter(event => event.type === SessionEventType.SessionModeChanged);
    expect(changes).toHaveLength(changed ? 1 : 0);
    if (changed) {
      expect(changes[0]!.payload).toMatchObject({ ...expected, previousMode: initial.mode, previousPlanEnabled: initial.planEnabled, source: "command" });
      expect(events.indexOf(changes[0]!)).toBeLessThan(events.findIndex(event => event.type === SessionEventType.TurnStarted));
      expect(saveSessionEntry).toHaveBeenCalledWith(expect.objectContaining({ id: `${sessionId}:runtime-execution-state`, data: expected }));
    }
    expect(modelFactory).not.toHaveBeenCalled();
  });

  it("captures current mode per turn and keeps an in-flight yolo snapshot stable", async () => {
    const broker = pendingBroker(); const decisions: string[] = [];
    let runtime: ReturnType<typeof fixture>["runtime"];
    const permissions: unknown[] = [];
    const native = approvalExecutor(decisions);
    const setup = fixture({ execute: async input => {
      permissions.push(input.permission);
      if (permissions.length === 1) runtime.updateConfig({ mode: "build" });
      return native.execute(input);
    } }, { permissionBroker: broker.broker });
    runtime = setup.runtime;
    runtime.updateConfig({ mode: "yolo" });
    runtime.subscribeEvents({ onSessionEvent(event) {
      if (event.type === SessionEventType.PermissionRequested) broker.resolve((event.payload as PermissionRequestedPayload).requestId!, { decision: "deny" });
    } });
    await runtime.executeTurn("first", undefined, { inputId: "first" });
    await runtime.executeTurn("second", undefined, { inputId: "second" });
    expect(permissions).toEqual([{ mode: "yolo", planEnabled: false }, { mode: "build", planEnabled: false }]);
    expect(decisions).toEqual(["allow", "deny"]);
    expect(broker.broker.requestPermission).toHaveBeenCalledOnce();
    expect(broker.broker.requestPermission.mock.calls[0]![0].mode).toBe("build");
  });

  it.each(["guarded", "edit", "auto"] as const)("retains explicit broker approval in %s", async mode => {
    const broker = pendingBroker(); const decisions: string[] = [];
    const { runtime } = fixture(approvalExecutor(decisions), { permissionBroker: broker.broker });
    runtime.updateConfig({ mode });
    runtime.subscribeEvents({ onSessionEvent(event) {
      if (event.type === SessionEventType.PermissionRequested) broker.resolve(REQUEST_ID, { decision: "deny" });
    } });
    await runtime.executeTurn("approval", undefined, { inputId: INPUT_ID });
    expect(decisions).toEqual(["deny"]);
    expect(broker.broker.requestPermission).toHaveBeenCalledOnce();
  });

  it("persists and publishes A-B-B selections and exact assistant identity without a Model", async () => {
    const saveSessionEntry = vi.fn<SessionStorePort["saveSessionEntry"]>(async entry => entry);
    const store = { ...createRecordingMessageStore(), saveSessionEntry };
    const execute = vi.fn<NativeTurnExecutor["execute"]>(async input => {
      await input.onEvent({ type: "textDelta", itemId: "native-answer", delta: "answer" });
      return { text: "answer", threadId: "native-thread", toolCallCount: 0 };
    });
    const { runtime, modelFactory, eventStore, sessionId } = fixture({ execute }, { sessionStore: store as unknown as SessionStorePort });
    const selections = [
      { providerId: "provider-a", modelId: "model-a", options: { reasoningLevel: "high" } },
      { providerId: "provider-b", modelId: "deepseek-v4.1-flash", options: { reasoningLevel: "xhigh" } },
      { providerId: "provider-b", modelId: "deepseek-v4.1-flash", options: { reasoningLevel: "low" } },
    ];
    for (const [index, selection] of selections.entries()) {
      const id = "selection-" + index;
      await runtime.executeTurn("selection", undefined, { inputId: id, intent: {
        sourceCommandId: id, queueItemId: id, clientId: "native-regression", kind: "sendText",
        admissionSeq: index + 1, admittedAt: Date.now(), requestedDelivery: "auto", admittedDelivery: "startNow", modelSelection: selection,
      } });
      expect(runtime.getSessionModelSelection()).toEqual(selection);
      expect(saveSessionEntry).toHaveBeenCalledWith(expect.objectContaining({ type: "runtime/model_selection", data: selection }));
    }
    await runtime.executeTurn("omitted selection", undefined, { inputId: "selection-omitted" });
    expect(execute.mock.calls.map(([input]) => input.modelSelection)).toEqual([...selections, selections[2]]);
    const streamed = (await eventStore.getEvents(sessionId)).filter(event => event.type === SessionEventType.ModelStreaming && (event.payload as { kind?: string }).kind === "text_start");
    expect(streamed.map(event => (event.payload as { model?: string }).model)).toEqual([...selections, selections[2]].map(selection => selection!.providerId + "/" + selection!.modelId));
    const events = await eventStore.getEvents(sessionId);
    expect(events.filter(event => event.type === SessionEventType.ModelSelected).map(event => event.payload)).toEqual(selections.map(selection => expect.objectContaining({ modelSelection: selection, effectiveReasoningLevel: selection.options.reasoningLevel })));
    expect(store.savedMessages.filter(message => message.role === "assistant").map(message => ({ providerId: message.providerId, modelId: message.modelId }))).toEqual([...selections, selections[2]].map(selection => ({ providerId: selection!.providerId, modelId: selection!.modelId })));
    expect(modelFactory).not.toHaveBeenCalled();
  });

  it("keeps native turns outside the model factory and preserves event ordering", async () => {
    const execute = vi.fn<NativeTurnExecutor["execute"]>(async (input) => {
      await input.onEvent({ type: "textDelta", itemId: "native-text", delta: "Native answer" });
      return { text: "Native answer", threadId: "codex-thread", toolCallCount: 0 };
    });
    const { runtime, modelFactory } = fixture({ execute });
    const result = await runtime.executeTurn("hello", undefined, { inputId: "native-input" });
    expect(result.response).toBe("Native answer");
    expect(modelFactory).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
    const types = result.events.map((event) => event.type);
    expect(types.indexOf(SessionEventType.TurnStarted)).toBeLessThan(
      types.indexOf(SessionEventType.ModelStreaming),
    );
    expect(types.indexOf(SessionEventType.AssistantMessage)).toBeLessThan(
      types.indexOf(SessionEventType.TurnComplete),
    );
    expect(types.filter((type) => type === SessionEventType.TurnComplete)).toHaveLength(1);
  });

  it.each(["describe this picture", ""])("passes resolved image bytes to native execution and persists its user file part (%s)", async text => {
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=";
    const execute = vi.fn<NativeTurnExecutor["execute"]>(async () => ({ text: "image received", threadId: "codex-thread", toolCallCount: 0 }));
    const store = createRecordingMessageStore();
    const { runtime, modelFactory } = fixture({ execute }, { sessionStore: store as unknown as SessionStorePort });
    const result = await runtime.executeTurn(text, [{ type: "image", content: image, filename: "phone-upload.png", mimeType: "image/png" }], { inputId: "image-input" });
    expect(result.response).toBe("image received");
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]![0].attachments).toEqual([expect.objectContaining({ type: "image", dataUrl: image, mediaType: "image/png" })]);
    expect(store.savedParts).toContainEqual(expect.objectContaining({ type: "file", mime: "image/png" }));
    expect(result.events.find(e => e.type === SessionEventType.TurnStarted)?.payload).toEqual(expect.objectContaining({ attachments: [expect.objectContaining({ fileName: "phone-upload.png" })] }));
    expect(modelFactory).not.toHaveBeenCalled();
  });

  it("resolves a Web upload artifact instead of sending its URI to Codex", async () => {
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=";
    const execute = vi.fn<NativeTurnExecutor["execute"]>(async () => ({ text: "uploaded image", threadId: "codex-thread", toolCallCount: 0 }));
    const readToolResultArtifact = vi.fn(async () => ({ content: image }));
    const writeToolResultArtifact = vi.fn();
    const store = createRecordingMessageStore();
    const { runtime } = fixture({ execute }, {
      sessionStore: store as unknown as SessionStorePort,
      artifactStore: { readToolResultArtifact, writeToolResultArtifact } as never,
    });
    await runtime.executeTurn("describe", [{ type: "image", content: "zcode-artifact://phone-upload", filename: "upload.png", mimeType: "image/png" }]);
    expect(readToolResultArtifact).toHaveBeenCalledOnce();
    expect(writeToolResultArtifact).not.toHaveBeenCalled();
    expect(execute.mock.calls[0]![0].attachments).toEqual([expect.objectContaining({ type: "image", dataUrl: image })]);
    expect(store.savedParts).toContainEqual(expect.objectContaining({ type: "file", url: "zcode-artifact://phone-upload" }));
  });

  it("fails an unreadable uploaded image before native execution rather than dropping it", async () => {
    const execute = vi.fn<NativeTurnExecutor["execute"]>();
    const { runtime, modelFactory } = fixture({ execute }, { artifactStore: { readToolResultArtifact: vi.fn(async () => { throw new Error("artifact unavailable"); }) } as never });
    await expect(runtime.executeTurn("describe", [{ type: "image", content: "zcode-artifact://missing", mimeType: "image/png" }])).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringContaining("attachment could not be read") }) });
    expect(execute).not.toHaveBeenCalled();
    expect(modelFactory).not.toHaveBeenCalled();
  });

  it("reads a local image through Core before passing bytes to native execution", async () => {
    const path = join(process.cwd(), "frame.png");
    const content = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAsSURBVFhH7c4hAQAADASh61/6F2MGgafVPgkICAgICAgICAgICAgICDwH2gFUDfhqkE3cCgAAAABJRU5ErkJggg==";
    const execute = vi.fn<NativeTurnExecutor["execute"]>(async () => ({ text: "local image", threadId: "codex-thread", toolCallCount: 0 }));
    const readTextFile = vi.fn(async () => ({ path, content, encoding: "base64", bytesRead: 154, sizeBytes: 154, truncated: false }));
    const { runtime, modelFactory } = fixture({ execute }, {
      fileSystemPort: { stat: async () => ({ path, kind: "file", mtimeMs: 1, sizeBytes: 154 }), readTextFile } as never,
    });
    await runtime.executeTurn("describe local image", [{ type: "image", path: "frame.png" }]);
    expect(readTextFile).toHaveBeenCalledWith(expect.objectContaining({ path, encoding: "base64" }), expect.any(Object));
    expect(execute.mock.calls[0]![0].attachments).toEqual([expect.objectContaining({ type: "image", dataUrl: `data:image/png;base64,${content}` })]);
    expect(modelFactory).not.toHaveBeenCalled();
  });

  it.each(["allow", "deny", "modify", "escalate"] as const)(
    "registers before an immediate %s answer and persists matching permission events",
    async (decision) => {
      const broker = pendingBroker();
      const decisions: string[] = [];
      const store = createRecordingMessageStore();
      const { runtime, eventStore, sessionId, modelFactory } = fixture(
        approvalExecutor(decisions),
        {
          permissionBroker: broker.broker,
          sessionStore: store as unknown as SessionStorePort,
        },
      );
      const observed: PermissionRequestedPayload[] = [];
      runtime.subscribeEvents({
        async onSessionEvent(event) {
          if (event.type !== SessionEventType.PermissionRequested) return;
          const payload = event.payload as PermissionRequestedPayload;
          observed.push(payload);
          expect(broker.pending.has(payload.requestId!)).toBe(true);
          expect(store.savedParts.find((part) => part.callID === TOOL_ID)?.state.status).toBe(
            "pending",
          );
          const replay = await eventStore.getEvents(sessionId);
          expect(replay.at(-1)).toMatchObject({
            id: event.id,
            sequenceNumber: event.sequenceNumber,
          });
          expect(new EventReducer().reduce(replay).pendingPermissions).toEqual([
            expect.objectContaining({ requestId: REQUEST_ID, toolCallId: TOOL_ID }),
          ]);
          // 根因回归：在事件发布调用栈内立即应答，不能丢失登记或等待下一次消息。
          broker.resolve(payload.requestId!, {
            decision,
            reason: "client answer",
            modifiedInput: { reviewed: true },
          });
        },
      });
      await runtime.executeTurn("approve native tool", undefined, { inputId: INPUT_ID });
      expect(observed).toEqual([
        {
          requestId: REQUEST_ID,
          toolCallId: TOOL_ID,
          toolName: "Bash",
          input: TOOL_INPUT,
          reason: "Native sandbox approval",
          riskLevel: "high",
          suggestedPermissionUpdates: [],
          approvalMode: "user-once",
          optionsPolicy: "no-always-allow",
        },
      ]);
      expect(decisions).toEqual([decision === "allow" ? "allow" : "deny"]);
      expect(broker.broker.requestPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          ...observed[0],
          sessionId,
          ruleId: "native-codex",
          mode: "build",
          requestedAt: expect.any(Date),
        }),
        { signal: expect.any(AbortSignal) },
      );
      const events = await eventStore.getEvents(sessionId);
      const permissions = events.filter(
        (event) =>
          event.type === SessionEventType.PermissionRequested ||
          event.type === SessionEventType.PermissionResolved,
      );
      expect(permissions.map((event) => event.type)).toEqual([
        SessionEventType.PermissionRequested,
        SessionEventType.PermissionResolved,
      ]);
      expect(permissions[1]!.payload).toEqual({
        requestId: REQUEST_ID,
        toolCallId: TOOL_ID,
        decision,
        reason: "client answer",
        modifiedInput: { reviewed: true },
      });
      expect(permissions[0]!.traceId).toBe(permissions[1]!.traceId);
      expect(permissions[0]!.turnId).toBe(permissions[1]!.turnId);
      expect(permissions[0]!.sequenceNumber).toBeLessThan(permissions[1]!.sequenceNumber);
      const types = events.map((event) => event.type);
      expect(types.indexOf(SessionEventType.ToolCallStarted)).toBeLessThan(
        types.indexOf(SessionEventType.PermissionRequested),
      );
      expect(types.indexOf(SessionEventType.PermissionResolved)).toBeLessThan(
        types.indexOf(SessionEventType.ToolCallResult),
      );
      expect(new EventReducer().reduce(events).pendingPermissions).toEqual([]);
      expect(broker.pending.size).toBe(0);
      expect(modelFactory).not.toHaveBeenCalled();
    },
  );

  it("awaits asynchronous broker registration before publishing an approval", async () => {
    const broker = pendingBroker(true);
    const decisions: string[] = [];
    const { runtime } = fixture(approvalExecutor(decisions), { permissionBroker: broker.broker });
    const requested = vi.fn();
    runtime.subscribeEvents({
      onSessionEvent(event) {
        if (event.type !== SessionEventType.PermissionRequested) return;
        requested();
        broker.resolve(REQUEST_ID, { decision: "allow" });
      },
    });
    const turn = runtime.executeTurn("approve", undefined, { inputId: INPUT_ID });
    await broker.called;
    expect(requested).not.toHaveBeenCalled();
    broker.register();
    await turn;
    expect(requested).toHaveBeenCalledOnce();
    expect(decisions).toEqual(["allow"]);
    expect(broker.pending.size).toBe(0);
  });

  it("does not wait for a stalled registration after broker failure", async () => {
    const registered = Promise.withResolvers<void>();
    const failure = new Error("registration transport failed");
    const broker: PermissionBrokerPort = {
      requestPermission: () =>
        Object.assign(Promise.reject(failure), { registered: registered.promise }),
    };
    const { runtime, eventStore, sessionId } = fixture(approvalExecutor([]), {
      permissionBroker: broker,
    });
    await expect(
      runtime.executeTurn("approve", undefined, { inputId: INPUT_ID }),
    ).rejects.toBeDefined();
    // 失败后迟到的登记不能重新打开卡片；不靠 timeout 等待登记完成。
    registered.resolve();
    await Promise.resolve();
    const events = await eventStore.getEvents(sessionId);
    expect(events.some((event) => event.type === SessionEventType.PermissionRequested)).toBe(false);
    expect(new EventReducer().reduce(events).pendingPermissions).toEqual([]);
  });

  it("cancels while broker registration is stalled without publishing a late card", async () => {
    const broker = pendingBroker(true);
    const controller = new AbortController();
    const { runtime, eventStore, sessionId } = fixture(approvalExecutor([]), {
      permissionBroker: broker.broker,
    });
    const turn = runtime.executeTurn("approve", undefined, {
      inputId: INPUT_ID,
      abortSignal: controller.signal,
    });
    const outcome = expect(turn).rejects.toMatchObject({ type: CoreErrorType.TurnCancelled });
    await broker.called;
    controller.abort(new Error("user cancelled"));
    await outcome;
    broker.register();
    await Promise.resolve();
    const events = await eventStore.getEvents(sessionId);
    expect(events.some((event) => event.type === SessionEventType.PermissionRequested)).toBe(false);
    expect(broker.pending.size).toBe(0);
  });

  it("closes pending approval on cancellation and persists partial native output", async () => {
    const broker = pendingBroker();
    const controller = new AbortController();
    const store = createRecordingMessageStore();
    const afterApproval = vi.fn();
    const { runtime, eventStore, sessionId, modelFactory } = fixture(
      {
        async execute(input) {
          await input.onEvent({ type: "textDelta", itemId: "native-text", delta: "Partial native answer" });
          await input.onEvent({
            type: "toolStarted",
            id: TOOL_ID,
            name: "Bash",
            input: TOOL_INPUT,
          });
          await input.requestApproval(APPROVAL);
          afterApproval();
          return { text: "unexpected", threadId: "thread", toolCallCount: 1 };
        },
      },
      { permissionBroker: broker.broker, sessionStore: store as unknown as SessionStorePort },
    );
    runtime.subscribeEvents({
      onSessionEvent(event) {
        if (event.type === SessionEventType.PermissionRequested)
          controller.abort(new Error("user cancelled"));
      },
    });
    await expect(
      runtime.executeTurn("approve", undefined, {
        inputId: INPUT_ID,
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({ type: CoreErrorType.TurnCancelled });
    const events = await eventStore.getEvents(sessionId);
    expect(
      events
        .filter((event) => event.type === SessionEventType.PermissionResolved)
        .map((event) => event.payload),
    ).toEqual([
      {
        requestId: REQUEST_ID,
        toolCallId: TOOL_ID,
        decision: "deny",
        reason: "Native approval cancelled",
        modifiedInput: undefined,
      },
    ]);
    expect(new EventReducer().reduce(events).pendingPermissions).toEqual([]);
    expect(broker.aborts).toHaveBeenCalledOnce();
    expect(broker.pending.size).toBe(0);
    expect(afterApproval).not.toHaveBeenCalled();
    expect(store.savedParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: "Partial native answer",
          metadata: { executionBackend: "codex", nativeItemId: "native-text" },
        }),
        expect.objectContaining({
          type: "tool",
          callID: TOOL_ID,
          state: expect.objectContaining({ status: "error", error: "Native turn cancelled" }),
        }),
      ]),
    );
    expect(events.at(-1)).toMatchObject({
      type: SessionEventType.TurnComplete,
      payload: { resultType: "cancelled" },
    });
    expect(modelFactory).not.toHaveBeenCalled();
  });

  it("resolves a published approval as deny when the broker fails", async () => {
    const broker = pendingBroker();
    const { runtime, eventStore, sessionId } = fixture(approvalExecutor([]), {
      permissionBroker: broker.broker,
    });
    runtime.subscribeEvents({
      onSessionEvent(event) {
        if (event.type === SessionEventType.PermissionRequested)
          broker.reject(REQUEST_ID, new Error("approval channel failed"));
      },
    });
    await expect(
      runtime.executeTurn("approve", undefined, { inputId: INPUT_ID }),
    ).rejects.toBeDefined();
    const events = await eventStore.getEvents(sessionId);
    const resolved = events.filter((event) => event.type === SessionEventType.PermissionResolved);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.payload).toMatchObject({
      requestId: REQUEST_ID,
      toolCallId: TOOL_ID,
      decision: "deny",
      reason: "approval channel failed",
    });
    expect(new EventReducer().reduce(events).pendingPermissions).toEqual([]);
    expect(broker.pending.size).toBe(0);
  });

  it("cancels the registered broker if publishing the approval fails", async () => {
    const broker = pendingBroker();
    const eventStore = createTestSessionEventStore();
    const append = eventStore.append.bind(eventStore);
    vi.spyOn(eventStore, "append").mockImplementation(async (event) => {
      if (event.type === SessionEventType.PermissionRequested)
        throw new Error("approval persistence failed");
      return append(event);
    });
    const { runtime } = fixture(approvalExecutor([]), {
      permissionBroker: broker.broker,
      eventStore,
    });
    await expect(
      runtime.executeTurn("approve", undefined, { inputId: INPUT_ID }),
    ).rejects.toBeDefined();
    expect(broker.aborts).toHaveBeenCalledOnce();
    expect(broker.pending.size).toBe(0);
  });

  it("rejects approval without a previously persisted tool start", async () => {
    const broker = pendingBroker();
    const { runtime, eventStore, sessionId } = fixture(
      {
        async execute(input) {
          await input.requestApproval(APPROVAL);
          return { text: "unexpected", threadId: "thread", toolCallCount: 0 };
        },
      },
      { permissionBroker: broker.broker },
    );
    await expect(runtime.executeTurn("approve")).rejects.toBeDefined();
    expect(broker.broker.requestPermission).not.toHaveBeenCalled();
    const events = await eventStore.getEvents(sessionId);
    expect(events.some((event) => event.type === SessionEventType.PermissionRequested)).toBe(false);
  });

  it("reuses session identity across native turns without invoking the model", async () => {
    const sessions: string[] = [];
    const { runtime, modelFactory } = fixture({
      execute: async (input) => {
        sessions.push(input.sessionId);
        return { text: "done", threadId: "codex-thread", toolCallCount: 0 };
      },
    });
    await runtime.executeTurn("first");
    await runtime.executeTurn("second");
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toBe(sessions[1]);
    expect(modelFactory).not.toHaveBeenCalled();
  });

  it.each([undefined, "NATIVE_CODEX_UNSUPPORTED_INTERACTION", "NATIVE_CODEX_FINAL_TEXT_MISMATCH", "NATIVE_CODEX_RESPONSE_STREAM_FAILED", "NATIVE_CODEX_AUTH_SOURCE_MISMATCH", "NATIVE_CODEX_SUBSCRIPTION_AUTH_REQUIRED", "NATIVE_CODEX_SUBSCRIPTION_MODEL_UNAVAILABLE"])("logs safe structured failure diagnostics (%s)", async code => {
    const warn = vi.fn();
    const logger = { warn, debug: vi.fn(), info: vi.fn(), error: vi.fn(), child: vi.fn() };
    logger.child.mockReturnValue(logger);
    const failure = Object.assign(new Error("secret-key and raw user command"), { code });
    const { runtime } = fixture({ execute: async () => { throw failure; } }, { logger });
    await expect(runtime.executeTurn("private user input", undefined, { inputId: "diagnostic-input" })).rejects.toBeDefined();
    expect(warn).toHaveBeenCalledWith("native_codex.turn.failed", expect.objectContaining({
      mode: "build", planEnabled: false, inputId: "diagnostic-input",
      error: expect.objectContaining({ code: code ?? "NATIVE_CODEX_TURN_FAILED" }),
    }));
    const diagnostic = warn.mock.calls.find(([event]) => event === "native_codex.turn.failed");
    expect(JSON.stringify(diagnostic)).not.toContain("secret-key");
    expect(JSON.stringify(diagnostic)).not.toContain("private user input");
  });

  it.each([100, 502, 599, 99, 600, 502.5, "502", null, undefined])("logs only validated response stream status %s with a fixed safe message", async httpStatusCode => {
    const warn = vi.fn();
    const logger = { warn, debug: vi.fn(), info: vi.fn(), error: vi.fn(), child: vi.fn() };
    logger.child.mockReturnValue(logger);
    const failure = Object.assign(new Error("secret-key and raw provider response"), {
      code: "NATIVE_CODEX_RESPONSE_STREAM_FAILED", httpStatusCode, additionalDetails: "private-provider-details",
    });
    const { runtime, modelFactory } = fixture({ execute: async () => { throw failure; } }, { logger });
    await expect(runtime.executeTurn("private user input")).rejects.toBeDefined();
    const diagnostic = warn.mock.calls.find(([event]) => event === "native_codex.turn.failed")?.[1];
    expect(diagnostic?.error).toMatchObject({
      code: "NATIVE_CODEX_RESPONSE_STREAM_FAILED",
      message: "Official Codex could not complete the response stream. Check the API provider and network before sending again.",
    });
    if (httpStatusCode === 100 || httpStatusCode === 502 || httpStatusCode === 599) {
      expect(diagnostic?.error).toHaveProperty("httpStatusCode", httpStatusCode);
    } else expect(diagnostic?.error).not.toHaveProperty("httpStatusCode");
    expect(JSON.stringify(diagnostic)).not.toMatch(/secret-key|raw provider response|private-provider-details|private user input/);
    expect(modelFactory).not.toHaveBeenCalled();
  });

  it("propagates native failure without falling back to the model", async () => {
    const { runtime, modelFactory } = fixture({
      execute: async () => {
        throw new Error("Codex disconnected");
      },
    });
    await expect(runtime.executeTurn("hello")).rejects.toBeDefined();
    expect(modelFactory).not.toHaveBeenCalled();
  });
});
