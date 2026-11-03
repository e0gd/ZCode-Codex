import { createMessageId, createPartId, SessionEventType } from "../deps.js";
import type { MessageId, SessionEvent, ToolCallId, TraceContext } from "../deps.js";
import type {
  CompactionPart,
  ModelSelection,
  ModelMessageContentBlock,
  Model,
  PermissionBrokerResult,
  PermissionRequestedPayload,
  PermissionResolvedPayload,
  NativeTurnApproval,
  NativeSubagentUpdate,
  NativeSubagentItem,
} from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../internal.js";
import { ASK_USER_QUESTION_TOOL_NAME, NativeAskUserQuestionInputSchema, nativeCodexChildSessionId, createSessionEvent, createTurnId } from "@zcode/contracts";
import { linkAbortSignal } from "../../tool/executor/timeout.js";

const NATIVE_APPROVAL_RULE_ID = "native-codex";
const NATIVE_APPROVAL_REASON = "Official Codex requests approval";

/** Native provider observations enter the same persisted event stream as regular turns. */
export async function executeNativeTurn(
  this: AgentRuntimeInternal,
  input: {
    text: string;
    attachments?: readonly ModelMessageContentBlock[];
    modelSelection?: ModelSelection;
    inputId: string;
    signal: AbortSignal;
    traceContext: TraceContext;
    userMessageId: MessageId;
    events: SessionEvent[];
  },
): Promise<{ text: string; threadId: string; toolCallCount: number }> {
  const executor = this.nativeTurnExecutor;
  if (!executor) throw new Error("Native turn executor is unavailable");
  // 原生执行必须使用本轮权限快照；此前硬编码审批让 Full access 仍弹出确认。
  const permission = { mode: this.getMode(), planEnabled: this.getPlanEnabled() };
  const assistantMessageId = createMessageId();
  const created = Date.now();
  // 使用本轮冻结的真实标识，不能回读之后提交的会话选型。
  const modelIdentity = input.modelSelection ? {
    providerId: input.modelSelection.providerId as Model["providerId"],
    modelId: input.modelSelection.modelId as Model["modelId"],
  } : undefined;
  let streamedText = "";
  let textSegment: { partId: ReturnType<typeof createPartId>; itemId: string; text: string; startedAt: number } | undefined;
  const startedTextItems = new Set<string>();
  const completedTextItems = new Set<string>();
  const tools = new Map<
    string,
    {
      partId: ReturnType<typeof createPartId>;
      input: Record<string, unknown>;
      name: string;
      startedAt: number;
      declarationIndex: number;
      completed: boolean;
    }
  >();
  const emit = async (type: SessionEvent["type"], payload: unknown): Promise<void> => {
    // 正文行从流事件取执行身份，不能只更新 config 或借用之后的选型。
    const eventPayload = type === SessionEventType.ModelStreaming && modelIdentity
      ? { ...(payload as Record<string, unknown>), model: modelIdentity.providerId + "/" + modelIdentity.modelId }
      : payload;
    const event = this.createEvent(type, eventPayload, input.traceContext);
    await this.appendEvent(event, input.traceContext);
    input.events.push(event);
  };
  const nativeChildren = createNativeChildWriter(this, input.traceContext, emit);
  const closeText = async (completed = true): Promise<void> => {
    const segment = textSegment;
    if (!segment) return;
    // 必须先插入前段文本再插入工具；存储的 part.sequence 才能在同毫秒及冷恢复时保序。
    await this.persistPart(
      {
        id: segment.partId,
        sessionID: this.sessionId,
        messageID: assistantMessageId,
        type: "text",
        text: segment.text,
        metadata: { executionBackend: "codex", nativeItemId: segment.itemId },
        time: { start: segment.startedAt, ...(completed ? { end: Date.now() } : {}) },
      },
      input.traceContext,
    );
    // 中断不能先发成功 text_end；由既有 TurnComplete/TurnError 将开放行收口为 interrupted。
    if (completed) await emit(SessionEventType.ModelStreaming, {
      delta: "", done: true, kind: "text_end", assistantMessageId, partId: segment.partId,
    });
    textSegment = undefined;
  };
  const compactions = new Map<string, CompactionPart>();
  let compactDelivery: Promise<void> = Promise.resolve();
  const publishCompaction = async (part: CompactionPart): Promise<void> => {
    // standalone writer 会重写 assistant 的语义、模型和父消息；原生通知只更新同轮有序 part。
    await this.persistPart(part, input.traceContext);
    await emit(
      part.timelineStatus === "started" ? SessionEventType.CompactStarted
        : part.timelineStatus === "completed" ? SessionEventType.CompactCompleted
          : SessionEventType.CompactFailed,
      {
        operationId: part.operationId, messageId: part.messageID, partId: part.id,
        status: part.timelineStatus, trigger: part.trigger, phase: part.phase, display: part.timelineDisplay,
        ...(part.reason ? { reason: part.reason } : {}),
        ...(part.time?.start !== undefined ? { startedAt: part.time.start } : {}),
        ...(part.time?.end !== undefined ? { endedAt: part.time.end } : {}),
      },
    );
  };
  const observeCompaction = async (event: { type: "contextCompactionStarted" | "contextCompactionCompleted"; threadId: string; turnId: string; itemId: string }): Promise<void> => {
    // JSON tuple 避免分隔符碰撞；运行中去重和终态均只由 Core 管理。
    const operationId = `native-codex:${JSON.stringify([event.threadId, event.turnId, event.itemId])}`;
    const existing = compactions.get(operationId);
    if (existing && (existing.timelineStatus !== "started" || event.type === "contextCompactionStarted")) return;
    if (!existing) await closeText();
    const now = Date.now();
    const part: CompactionPart = {
      ...(existing ?? {
        id: createPartId(), sessionID: this.sessionId, messageID: assistantMessageId, type: "compaction",
        auto: true, operationId, trigger: "auto", phase: "mid_turn", timelineDisplay: "separator",
        metadata: { executionBackend: "codex", nativeThreadId: event.threadId, nativeTurnId: event.turnId, nativeItemId: event.itemId },
      }),
      timelineStatus: event.type === "contextCompactionStarted" ? "started" : "completed",
      time: { start: existing?.time?.start ?? now, ...(event.type === "contextCompactionCompleted" ? { end: now } : {}) },
    };
    compactions.set(operationId, part);
    await publishCompaction(part);
  };
  const closePendingCompactions = async (status: "failed" | "interrupted", reason: string): Promise<void> => {
    for (const [operationId, part] of compactions) {
      if (part.timelineStatus !== "started") continue;
      const terminal: CompactionPart = { ...part, timelineStatus: status, reason, time: { start: part.time?.start, end: Date.now() } };
      compactions.set(operationId, terminal);
      await publishCompaction(terminal);
    }
  };
  const appendText = async (itemId: string, delta: string): Promise<void> => {
    if (!delta) return;
    if (textSegment?.itemId !== itemId) await closeText();
    if (!textSegment) {
      textSegment = { partId: createPartId(), itemId, text: "", startedAt: Date.now() };
      await emit(SessionEventType.ModelStreaming, {
        delta: "", done: false, kind: "text_start", assistantMessageId, partId: textSegment.partId,
      });
    }
    textSegment.text += delta;
    streamedText += delta;
    await emit(SessionEventType.ModelStreaming, {
      delta, done: false, kind: "text_delta", assistantMessageId, partId: textSegment.partId,
    });
  };
  await this.persistAssistantMessage(
    assistantMessageId,
    input.userMessageId,
    created,
    undefined,
    input.traceContext,
    modelIdentity as Model | undefined,
  );
  const requestInteraction = async (request: NativeTurnApproval, signal: AbortSignal): Promise<PermissionBrokerResult> => {
    signal.throwIfAborted();
    const tool = tools.get(request.toolCallId);
    if (!tool || tool.completed) {
      throw new Error(`Native approval has no pending tool: ${request.toolCallId}`);
    }
    const requestId = `${NATIVE_APPROVAL_RULE_ID}:${input.inputId}:${request.id}`;
    const payload: PermissionRequestedPayload = {
      requestId,
      // JSON-RPC id 只关联 broker；审批卡必须关联已持久化的 Codex item。
      toolCallId: request.toolCallId as ToolCallId,
      toolName: request.name,
      input: request.input,
      reason: request.reason ?? NATIVE_APPROVAL_REASON,
      riskLevel: request.name === ASK_USER_QUESTION_TOOL_NAME ? "low" : "high",
      approvalMode: "user-once",
      optionsPolicy: "no-always-allow",
      suggestedPermissionUpdates: [],
    };
    const controller = new AbortController();
    const unlink = linkAbortSignal(signal, controller);
    const cancellation = Promise.withResolvers<never>();
    const onAbort = () => cancellation.reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    let published = false;
    let resolved: PermissionBrokerResult = { decision: "deny" };
    try {
      // 先登记再发布（异步 broker 等 registered），否则同步 UI 应答会找不到待审批项。
      const response = this.permissionBroker.requestPermission(
        {
          ...payload,
          requestId,
          sessionId: this.sessionId,
          turnId: input.traceContext.turnId,
          traceId: input.traceContext.traceId,
          mode: permission.mode,
          ruleId: NATIVE_APPROVAL_RULE_ID,
          requestedAt: new Date(),
        },
        { signal: controller.signal },
      );
      const publish = async () => {
        if (response.registered) await response.registered;
        // 登记可能晚于取消/失败；不能重新发布已失效的审批。
        controller.signal.throwIfAborted();
        published = true;
        await emit(SessionEventType.PermissionRequested, payload);
      };
      // 与常规工具一样并行等待发布和应答；broker 登记失败或取消不被慢登记阻塞。
      const [, decision] = await Promise.race([
        Promise.all([publish(), response]),
        cancellation.promise,
      ]);
      signal.throwIfAborted();
      resolved = decision;
      // Codex 请求是用户一次性审批；不能沿用自动批准或把 modify/escalate 当作 allow。
      return decision;
    } catch (error) {
      resolved = {
        decision: "deny",
        reason: signal.aborted
          ? "Native approval cancelled"
          : error instanceof Error
            ? error.message
            : "Native approval failed",
      };
      throw error;
    } finally {
      controller.signal.removeEventListener("abort", onAbort);
      // 发布失败也必须撤销 broker 等待；不能留下重连后仍可应答的孤儿请求。
      controller.abort();
      unlink();
      if (published) {
        const resolution: PermissionResolvedPayload = {
          requestId,
          toolCallId: payload.toolCallId,
          decision: resolved.decision,
          reason: resolved.reason,
          modifiedInput: resolved.modifiedInput,
        };
        await emit(SessionEventType.PermissionResolved, resolution);
      }
    }
  };
  try {
    const result = await executor.execute({
      sessionId: this.sessionId,
      inputId: input.inputId,
      text: input.text,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      signal: input.signal,
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      permission,
      onEvent: async (event) => {
        input.signal.throwIfAborted();
        if (event.type === "subagentUpdated") {
          await nativeChildren.update(event);
        } else if (event.type === "contextCompactionStarted" || event.type === "contextCompactionCompleted") {
          compactDelivery = compactDelivery.then(() => observeCompaction(event));
          await compactDelivery;
        } else if (event.type === "textStarted") {
          if (startedTextItems.has(event.itemId)) return;
          startedTextItems.add(event.itemId);
          await closeText();
        } else if (event.type === "textDelta") {
          if (completedTextItems.has(event.itemId)) throw new Error("Native text arrived after item completion");
          startedTextItems.add(event.itemId);
          await appendText(event.itemId, event.delta);
        } else if (event.type === "textCompleted") {
          if (completedTextItems.has(event.itemId)) return;
          completedTextItems.add(event.itemId);
          if (textSegment?.itemId === event.itemId) await closeText();
        } else if (event.type === "toolStarted") {
          if (tools.has(event.id)) return;
          await closeText();
          const tool = {
            partId: createPartId(),
            input: event.input,
            name: event.name,
            startedAt: Date.now(),
            declarationIndex: tools.size,
            completed: false,
          };
          tools.set(event.id, tool);
          await this.persistPart(
            {
              id: tool.partId,
              sessionID: this.sessionId,
              messageID: assistantMessageId,
              type: "tool",
              callID: event.id,
              tool: event.name,
              declarationIndex: tool.declarationIndex,
              state: { status: "pending", input: event.input, raw: JSON.stringify(event.input) },
            },
            input.traceContext,
          );
          await emit(SessionEventType.ToolCallScheduled, {
            toolCallId: event.id,
            assistantMessageId,
            toolName: event.name,
            input: event.input,
            schedule: { parallelGroups: [[event.id]], executionOrder: [event.id] },
          });
          await emit(SessionEventType.ToolCallStarted, {
            toolCallId: event.id,
            toolName: event.name,
            startedAt: new Date(tool.startedAt),
          });
        } else {
          const tool = tools.get(event.id);
          if (!tool) throw new Error(`Native tool result has no start: ${event.id}`);
          if (tool.completed) return;
          const time = { start: tool.startedAt, end: Date.now() };
          await this.persistPart(
            {
              id: tool.partId,
              sessionID: this.sessionId,
              messageID: assistantMessageId,
              type: "tool",
              callID: event.id,
              tool: event.name,
              declarationIndex: tool.declarationIndex,
              state: event.failed
                ? { status: "error", input: tool.input, error: event.output, time }
                : {
                    status: "completed",
                    input: tool.input,
                    output: event.output,
                    title: event.name,
                    metadata: {},
                    time,
                  },
            },
            input.traceContext,
          );
          tool.completed = true;
          await emit(SessionEventType.ToolCallResult, {
            toolCallId: event.id,
            toolName: event.name,
            duration: time.end - time.start,
            result: { success: !event.failed, content: event.output },
          });
        }
      },
      requestApproval: async (request) => {
        input.signal.throwIfAborted();
        const tool = tools.get(request.toolCallId);
        if (!tool || tool.completed) throw new Error(`Native approval has no pending tool: ${request.toolCallId}`);
        if (permission.planEnabled || permission.mode === "plan") return "deny";
        if (permission.mode === "yolo" && (request.name === "Bash" || request.name === "Edit")) return "allow";
        const decision = await requestInteraction(request, input.signal);
        return decision.decision === "allow" ? "allow" : "deny";
      },
      requestUserInput: async (request, options) => {
        // 提问不是命令审批；Plan/Full access 都要走用户应答，不能自动跳过或批准。
        const questionInput = NativeAskUserQuestionInputSchema.parse({ questions: request.questions, metadata: { source: "native-codex" } });
        const tool = tools.get(request.toolCallId);
        if (tool?.name !== ASK_USER_QUESTION_TOOL_NAME || JSON.stringify(NativeAskUserQuestionInputSchema.parse(tool.input)) !== JSON.stringify(questionInput)) throw new Error("Native question has no matching pending tool");
        const decision = await requestInteraction({ id: request.id, toolCallId: request.toolCallId, name: ASK_USER_QUESTION_TOOL_NAME, input: questionInput, reason: "Codex needs your answer" }, options.signal);
        if (decision.decision === "deny") return {};
        if (decision.decision !== "modify") throw new Error("Native question response has no user answers");
        const answered = NativeAskUserQuestionInputSchema.parse(decision.modifiedInput);
        if (JSON.stringify(answered.questions) !== JSON.stringify(questionInput.questions) || answered.answers === undefined) throw new Error("Native question response does not match the pending questions");
        return answered.answers;
      },
    });
    await compactDelivery;
    input.signal.throwIfAborted();
    if (result.text !== streamedText) {
      if (!result.text.startsWith(streamedText)) {
        throw Object.assign(new Error("Native final text disagrees with streamed text"), { code: "NATIVE_CODEX_FINAL_TEXT_MISMATCH" });
      }
      // 整轮结果只校验聚合文本；缺失尾部单独成段，不能覆盖工具前已落盘的 part。
      await closeText();
      await appendText(`native-final:${input.inputId}`, result.text.slice(streamedText.length));
    }
    await closeText();
    // turn 成功不代表 item 成功；缺失 completion 必须显式收口，不能留下 compact 等待态。
    await closePendingCompactions("interrupted", "unknown");
    await this.persistAssistantMessage(
      assistantMessageId,
      input.userMessageId,
      created,
      { completed: Date.now(), finish: "stop" },
      input.traceContext,
      modelIdentity as Model | undefined,
    );
    await emit(SessionEventType.AssistantMessage, { content: result.text });
    return result;
  } catch (error) {
    // 仅记录固定诊断文本；第三方错误可能含密钥、命令或完整用户输入，不能原样落盘。
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    const safeMessages: Record<string, string> = {
      NATIVE_CODEX_UNSUPPORTED_INTERACTION: "Codex requested an unsupported interaction. No permission was granted.",
      NATIVE_CODEX_FINAL_TEXT_MISMATCH: "Native final text disagrees with streamed text.",
    };
    const safeCode = typeof code === "string" && Object.hasOwn(safeMessages, code) ? code : "NATIVE_CODEX_TURN_FAILED";
    this.logger?.warn("native_codex.turn.failed", {
      sessionId: this.sessionId,
      inputId: input.inputId,
      traceId: input.traceContext.traceId,
      turnId: input.traceContext.turnId,
      mode: permission.mode,
      planEnabled: permission.planEnabled,
      error: {
        name: input.signal.aborted ? "AbortError" : "Error",
        code: safeCode,
        message: safeMessages[safeCode] ?? "Native Codex turn failed; original cause is preserved for the caller.",
      },
    });
    // 连接失败可先于 onEvent 落盘结束；先排空已接收通知，避免 failed 后又追加 started。
    await Promise.allSettled([compactDelivery]);
    const interrupted = input.signal.aborted || (error instanceof Error && error.name === "AbortError");
    await nativeChildren.settle(interrupted ? "cancelled" : "failed");
    await closePendingCompactions(interrupted ? "interrupted" : "failed", interrupted ? "cancelled" : "api_error");
    // 原生中断仍保存已显示的文本，保留缺失 end 的未完成事实供冷恢复使用。
    await closeText(false);
    for (const [id, tool] of tools) {
      if (tool.completed) continue;
      await this.persistPart(
        {
          id: tool.partId,
          sessionID: this.sessionId,
          messageID: assistantMessageId,
          type: "tool",
          callID: id,
          tool: tool.name,
          declarationIndex: tool.declarationIndex,
          state: {
            status: "error",
            input: tool.input,
            error: input.signal.aborted ? "Native turn cancelled" : "Native turn failed",
            time: { start: tool.startedAt, end: Date.now() },
          },
        },
        input.traceContext,
      );
    }
    await this.persistAssistantMessage(
      assistantMessageId,
      input.userMessageId,
      created,
      {
        completed: Date.now(),
        finish: input.signal.aborted ? "cancelled" : "error",
        // 冷恢复按 error 而非 finish 识别取消；只保存固定安全文本，不持久化第三方错误。
        error: input.signal.aborted
          ? { name: "AbortError", data: { turnResult: "cancelled", message: "Native turn cancelled" } }
          : { name: "Error", data: { code: safeCode, message: safeMessages[safeCode] ?? "Native Codex turn failed." } },
      },
      input.traceContext,
      modelIdentity as Model | undefined,
    );
    throw error;
  }
}

