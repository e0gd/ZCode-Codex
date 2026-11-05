import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureNativeCodexResources,
  prepareNativeCodexResources,
} from "../src/native-codex/resources.js";
import {
  getCodexMcpCompatibility,
  codexMcpSyncCandidateSchema,
  codexMcpDisabledServersSchema,
  appSettingsSchema,
  appSettingsPatchSchema,
  codexSkillDisabledPathsSchema,
  codexSkillSyncCandidateSchema,
  getCodexSkillPathKey,
} from "@zcode/shared";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-resources-"));
  roots.push(root);
  return await realpath(root);
}
const rpc = (native: Record<string, unknown> = {}, skills: unknown[] = []) => ({
  request: vi.fn(async (method: string) =>
    method === "config/read"
      ? { config: { mcp_servers: native } }
      : method === "skills/list"
        ? { data: [{ skills, errors: [] }] }
        : {},
  ),
});

describe("native Codex resource sources", () => {
  it("validates bounded skill exclusions and metadata without bodies", () => {
    expect(appSettingsSchema.parse({}).codexSkillDisabledPaths).toEqual([]);
    expect(
      appSettingsPatchSchema.parse({ codexSkillDisabledPaths: ["/skills/a/SKILL.md"] }),
    ).toEqual({ codexSkillDisabledPaths: ["/skills/a/SKILL.md"] });
    for (const paths of [
      ["relative/SKILL.md"],
      [""],
      ["/skills/a/file.txt"],
      Array(4097).fill("/a/SKILL.md"),
    ])
      expect(codexSkillDisabledPathsSchema.safeParse(paths).success).toBe(false);
    const metadata = { name: "same", path: "/skills/a/SKILL.md", enabled: true, scope: "user" };
    expect(codexSkillSyncCandidateSchema.safeParse(metadata).success).toBe(true);
    expect(codexSkillSyncCandidateSchema.safeParse({ ...metadata, body: "private" }).success).toBe(
      false,
    );
    expect(getCodexSkillPathKey("C:\\Skills\\A\\SKILL.md")).toBe(
      getCodexSkillPathKey("c:/skills/a/SKILL.md"),
    );
    expect(getCodexSkillPathKey("\\\\SERVER\\Share\\A\\SKILL.md")).toBe(
      getCodexSkillPathKey("//server/share/a/SKILL.md"),
    );
    expect(getCodexSkillPathKey("/skills/A/SKILL.md")).not.toBe(
      getCodexSkillPathKey("/skills/a/SKILL.md"),
    );
  });

  it("filters excluded skills before reading files and preserves independent same-name skills", async () => {
    const root = await fixture();
    const selected = join(root, "one", "SKILL.md"),
      excluded = join(root, "two", "SKILL.md");
    await mkdir(join(root, "one"));
    await writeFile(selected, "---\nname: same\ndescription: test\n---\nbody");
    const disabled =
      process.platform === "win32" ? excluded.replaceAll("\\", "/").toUpperCase() : excluded;
    const prepared = await prepareNativeCodexResources({
      preferences: { codexSyncSkills: true, codexSkillDisabledPaths: [disabled] },
      skillPaths: [selected, excluded],
    });
    expect(prepared.skillPaths).toEqual([await realpath(selected)]);
    const config = await configureNativeCodexResources(
      rpc({}, [
        { path: excluded, scope: "repo" },
        { path: join(root, "system", "SKILL.md"), scope: "system" },
      ]),
      prepared,
      root,
    );
    expect(config["skills.config"]).toContainEqual({ path: excluded, enabled: false });
    expect(
      (config["skills.config"] as Array<{ path: string }>).some((s) => s.path.includes("system")),
    ).toBe(false);
  });

  it("ignores retained skill exclusions when synchronization is off", async () => {
    expect(
      await prepareNativeCodexResources({
        preferences: { codexSyncSkills: false, codexSkillDisabledPaths: ["/missing/SKILL.md"] },
        skillPaths: ["/missing/SKILL.md"],
      }),
    ).toEqual({});
  });
  it("keeps empty independent preferences and legacy deployment resources unchanged", async () => {
    const prepared = await prepareNativeCodexResources(
      { preferences: {} },
      { skillRoots: ["legacy"] },
    );
    const connection = rpc();
    expect(prepared).toEqual({ skillRoots: ["legacy"] });
    expect(await configureNativeCodexResources(connection, prepared, "workspace")).toEqual({});
    expect(connection.request.mock.calls.map((call) => call[0])).toEqual(["skills/extraRoots/set"]);
  });

  it("imports only custom MCP definitions and leaves the TOML file unchanged", async () => {
    const root = await fixture(),
      file = join(root, "config.toml");
    const source =
      'model="do-not-import"\n[mcp_servers.sample]\ncommand="node"\nargs=["server.js"]\n[mcp_servers.sample.env]\nTOKEN="secret-not-in-arguments"\n';
    await writeFile(file, source);
    const prepared = await prepareNativeCodexResources({
      preferences: { codexMcpConfigPath: file },
    });
    const connection = rpc({ inherited: { enabled: true } });
    const config = await configureNativeCodexResources(connection, prepared, root);
    expect(config).not.toHaveProperty("model");
    const servers = config.mcp_servers as Record<string, Record<string, unknown>>;
    expect(servers.inherited).toEqual({ enabled: false });
    expect(Object.values(servers)).toContainEqual(
      expect.objectContaining({ command: "node", env: { TOKEN: "secret-not-in-arguments" } }),
    );
    expect(await readFile(file, "utf8")).toBe(source);
  });

  it("sync ignores saved custom paths, omits disabled servers and retains trusted settings", async () => {
    const prepared = await prepareNativeCodexResources({
      preferences: { codexSyncMcp: true, codexMcpConfigPath: "missing-relative.toml" },
      mcpServers: {
        "plugin:example:stdio": {
          type: "stdio",
          command: "node",
          args: ["mcp.js"],
          env: { TOKEN: "secret" },
          timeoutMs: 2500,
        },
        disabled: { type: "stdio", command: "no", enabled: false },
      },
    });
    const config = await configureNativeCodexResources(rpc({ native: {} }), prepared, "workspace");
    const servers = config.mcp_servers as Record<string, Record<string, unknown>>;
    expect(servers.native).toEqual({ enabled: false });
    expect(Object.values(servers).filter((server) => server.enabled !== false)).toEqual([
      expect.objectContaining({
        command: "node",
        args: ["mcp.js"],
        env: { TOKEN: "secret" },
        tool_timeout_sec: 2.5,
      }),
    ]);
    expect(Object.keys(servers).every((name) => /^[A-Za-z0-9_-]+$/.test(name))).toBe(true);
  });

  it.each([
    { type: "sse", url: "https://example.test/sse" },
    {
      type: "http",
      url: "https://example.test",
      oauth: { type: "client_credentials", clientId: "id", clientSecret: "do-not-display" },
    },
    { type: "stdio", command: "node", auth: { type: "zcode_official", provider: "jwt_token" } },
  ] as const)("excludes unsupported mappings without blocking other servers", async (server) => {
    expect(
      await prepareNativeCodexResources({
        preferences: { codexSyncMcp: true },
        mcpServers: {
          example: server,
          good: { type: "stdio", command: "node" },
        },
      }),
    ).toEqual({ mcpServers: { good: { enabled: true, command: "node", args: [] } } });
  });

  it.each([
    [{ type: "sse", url: "https://secret-endpoint.test" }, "sse"],
    [
      {
        type: "http",
        url: "https://secret-endpoint.test",
        oauth: { clientSecret: "secret-value" },
      },
      "oauth",
    ],
    [{ type: "stdio", command: "secret-command", auth: { token: "secret-value" } }, "managed_auth"],
    [
      { type: "stdio", command: "secret-command", protocolVersion: "secret-version" },
      "fixed_protocol",
    ],
    [{ type: "stdio", command: "secret-command", timeoutMs: -1 }, "invalid_config"],
    [
      { type: "unknown-secret-transport", url: "https://secret-endpoint.test" },
      "unsupported_transport",
    ],
  ])(
    "classifies excluded servers without returning configuration values",
    async (server, reason) => {
      const compatibility = getCodexMcpCompatibility(server);
      expect(compatibility).toEqual({ compatible: false, reason });
      const prepared = await prepareNativeCodexResources({
        preferences: { codexSyncMcp: true },
        mcpServers: {
          good: { type: "stdio", command: "node" },
          "plugin:example:broken": server as never,
        },
      });
      expect(Object.keys(prepared.mcpServers ?? {})).toEqual(["good"]);
      expect(JSON.stringify({ prepared, compatibility })).not.toMatch(/secret-|https:/);
    },
  );

  it("does not admit invalid names when filtering synchronized servers", async () => {
    expect(
      await prepareNativeCodexResources({
        preferences: { codexSyncMcp: true },
        mcpServers: {
          "broken\n\u202e": { type: "sse", url: "https://example.test" },
        },
      }),
    ).toEqual({ mcpServers: {} });
  });

  it("defaults compatible new servers on and retains manual exclusions across compatibility changes", async () => {
    const preferences = { codexSyncMcp: true, codexMcpDisabledServers: ["manual"] };
    const mcpServers = {
      manual: { type: "stdio" as const, command: "node" },
      newCompatible: { type: "http" as const, url: "http://fixture.test" },
      image: {
        type: "http" as const,
        url: "http://fixture.test",
        auth: { type: "zcode_official", provider: "jwt_token" } as never,
      },
    };
    expect(
      Object.keys((await prepareNativeCodexResources({ preferences, mcpServers })).mcpServers!),
    ).toEqual(["newCompatible"]);
    delete (mcpServers.image as { auth?: unknown }).auth;
    expect(
      Object.keys((await prepareNativeCodexResources({ preferences, mcpServers })).mcpServers!),
    ).toEqual(["newCompatible", "image"]);
    expect(preferences.codexMcpDisabledServers).toEqual(["manual"]);
  });

  it("supports inferred/alias transports and only excludes exact builtin broker provenance", () => {
    for (const config of [
      { command: "node" },
      { url: "http://fixture.test" },
      { type: "streamable-http", url: "http://fixture.test" },
      { type: "streamableHttp", url: "http://fixture.test" },
    ])
      expect(getCodexMcpCompatibility(config).compatible).toBe(true);
    expect(
      getCodexMcpCompatibility(
        { type: "stdio", command: "node", source: { kind: "builtin" } },
        "node_repl",
      ),
    ).toEqual({ compatible: false, reason: "internal_tool" });
    expect(
      getCodexMcpCompatibility(
        { type: "stdio", command: "node", source: { kind: "user" } },
        "node_repl",
      ),
    ).toEqual({ compatible: true });
  });

  it("validates legacy environment/header aliases with the same precedence as Host conversion", () => {
    for (const config of [
      { command: "node", environment: { TOKEN: "secret" } },
      { url: "https://fixture.test/mcp", http_headers: { Authorization: "secret" } },
      { command: "node", env: { TOKEN: "current" }, environment: { TOKEN: 1 } },
      { url: "https://fixture.test/mcp", headers: {}, http_headers: { Authorization: 1 } },
    ])
      expect(getCodexMcpCompatibility(config)).toEqual({ compatible: true });
    for (const config of [
      { command: "node", environment: { TOKEN: 1 } },
      { url: "https://fixture.test/mcp", http_headers: { Authorization: 1 } },
    ])
      expect(getCodexMcpCompatibility(config)).toEqual({
        compatible: false,
        reason: "invalid_config",
      });
  });

  it("persists bounded exclusions and validates a metadata-only catalog schema", () => {
    expect(appSettingsSchema.parse({}).codexMcpDisabledServers).toEqual([]);
    expect(
      appSettingsPatchSchema.parse({ codexMcpDisabledServers: ["plugin:example:server"] }),
    ).toEqual({ codexMcpDisabledServers: ["plugin:example:server"] });
    expect(codexMcpDisabledServersSchema.safeParse(["bad\nname"]).success).toBe(false);
    expect(codexMcpDisabledServersSchema.safeParse(["a".repeat(257)]).success).toBe(false);
    expect(
      codexMcpDisabledServersSchema.safeParse(Array.from({ length: 513 }, () => "server")).success,
    ).toBe(false);
    expect(
      codexMcpSyncCandidateSchema.safeParse({
        name: "plugin:image-search:image_search",
        compatible: false,
        enabled: true,
        reason: "managed_auth",
      }).success,
    ).toBe(true);
    expect(
      codexMcpSyncCandidateSchema.safeParse({
        name: "server",
        compatible: true,
        enabled: true,
        headers: { Authorization: "secret" },
      }).success,
    ).toBe(false);
  });

  it("rejects missing snapshots, relative/unreadable paths and malformed custom TOML", async () => {
    await expect(
      prepareNativeCodexResources({ preferences: { codexSyncMcp: true } }),
    ).rejects.toThrow("snapshot");
    await expect(
      prepareNativeCodexResources({ preferences: { codexSyncSkills: true } }),
    ).rejects.toThrow("snapshot");
    await expect(
      prepareNativeCodexResources({ preferences: { codexMcpConfigPath: "relative.toml" } }),
    ).rejects.toThrow("absolute");
    const root = await fixture(),
      file = join(root, "config.toml");
    await expect(
      prepareNativeCodexResources({ preferences: { codexMcpConfigPath: file } }),
    ).rejects.toThrow("read");
    await writeFile(file, "broken = [ private-secret");
    await expect(
      prepareNativeCodexResources({ preferences: { codexMcpConfigPath: file } }),
    ).rejects.toThrow("parse");
  });

  it("expands skill containers into actual SKILL.md directories", async () => {
    const root = await fixture(),
      sample = join(root, "sample");
    await mkdir(sample);
    await writeFile(
      join(sample, "SKILL.md"),
      "---\nname: sample\ndescription: Sample\n---\nUse sample.",
    );
    const prepared = await prepareNativeCodexResources(
      { preferences: { codexSkillRoots: [root] } },
      { skillRoots: ["ignored"] },
    );
    expect(prepared.skillRoots).toEqual([sample]);
    await expect(
      prepareNativeCodexResources({ preferences: { codexSkillRoots: ["relative"] } }),
    ).rejects.toThrow("absolute");
  });

  it("syncs only enabled skill paths and suppresses all other discovered non-system skills", async () => {
    const root = await fixture(),
      sample = join(root, "enabled");
    await mkdir(sample);
    const path = join(sample, "SKILL.md");
    await writeFile(path, "---\nname: enabled\ndescription: Enabled\n---\nUse enabled.");
    const prepared = await prepareNativeCodexResources({
      preferences: { codexSyncSkills: true, codexSkillRoots: ["ignored"] },
      skillPaths: [path],
    });
    const connection = rpc({}, [
      { path, scope: "user" },
      { path: join(root, "disabled", "SKILL.md"), scope: "repo" },
      { path: join(root, "system", "SKILL.md"), scope: "system" },
    ]);
    const config = await configureNativeCodexResources(connection, prepared, root);
    expect(config["skills.config"]).toEqual([
      { path, enabled: true },
      { path: join(root, "disabled", "SKILL.md"), enabled: false },
    ]);
    expect(connection.request).toHaveBeenCalledWith("skills/extraRoots/set", {
      extraRoots: [sample],
    });
  });
});
