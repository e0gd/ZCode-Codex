import { z } from "zod";

export const appToolSearchModeSchema = z.enum(["auto", "local", "off"]);
export type AppToolSearchMode = z.infer<typeof appToolSearchModeSchema>;

// Web 输入的是执行 Host 的路径，不能用浏览器本机的操作系统判断绝对路径。
const MAX_CODEX_RESOURCE_PATH_CHARS = 4096;
const MAX_CODEX_SKILL_ROOTS = 32;
export const codexResourcePathSchema = z
  .string()
  .trim()
  .max(MAX_CODEX_RESOURCE_PATH_CHARS)
  .refine((value) => !/\p{Cc}/u.test(value), "Resource paths cannot contain control characters")
  .refine(
    (value) =>
      value === "" ||
      value.startsWith("/") ||
      /^[A-Za-z]:[\\/]/u.test(value) ||
      /^\\\\[^\\]+\\[^\\]+/u.test(value),
    "Use an absolute path on the executing computer",
  );
export const codexSkillRootsSchema = z
  .array(codexResourcePathSchema.refine((value) => value.length > 0))
  .max(MAX_CODEX_SKILL_ROOTS);

const MAX_CODEX_SELECTED_SKILL_PATHS = 4096;
export const codexSkillPathSchema = codexResourcePathSchema.refine(
  (value) => value.length > 0 && /(?:^|[\\/])SKILL\.md$/u.test(value),
  "Use an absolute SKILL.md path on the executing computer",
);
export const codexSkillDisabledPathsSchema = z
  .array(codexSkillPathSchema)
  .max(MAX_CODEX_SELECTED_SKILL_PATHS);
export const codexSkillSyncCandidateSchema = z
  .object({
    name: z.string().min(1),
    path: codexSkillPathSchema,
    scope: z.enum(["workspace", "user", "plugin"]),
    enabled: z.boolean(),
    pluginName: z.string().optional(),
  })
  .strict();
export type CodexSkillSyncCandidate = z.infer<typeof codexSkillSyncCandidateSchema>;

/** Host path identity must not depend on the Web browser's operating system. */
export function getCodexSkillPathKey(path: string): string {
  return /^[A-Za-z]:[\\/]|^(?:\\\\|\/\/)/u.test(path)
    ? path.replaceAll("\\", "/").toLowerCase()
    : path;
}

const MAX_CODEX_MCP_SERVER_NAME_CHARS = 256;
const MAX_CODEX_MCP_SERVERS = 512;
export const codexMcpServerNameSchema = z
  .string()
  .min(1)
  .max(MAX_CODEX_MCP_SERVER_NAME_CHARS)
  .refine((value) => !/\p{Cc}/u.test(value), "MCP names cannot contain control characters");
export const codexMcpDisabledServersSchema = z
  .array(codexMcpServerNameSchema)
  .max(MAX_CODEX_MCP_SERVERS);
export const codexMcpCompatibilityReasonSchema = z.enum([
  "sse",
  "managed_auth",
  "oauth",
  "fixed_protocol",
  "unsupported_transport",
  "invalid_config",
  "internal_tool",
  "disabled",
  "untrusted",
]);
export type CodexMcpCompatibilityReason = z.infer<typeof codexMcpCompatibilityReasonSchema>;
export const codexMcpSyncCandidateSchema = z
  .object({
    name: codexMcpServerNameSchema,
    compatible: z.boolean(),
    enabled: z.boolean(),
    reason: codexMcpCompatibilityReasonSchema.optional(),
  })
  .strict();
export type CodexMcpSyncCandidate = z.infer<typeof codexMcpSyncCandidateSchema>;

interface CodexMcpCompatibilityInput {
  type?: unknown;
  command?: unknown;
  url?: unknown;
  args?: unknown;
  env?: unknown;
  environment?: unknown;
  headers?: unknown;
  http_headers?: unknown;
  auth?: unknown;
  oauth?: unknown;
  protocolVersion?: unknown;
  timeoutMs?: unknown;
  source?: unknown;
}

/** Configuration compatibility only; no credentials, connection attempts or mutable state. */
export function getCodexMcpCompatibility(
  config: CodexMcpCompatibilityInput,
  name?: string,
): { compatible: boolean; reason?: CodexMcpCompatibilityReason } {
  const incompatible = (reason: CodexMcpCompatibilityReason) => ({ compatible: false, reason });
  const source = config.source;
  // 只排除确有 builtin provenance 的内部宿主，不能因用户同名 MCP 被误判成内部工具。
  if (
    name === "node_repl" &&
    source !== null &&
    typeof source === "object" &&
    "kind" in source &&
    source.kind === "builtin"
  )
    return incompatible("internal_tool");
  if (name !== undefined && !codexMcpServerNameSchema.safeParse(name).success)
    return incompatible("invalid_config");
  const type =
    config.type ??
    (config.command !== undefined ? "stdio" : config.url !== undefined ? "http" : undefined);
  if (type === "sse") return incompatible("sse");
  if (config.auth) return incompatible("managed_auth");
  if (config.oauth) return incompatible("oauth");
  if (config.protocolVersion !== undefined && config.protocolVersion !== "auto")
    return incompatible("fixed_protocol");
  if (
    config.timeoutMs !== undefined &&
    (typeof config.timeoutMs !== "number" ||
      !Number.isFinite(config.timeoutMs) ||
      config.timeoutMs <= 0)
  )
    return incompatible("invalid_config");
  if (
    type !== "stdio" &&
    type !== "http" &&
    type !== "streamableHttp" &&
    type !== "streamable-http"
  )
    return incompatible("unsupported_transport");
  const stringRecord = (value: unknown) =>
    value === undefined ||
    (value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.values(value).every((item) => typeof item === "string"));
  if (type === "stdio") {
    if (
      typeof config.command !== "string" ||
      !config.command.trim() ||
      (config.args !== undefined &&
        (!Array.isArray(config.args) || !config.args.every((item) => typeof item === "string"))) ||
      !stringRecord(config.env ?? config.environment)
    )
      return incompatible("invalid_config");
  } else if (
    typeof config.url !== "string" ||
    !config.url.trim() ||
    !stringRecord(config.headers ?? config.http_headers)
  )
    return incompatible("invalid_config");
  return { compatible: true };
}

export const APP_RUNTIME_PREFERENCES_CHANGED_BROADCAST_CHANNEL = "settings:app-runtime-preferences";
export const ASK_USER_QUESTION_E2E_CLOCK_SCALE_ENV = "ZCODE_E2E_ASK_USER_QUESTION_CLOCK_SCALE";

export const appRuntimePreferencesChangedBroadcastPayloadSchema = z
  .object({
    askUserQuestionAutoResolutionEnabled: z.boolean(),
    modelIoFullRetentionEnabled: z.boolean().default(false),
  })
  .strict();

export type AppRuntimePreferencesChangedBroadcastPayload = z.infer<
  typeof appRuntimePreferencesChangedBroadcastPayloadSchema
>;
