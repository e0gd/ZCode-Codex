import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { McpServerConfig } from "@zcode/contracts";
import type { NativeCodexResourceSnapshot } from "./contract.js";
import {
  getCodexMcpCompatibility,
  getCodexSkillPathKey,
  createCodexSkillSelector,
} from "@zcode/shared";

type RecordValue = Record<string, unknown>;
type ResourceConnection = { request(method: string, params: RecordValue): Promise<unknown> };
export interface PreparedNativeCodexResources {
  pluginReferenceWarning?: string;
  mcpServers?: Record<string, RecordValue>;
  useNativeMcp?: boolean;
  mcpSourceNames?: string[];
  skillRoots?: string[];
  skillPaths?: string[];
}
const maximumSkillDirectories = 4096;
const maximumSkillDepth = 16;
const maximumConfigBytes = 2 * 1024 * 1024;
const maximumMcpServers = 512;
const maximumServerNameLength = 256;
const millisecondsPerSecond = 1000;
const object = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const pathKey = (value: string) =>
  process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
const hasControl = (value: string) =>
  [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code < 32 || (code >= 127 && code <= 159);
  });

function absolutePath(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4096 ||
    !isAbsolute(value) ||
    hasControl(value)
  ) {
    throw new Error(`Codex ${label} must be an absolute path on the executing computer.`);
  }
  return value;
}

function safeJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(safeJson);
  if (object(value) && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeJson(item)]));
  throw new Error("Codex MCP configuration contains an unsupported value.");
}

function translateMcp(name: string, server: McpServerConfig): RecordValue {
  // 旧错误丢失服务名且混列原因；只拼接转义后的名称和固定字段说明，不能带出配置中的凭据。
  const label = JSON.stringify(name.slice(0, maximumServerNameLength)).replace(
    /[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const incompatible = (reason: string) =>
    new Error(
      `ZCode MCP server ${label} cannot be represented by native Codex: ${reason}. Check Settings → MCP servers.`,
    );
  const common = {
    enabled: true,
    ...(server.timeoutMs !== undefined
      ? { tool_timeout_sec: server.timeoutMs / millisecondsPerSecond }
      : {}),
  };
  const type = server.type ?? ("command" in server ? "stdio" : "http");
  if (type === "stdio" && "command" in server)
    return safeJson({
      ...common,
      command: server.command,
      args: server.args ?? [],
      ...(server.cwd ? { cwd: server.cwd } : {}),
      ...(server.env ? { env: server.env } : {}),
    }) as RecordValue;
  if ("url" in server)
    return safeJson({
      ...common,
      url: server.url,
      ...(server.headers ? { http_headers: server.headers } : {}),
    }) as RecordValue;
  throw incompatible("unsupported transport; configure a Streamable HTTP or stdio connection");
}

async function readCustomMcp(file: string): Promise<Record<string, RecordValue>> {
  absolutePath(file, "MCP configuration");
  let text: string;
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > maximumConfigBytes)
      throw new Error("Invalid configuration file.");
    text = await readFile(file, "utf8");
  } catch {
    throw new Error("Could not read the selected Codex MCP configuration file.");
  }
  let config: RecordValue;
  try {
    config = parseToml(text) as RecordValue;
  } catch {
    throw new Error("Could not parse the selected Codex MCP configuration file.");
  }
  const servers = config.mcp_servers;
  if (servers === undefined) return {};
  if (!object(servers))
    throw new Error("Codex MCP configuration must contain a mcp_servers table.");
  return Object.fromEntries(
    Object.entries(servers).map(([name, value]) => {
      if (!object(value)) throw new Error("Codex MCP server configuration must be a table.");
      return [name, safeJson(value) as RecordValue];
    }),
  );
}

