import type { CodexAccountCommand, CodexAccountState } from "@zcode/shared";

/** Official Codex owns credentials; callers receive only safe account/catalog projections. */
export interface NativeCodexAccountPort {
  command(command: CodexAccountCommand): Promise<CodexAccountState>;
  dispose(): void;
}
