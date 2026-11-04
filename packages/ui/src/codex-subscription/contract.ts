import type { CodexAccountState } from "@zcode/shared";

export interface CodexSubscriptionCardProps {
  /** Local cwd in the injected Settings Environment, never an active remote workspace path. */
  workspacePath?: string;
}

export interface CodexAccountView {
  state: CodexAccountState | null;
  busy: boolean;
  failed: boolean;
  run(action: "read" | "refresh" | "login" | "cancel" | "logout"): Promise<void>;
}