async function checkedSkillPath(file: string): Promise<string> {
  absolutePath(file, "skill");
  if (file.slice(-"SKILL.md".length) !== "SKILL.md")
    throw new Error("A synchronized Codex skill must reference SKILL.md.");
  try {
    if (!(await stat(file)).isFile()) throw new Error("Invalid skill file.");
    await access(file, constants.R_OK);
    return await realpath(file);
  } catch {
    throw new Error("Could not read a selected Codex skill file.");
  }
}

async function expandSkillRoots(roots: string[]): Promise<string[]> {
  const found = new Map<string, string>();
  const visited = new Set<string>();
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > maximumSkillDepth || visited.size >= maximumSkillDirectories)
      throw new Error("Codex skill directories exceed the discovery limit.");
    const canonical = await realpath(directory);
    if (visited.has(pathKey(canonical))) return;
    visited.add(pathKey(canonical));
    const entries = await readdir(canonical, { withFileTypes: true });
    if (entries.some((entry) => entry.name === "SKILL.md" && entry.isFile())) {
      const file = await checkedSkillPath(join(canonical, "SKILL.md"));
      found.set(pathKey(file), dirname(file));
      return;
    }
    // 只扫描显式选择的目录树；不跟随子目录符号链接，避免绕进无关目录或循环。
    for (const entry of entries)
      if (entry.isDirectory() && !entry.name.startsWith("."))
        await visit(join(canonical, entry.name), depth + 1);
  };
  for (const root of roots) {
    absolutePath(root, "skill directory");
    try {
      if (!(await stat(root)).isDirectory()) throw new Error("Invalid skill directory.");
      await visit(root, 0);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Codex skill directories exceed"))
        throw error;
      throw new Error("Could not read a selected Codex skill directory.");
    }
  }
  return [...found.values()];
}

/** Resolve a turn snapshot before starting a process; default deployment values stay untouched. */
export async function prepareNativeCodexResources(
  snapshot: NativeCodexResourceSnapshot | undefined,
  legacy: { skillRoots?: string[] } = {},
): Promise<PreparedNativeCodexResources> {
  const preferences = snapshot?.preferences ?? {};
  const prepared: PreparedNativeCodexResources = {};
  if (preferences.codexUseNativeMcp === false) prepared.useNativeMcp = false;
  if (preferences.codexSyncMcp) {
    if (!snapshot?.mcpServers)
      throw new Error("ZCode MCP synchronization snapshot is unavailable.");
    prepared.mcpSourceNames = [
      ...(snapshot.mcpSourceNames ?? Object.keys(snapshot.mcpServers)),
    ].filter((name) => name && name.length <= maximumServerNameLength && !hasControl(name));
    // 配置兼容性与目录列表共用同一判定，直接调用 adapter 也不能复活不兼容或手动排除的项。
    prepared.mcpServers = Object.fromEntries(
      Object.entries(snapshot.mcpServers)
        .filter(
          ([name, server]) =>
            server.enabled !== false &&
            !preferences.codexMcpDisabledServers?.includes(name) &&
            getCodexMcpCompatibility(server, name).compatible,
        )
        .map(([name, server]) => [name, translateMcp(name, server)]),
    );
  } else if (preferences.codexMcpConfigPath?.trim()) {
    prepared.mcpServers = await readCustomMcp(preferences.codexMcpConfigPath.trim());
  }
  if (prepared.mcpServers) {
    if (Object.keys(prepared.mcpServers).length > maximumMcpServers)
      throw new Error("Too many selected Codex MCP servers.");
    for (const name of Object.keys(prepared.mcpServers))
      if (!name || name.length > maximumServerNameLength || hasControl(name))
        throw new Error("A Codex MCP server name is invalid.");
  }
  if (preferences.codexSyncSkills) {
    if (!snapshot?.skillPaths)
      throw new Error("ZCode skill synchronization snapshot is unavailable.");
    const candidates = new Map(
      snapshot.skillCandidates?.map((entry) => [getCodexSkillPathKey(entry.path), entry]),
    );
    const selectSkill = createCodexSkillSelector(preferences);
    // 排除项先过滤，不能因已取消同步的失效路径阻断整轮对话。
    const selected = snapshot.skillPaths.filter((path) =>
      selectSkill(candidates.get(getCodexSkillPathKey(path)) ?? { path, enabled: true }),
    );
    const paths = await Promise.all(selected.map(checkedSkillPath));
    prepared.skillPaths = [...new Map(paths.map((path) => [pathKey(path), path])).values()];
    prepared.skillRoots = prepared.skillPaths.map(dirname);
  } else if (preferences.codexSkillRoots?.length) {
    prepared.skillRoots = await expandSkillRoots(preferences.codexSkillRoots);
  } else if (legacy.skillRoots?.length) prepared.skillRoots = [...legacy.skillRoots];
  if (snapshot?.pluginReferenceWarning !== undefined)
    prepared.pluginReferenceWarning = snapshot.pluginReferenceWarning;
  return prepared;
}

