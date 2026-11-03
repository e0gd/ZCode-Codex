import type { ModelSelection } from "../model/model.js";
import type { ModelMessageContentBlock } from "../model/index.js";
import type { CollaborationMode } from "./session.port.js";
import type { AskUserQuestion } from "../tools/ask-user-question.js";
import { createSessionId, type SessionId } from "./shared.js";

export function nativeCodexChildSessionId(sessionId: string, agentId: string): SessionId {
  return createSessionId(`codex_${sessionId}_${agentId}`);
}

export type NativeSubagentItem =
  | { type: "text"; id: string; text: string; completed: boolean }
  | { type: "tool"; id: string; name: string; input: Record<string, unknown>; output: string; completed: boolean; failed: boolean };

/** Complete observations, not commands: Codex remains the sole child executor. */
export interface NativeSubagentUpdate {
  type: "subagentUpdated";
  agentId: string;
  parentAgentId?: string;
  parentToolCallId: string;
  prompt: string;
  agentType: string;
  turnId?: string;
  inputText?: string;
  status: "running" | "success" | "failed" | "cancelled";
  items: NativeSubagentItem[];
}

export type NativeCodexReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** Server-resolved transient launch data. Never accepted from submission payloads or persisted. */
export interface NativeCodexModelConfig {
  readonly modelId: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly reasoningEffort?: NativeCodexReasoningEffort;
}

/** Validates the exact selection against configured providers; errors never trigger fallback. */
export type NativeCodexModelResolver = (selection: ModelSelection) => NativeCodexModelConfig | Promise<NativeCodexModelConfig>;

/** Native execution owns model/tool work; Core retains admission and persisted UI events. */
export type NativeTurnEvent =
  | NativeSubagentUpdate
  | { type: "textStarted"; itemId: string }
  | { type: "textDelta"; itemId: string; delta: string }
  | { type: "textCompleted"; itemId: string }
  /** Observations only; Core owns operation identity, dedupe and failure/cancellation settlement. */
  | { type: "contextCompactionStarted"; threadId: string; turnId: string; itemId: string }
  | { type: "contextCompactionCompleted"; threadId: string; turnId: string; itemId: string }
  | { type: "toolStarted"; id: string; name: string; input: Record<string, unknown> }
  | { type: "toolCompleted"; id: string; name: string; output: string; failed?: boolean };

export interface NativeTurnApproval {
  /** JSON-RPC request identity used only for approval correlation. */
  id: string;
  /** Native item identity shared with the matching toolStarted event. */
  toolCallId: string;
  name: string;
  input: Record<string, unknown>;
  reason?: string;
}

export interface NativeTurnExecutor {
  execute(input: {
    sessionId: string;
    inputId: string;
    text: string;
    /** Resolved by Core and persisted with the user message; never browser paths/upload handles. */
    readonly attachments?: readonly ModelMessageContentBlock[];
    signal: AbortSignal;
    /** Exact admitted selection, or the session snapshot for a direct caller. No endpoints/keys. */
    readonly modelSelection?: ModelSelection;
    /** Core-owned permission snapshot; Plan takes precedence over the selected mode. */
    permission: { readonly mode: CollaborationMode; readonly planEnabled: boolean };
    onEvent(event: NativeTurnEvent): Promise<void>;
    requestApproval(request: NativeTurnApproval): Promise<"allow" | "deny">;
    /** Core owns the existing user-input broker; empty answers mean no user selection. */
    requestUserInput(request: { id: string; toolCallId: string; questions: AskUserQuestion[] }, options: { signal: AbortSignal }): Promise<Record<string, string>>;
  }): Promise<{ text: string; threadId: string; toolCallCount: number }>;
}
