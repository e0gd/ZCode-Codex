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
} from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../internal.js";
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
        if (event.type === "contextCompactionStarted" || event.type === "contextCompactionCompleted") {
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
        if (!tool || tool.completed) {
          throw new Error(`Native approval has no pending tool: ${request.toolCallId}`);
        }
        if (permission.planEnabled || permission.mode === "plan") return "deny";
        if (permission.mode === "yolo" && (request.name === "Bash" || request.name === "Edit"))
          return "allow";
        const requestId = `${NATIVE_APPROVAL_RULE_ID}:${input.inputId}:${request.id}`;
        const payload: PermissionRequestedPayload = {
          requestId,
          // JSON-RPC id 只关联 broker；审批卡必须关联已持久化的 Codex item。
          toolCallId: request.toolCallId as ToolCallId,
          toolName: request.name,
          input: request.input,
          reason: request.reason ?? NATIVE_APPROVAL_REASON,
          riskLevel: "high",
          approvalMode: "user-once",
          optionsPolicy: "no-always-allow",
          suggestedPermissionUpdates: [],
        };
        const controller = new AbortController();
        const unlink = linkAbortSignal(input.signal, controller);
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
          input.signal.throwIfAborted();
          resolved = decision;
          // Codex 请求是用户一次性审批；不能沿用自动批准或把 modify/escalate 当作 allow。
          return decision.decision === "allow" ? "allow" : "deny";
        } catch (error) {
          resolved = {
            decision: "deny",
            reason: input.signal.aborted
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