/** Read official discovery only; all effective overrides travel in the thread's local JSON config. */
export async function configureNativeCodexResources(
  connection: ResourceConnection,
  prepared: PreparedNativeCodexResources,
  workspace: string,
): Promise<RecordValue> {
  const config: RecordValue = {};
  if (prepared.mcpServers || prepared.useNativeMcp === false) {
    const read = await connection.request("config/read", { cwd: workspace, includeLayers: false });
    if (
      !object(read) ||
      !object(read.config) ||
      (read.config.mcp_servers !== null &&
        read.config.mcp_servers !== undefined &&
        !object(read.config.mcp_servers))
    )
      throw new Error("Codex returned invalid MCP discovery configuration.");
    const native = object(read.config.mcp_servers) ? read.config.mcp_servers : {};
    const sourceNames = new Set(prepared.mcpSourceNames ?? Object.keys(prepared.mcpServers ?? {}));
    // 原生配置保留官方 enabled/OAuth 等事实；只屏蔽来源同名项或显式关闭的原生 MCP。
    const servers: Record<string, RecordValue> = Object.fromEntries(
      Object.keys(native)
        .filter((name) => prepared.useNativeMcp === false || sourceNames.has(name))
        .map((name) => [name, { enabled: false }]),
    );
    for (const [name, server] of Object.entries(prepared.mcpServers ?? {})) {
      // 新命名空间避免深合并继承另一种 transport 的 command/url/env；同名源配置不互相污染。
      const key = `zcode_${createHash("sha256").update(name).digest("hex").slice(0, 24)}`;
      if (key in native)
        throw new Error("A native Codex MCP name conflicts with the selected resource namespace.");
      servers[key] = server;
    }
    config.mcp_servers = servers;
  }
  if (prepared.skillRoots)
    await connection.request("skills/extraRoots/set", { extraRoots: prepared.skillRoots });
  if (prepared.skillPaths) {
    const listing = await connection.request("skills/list", {
      cwds: [workspace],
      forceReload: true,
    });
    if (!object(listing) || !Array.isArray(listing.data))
      throw new Error("Codex returned invalid skill discovery configuration.");
    const enabled = new Set(prepared.skillPaths.map(pathKey));
    const settings = new Map<string, { path: string; enabled: boolean }>();
    for (const group of listing.data) {
      if (
        !object(group) ||
        !Array.isArray(group.skills) ||
        !Array.isArray(group.errors) ||
        group.errors.length
      )
        throw new Error("Codex could not discover all selected skills.");
      for (const skill of group.skills) {
        if (!object(skill) || typeof skill.path !== "string" || typeof skill.scope !== "string")
          throw new Error("Codex returned invalid skill metadata.");
        if (skill.scope !== "system" && skill.scope !== "admin")
          settings.set(pathKey(skill.path), {
            path: skill.path,
            enabled: enabled.has(pathKey(skill.path)),
          });
      }
    }
    for (const path of prepared.skillPaths) settings.set(pathKey(path), { path, enabled: true });
    config["skills.config"] = [...settings.values()];
  }
  return config;
}
