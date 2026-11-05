import { chmod, mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as nativeCodex from "@zcode/adapters/native-codex";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import { createRegistryBackedTestApp } from "./helpers/registry-backed-test-app.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("session execution engine assembly", () => {
  it("synchronizes external MCP through real app assembly without exporting ZCode's internal node_repl broker", async () => {
    const root = await mkdtemp(join(tmpdir(), "engine-codex-resources-"));
    roots.push(root);
    const workingDirectory = join(root, "workspace");
    await mkdir(workingDirectory);
    const userConfigPath = join(root, "config.json");
    await writeFile(
      userConfigPath,
      JSON.stringify({
        plugins: { enabledPlugins: { "browser-use@zcode-plugins-official": true } },
      }),
    );
    let resolveResources: nativeCodex.NativeCodexProjectOptions["resolveResources"];
    const factory = vi
      .spyOn(nativeCodex, "createNativeCodexExecutor")
      .mockImplementation(async (options) => {
        resolveResources = options.resolveResources;
        return { execute: vi.fn() };
      });
    const sessionStore = await createSqliteSessionStore({ dbPath: ":memory:" });
    let command = "external-first";
    let markStartupReached!: () => void;
    const startupReached = new Promise<void>((resolve) => {
      markStartupReached = resolve;
    });
    const connectConfiguredServers = vi.fn(async () => {
      markStartupReached();
      return { statuses: {}, tools: [] };
    });
    try {
      const app = await createRegistryBackedTestApp({
        executionEngine: "codex",
        env: { ZCODE_STORAGE_DIR: join(root, "storage") },
        userConfigPath,
        runtimeConfig: { workingDirectory },
        // 验收配置装配，不启动默认插件进程；实际 transport 验收由适配器夹具负责。
        mcpPortFactory: () => ({
          connectConfiguredServers,
          connectServer: async () => ({
            status: "disconnected",
            transport: "stdio",
            toolCount: 0,
            updatedAt: new Date().toISOString(),
          }),
          disconnectServer: async () => undefined,
          status: async () => ({}),
          listTools: async () => [],
          callTool: async () => {
            throw new Error("MCP execution is outside assembly acceptance");
          },
          close: async () => undefined,
        }),
        sessionStore,
        resolveCodexResourcePreferences: async () => ({
          preferences: { codexSyncMcp: true },
          mcpServers: { external: { type: "stdio", command, source: { kind: "user" } } },
        }),
      });
      // App 装配会异步预热 MCP；先等端口的真实调用屏障，再检查 picker 是否增加连接。
      await startupReached;
      const connectionsBeforePicker = connectConfiguredServers.mock.calls.length;
      const coreCatalog = vi.spyOn(app.runtime, "getSkillCatalog").mockImplementation(async () => {
        throw new Error("Codex picker must not initialize Core context");
      });
      const first = await resolveResources!();
      expect(first.mcpServers?.external).toMatchObject({ command: "external-first" });
      expect(first.mcpServers?.node_repl).toBeUndefined();
      // Codex 的技能/插件选择器应使用资源 owner，不能通过 Core context 初始化启动 ZCode MCP。
      expect(app.getNativeCodexResourceSnapshot).toBe(resolveResources);
      expect((await app.getSkillCatalog()).skills).toEqual(expect.any(Array));
      expect(coreCatalog).not.toHaveBeenCalled();
      expect(connectConfiguredServers).toHaveBeenCalledTimes(connectionsBeforePicker);
      command = "external-next-turn";
      expect((await resolveResources!()).mcpServers?.external).toMatchObject({
        command: "external-next-turn",
      });
      expect((await app.getNativeCodexResourceSnapshot!()).mcpServers?.external).toMatchObject({
        command: "external-next-turn",
      });
      expect(connectConfiguredServers).toHaveBeenCalledTimes(connectionsBeforePicker);
      await app.close?.();
    } finally {
      factory.mockRestore();
      await sessionStore.close();
    }
  });

  it("keeps an explicit ZCode app isolated from native opt-in environment in the same cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "engine-assembly-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const workingDirectory = await realpath(workspace);
    const sessionStore = await createSqliteSessionStore({ dbPath: ":memory:" });
    const env = {
      ZCODE_CODEX_WORKSPACE: workingDirectory,
      ZCODE_CODEX_BINARY: join(root, "codex.exe"),
      CODEX_HOME: join(root, "legacy-home"),
    };
    const common = {
      env,
      runtimeConfig: { workingDirectory, mcp: { enabled: false } },
      sessionStore,
      skipUserConfig: true,
    };
    try {
      const zcode = await createRegistryBackedTestApp({ ...common, executionEngine: "zcode" });
      expect(zcode.runtime.nativeTurnExecutor).toBeUndefined();
      await zcode.close?.();
      const standalone = await createRegistryBackedTestApp(common);
      expect(standalone.runtime.nativeTurnExecutor).toBeDefined();
      await standalone.close?.();
    } finally {
      await sessionStore.close();
    }
  });

  it("selects Codex without workspace opt-in and reports missing installations", async () => {
    const root = await mkdtemp(join(tmpdir(), "engine-codex-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const binary = join(root, "codex.exe");
    await writeFile(binary, "test native binary");
    await chmod(binary, 0o700);
    const sessionStore = await createSqliteSessionStore({ dbPath: ":memory:" });
    const common = {
      executionEngine: "codex" as const,
      runtimeConfig: { workingDirectory: await realpath(workspace), mcp: { enabled: false } },
      sessionStore,
      skipUserConfig: true,
    };
    try {
      const app = await createRegistryBackedTestApp({
        ...common,
        env: { ZCODE_CODEX_BINARY: binary, ZCODE_DATA_BASE_DIR: root },
      });
      expect(app.runtime.nativeTurnExecutor).toBeDefined();
      await app.close?.();
      await expect(createRegistryBackedTestApp({ ...common, env: { PATH: "" } })).rejects.toThrow(
        "Install the official Codex CLI",
      );
    } finally {
      await sessionStore.close();
    }
  });
});
