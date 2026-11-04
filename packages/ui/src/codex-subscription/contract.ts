import type { CodexAccountCommand, CodexAccountState } from "@zcode/shared";

export interface CodexSubscriptionCardProps {
  /** Local cwd in the injected Settings Environment, never an active remote workspace path. */
  workspacePath?: string;
  /** True only when the injected Settings account owner is local to this desktop client. */
  allowBrowserLogin?: boolean;
}

export interface CodexAccountView {
  state: CodexAccountState | null;
  busy: boolean;
  failed: boolean;
  run(
    action: "read" | "refresh" | "login" | "cancel" | "logout",
    loginMethod?: CodexAccountCommand["loginMethod"],
  ): Promise<void>;
}
