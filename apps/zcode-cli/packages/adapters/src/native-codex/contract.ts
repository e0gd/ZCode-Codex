import type {
  CodexAccountCommand,
  CodexAccountState,
  CodexSkillSyncCandidate,
} from "@zcode/shared";
import type { McpServerConfig } from "@zcode/contracts";

/** Persisted by the executing Host; blank values retain managed Codex discovery. */
export interface NativeCodexResourcePreferences {
  codexMcpConfigPath?: string;
  codexSkillRoots?: string[];
  codexSyncMcp?: boolean;
  codexUseNativeMcp?: boolean;
  codexMcpDisabledServers?: string[];
  codexSyncSkills?: boolean;
  codexSkillDisabledPaths?: string[];
  codexSkillEnabledPaths?: string[];
}

/** One immutable turn's trusted effective resources; never write these back to source files. */
export interface NativeCodexResourceSnapshot {
  preferences: NativeCodexResourcePreferences;
  mcpServers?: Record<string, McpServerConfig>;
  /** All selected-source names, including disabled/incompatible shadow tombstones. */
  mcpSourceNames?: string[];
  /** Absolute paths to enabled SKILL.md files, after ZCode's disabled-path filtering. */
  skillPaths?: string[];
  skillCandidates?: CodexSkillSyncCandidate[];
  /** Trusted, bounded model-only warning for canonical package references; empty clears prior context. */
  pluginReferenceWarning?: string;
}

/** Official Codex owns credentials; callers receive only safe account/catalog projections. */
export interface NativeCodexAccountPort {
  command(command: CodexAccountCommand): Promise<CodexAccountState>;
  dispose(): void;
}
