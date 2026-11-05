import type { CodexAccountCommand, CodexAccountState } from "@zcode/shared";
import type { McpServerConfig } from "@zcode/contracts";

/** Persisted by the executing Host; blank values retain managed Codex discovery. */
export interface NativeCodexResourcePreferences {
  codexMcpConfigPath?: string;
  codexSkillRoots?: string[];
  codexSyncMcp?: boolean;
  codexMcpDisabledServers?: string[];
  codexSyncSkills?: boolean;
  codexSkillDisabledPaths?: string[];
}

/** One immutable turn's trusted effective resources; never write these back to source files. */
export interface NativeCodexResourceSnapshot {
  preferences: NativeCodexResourcePreferences;
  mcpServers?: Record<string, McpServerConfig>;
  /** Absolute paths to enabled SKILL.md files, after ZCode's disabled-path filtering. */
  skillPaths?: string[];
  /** Trusted, bounded model-only warning for canonical package references; empty clears prior context. */
  pluginReferenceWarning?: string;
}

/** Official Codex owns credentials; callers receive only safe account/catalog projections. */
export interface NativeCodexAccountPort {
  command(command: CodexAccountCommand): Promise<CodexAccountState>;
  dispose(): void;
}