/** 只把原生执行事实落入既有子会话；不得创建第二条 ZCode 执行路径。 */
function createNativeChildWriter(
  runtime: AgentRuntimeInternal,
  traceContext: TraceContext,
  emitParent: (type: SessionEvent["type"], payload: unknown) => Promise<void>,
) {
  type Child = { observation: NativeSubagentUpdate; created: number; turnId?: string; items: Map<string, NativeSubagentItem> };
  const children = new Map<string, Child>();
  const sessionIdFor = (agentId: string) => nativeCodexChildSessionId(runtime.sessionId, agentId);
  const publish = async (sessionId: typeof runtime.sessionId, type: SessionEvent["type"], payload: unknown, turnId?: string) => {
    if (sessionId === runtime.sessionId) { await emitParent(type, payload); return; }
    await runtime.appendEvent(createSessionEvent(type, sessionId, payload, {
      traceId: traceContext.traceId, ...(turnId ? { turnId: createTurnId(`codex_${turnId}`) } : {}),
    }), traceContext);
  };
  const update = async (observation: NativeSubagentUpdate): Promise<void> => {
    const childId = sessionIdFor(observation.agentId);
    const parentId = observation.parentAgentId ? sessionIdFor(observation.parentAgentId) : runtime.sessionId;
    let child = children.get(observation.agentId);
    const first = !child;
    const reopening = child && child.observation.status !== "running" && observation.status === "running";
    if (child && JSON.stringify(child.observation) === JSON.stringify(observation)) return;
    if (!child) {
      const parent = await runtime.sessionStore?.getSession(parentId);
      if (runtime.sessionStore && !parent) throw new Error("Native child parent is not persisted");
      if (parent && !await runtime.sessionStore!.getSession(childId)) await runtime.sessionStore!.createSession({
        id: childId, parentID: parentId, projectID: parent.projectID, workspaceID: parent.workspaceID,
        taskType: "subagent_child", slug: childId, title: observation.prompt.slice(0, 160) || "Codex",
        directory: parent.directory, path: parent.path, version: runtime.appVersion, permission: parent.permission,
      });
      child = { observation, created: Date.now(), items: new Map() };
      children.set(observation.agentId, child);
    }
    const relation = { agentId: observation.agentId, childSessionId: childId, parentToolCallId: observation.parentToolCallId,
      agentType: observation.agentType, description: observation.prompt, background: false };
    const parentTurnId = observation.parentAgentId ? children.get(observation.parentAgentId)?.turnId : undefined;
    if (first || reopening) await publish(parentId, SessionEventType.SubagentSpawned, relation, parentTurnId);
    const now = Date.now();
    const observedTurnId = observation.turnId ?? (observation.status !== "running" ? `unstarted_${observation.parentToolCallId}` : undefined);
    if (observedTurnId) {
      const turnId = observedTurnId;
      const userId = createMessageId(`codex_${observation.agentId}_${turnId}_input`);
      const messageId = createMessageId(`codex_${observation.agentId}_${turnId}_output`);
      const anchor = { turnId: createTurnId(`codex_${turnId}`) };
      const turnInput = observation.inputText ?? observation.prompt;
      if (child.turnId !== turnId) {
        child.turnId = turnId; child.items.clear(); child.created = now;
        await runtime.sessionStore?.saveMessage({ id: userId, sessionID: childId, role: "user", agent: "codex", time: { created: now }, anchor });
        await runtime.sessionStore?.savePart({ id: createPartId(`${userId}_text`), sessionID: childId, messageID: userId, type: "text", text: turnInput });
        await publish(childId, SessionEventType.TurnStarted, { input: turnInput, messageId: userId, turnNumber: 1, executionStartedAt: now }, turnId);
        await publish(childId, SessionEventType.ModelStreaming, { kind: "start", delta: "", done: false, assistantMessageId: messageId }, turnId);
      }
      const terminal = observation.status !== "running";
      await runtime.sessionStore?.saveMessage({
        id: messageId, sessionID: childId, role: "assistant", parentID: userId, time: { created: child.created, ...(terminal ? { completed: now } : {}) },
        mode: runtime.getMode(), agent: "codex", path: { cwd: runtime.workingDirectory, root: runtime.workspaceRoot },
        cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, anchor,
        ...(terminal ? { finish: observation.status === "success" ? "stop" : observation.status,
          ...(observation.status !== "success" ? { error: { name: observation.status === "cancelled" ? "AbortError" : "Error" } } : {}) } : {}),
        metadata: { executionBackend: "codex", nativeThreadId: observation.agentId, nativeTurnId: turnId },
      });
      for (const observedItem of observation.items) {
        // 取消/断线可能缺少 item 终态，必须把已显示的半截工具显式收口并持久化。
        const item = terminal && observedItem.type === "tool" && !observedItem.completed
          ? { ...observedItem, completed: true, failed: true, output: "Native child ended before tool completion" }
          : observedItem;
        const previous = child.items.get(item.id);
        if (JSON.stringify(previous) === JSON.stringify(item)) continue;
        const partId = createPartId(`codex_${observation.agentId}_${turnId}_${item.id}`);
        if (item.type === "text") {
          const before = previous?.type === "text" ? previous.text : "";
          if (!item.text.startsWith(before)) throw new Error("Native child text disagrees with its previous observation");
          await runtime.sessionStore?.savePart({ id: partId, sessionID: childId, messageID: messageId, type: "text", text: item.text,
            time: { start: child.created, ...(item.completed ? { end: now } : {}) } });
          if (!previous) await publish(childId, SessionEventType.ModelStreaming, { kind: "text_start", delta: "", done: false, assistantMessageId: messageId, partId }, turnId);
          if (item.text.length > before.length) await publish(childId, SessionEventType.ModelStreaming, { kind: "text_delta", delta: item.text.slice(before.length), done: false, assistantMessageId: messageId, partId }, turnId);
          if (item.completed && !previous?.completed) await publish(childId, SessionEventType.ModelStreaming, { kind: "text_end", delta: "", done: true, assistantMessageId: messageId, partId }, turnId);
        } else {
          const time = { start: child.created, end: now };
          await runtime.sessionStore?.savePart({ id: partId, sessionID: childId, messageID: messageId, type: "tool", tool: item.name, callID: item.id,
            state: item.completed ? item.failed ? { status: "error", input: item.input, error: item.output, time }
              : { status: "completed", input: item.input, output: item.output, title: item.name, metadata: {}, time }
              : { status: "running", input: item.input, time: { start: child.created } } });
          if (!previous) {
            await publish(childId, SessionEventType.ToolCallScheduled, { toolCallId: item.id, toolName: item.name, input: item.input, assistantMessageId: messageId }, turnId);
            await publish(childId, SessionEventType.ToolCallStarted, { toolCallId: item.id, toolName: item.name, startedAt: new Date(child.created) }, turnId);
          }
          if (item.completed && !previous?.completed) await publish(childId, SessionEventType.ToolCallResult, { toolCallId: item.id, toolName: item.name, result: { success: !item.failed, content: item.output } }, turnId);
        }
        child.items.set(item.id, item);
      }
      if (terminal && (first || child.observation.status === "running")) await publish(childId,
        observation.status === "failed" ? SessionEventType.TurnError : SessionEventType.TurnComplete,
        { resultType: observation.status === "cancelled" ? "cancelled" : observation.status === "failed" ? "error" : "success" }, turnId);
    }
    if (observation.status !== "running" && (first || child.observation.status === "running")) {
      await publish(parentId, SessionEventType.SubagentStopped, { ...relation, status: observation.status,
        summaryText: observation.items.filter(item => item.type === "text").map(item => item.text).join("\n\n") }, parentTurnId);
    }
    child.observation = structuredClone(observation);
  };
  return { update, async settle(status: "cancelled" | "failed") {
    for (const child of children.values()) if (child.observation.status === "running") await update({ ...child.observation, status });
  } };
}
