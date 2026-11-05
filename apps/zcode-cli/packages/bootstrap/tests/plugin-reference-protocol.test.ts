// plugins/referenceCatalog 协议契约回归（docs/plugin-reference-mention.md §5）：
// session authority（冻结 catalog 直读 session record 的 App）、workspace authority
// （resolveZCodePlugins 实时投影）、session 不存在时 fail closed（不回退 workspace）。
// catalog 构建与冲突语义的机制证据在 core（plugin-reference.test.ts）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// 与 plugins-protocol.test.ts 同因：协议 handler 的 user config 解析必须与真实 HOME 隔离。
// 修复原因：vi.mock 工厂会被提升到模块顶端，若在模块作用域先建临时目录再引用，
// 依赖链里任何 import 期的 homedir() 调用都会命中 TDZ；这里把目录创建放进工厂内部。
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  const { mkdtempSync } = await import("node:fs");
  const { join: joinPath } = await import("node:path");
  const fakeHome = mkdtempSync(joinPath(actual.tmpdir(), "zcode-plugin-reference-home-"));
  (globalThis as { __pluginReferenceFakeHome?: string }).__pluginReferenceFakeHome = fakeHome;
  return { ...actual, homedir: () => fakeHome };
});

import {
  zcodeProtocolMethods,
  zcodePluginsReferenceCatalogParamsSchema,
  zcodePluginsReferenceCatalogResultSchema,
} from "@zcode/shared";
import type { PluginReferenceCatalog } from "@zcode/contracts";
import type { NativeCodexResourceSnapshot } from "@zcode/adapters/native-codex";
import { getPluginReferenceCatalog } from "../src/zcode-protocol/plugin-reference-catalog.js";
import type {
  ZCodeProtocolAgentServerContext,
  ZCodeProtocolSessionRecord,
} from "../src/zcode-protocol/server-types.js";

afterAll(async () => {
  const fakeHome = (globalThis as { __pluginReferenceFakeHome?: string }).__pluginReferenceFakeHome;
  if (fakeHome) {
    await rm(fakeHome, { force: true, recursive: true });
  }
});

const SESSION_CATALOG: PluginReferenceCatalog = {
  plugins: [
    {
      pluginId: "frozen@mkt-a",
      name: "frozen",
      marketplace: "mkt-a",
      enabled: true,
      conflictingPluginIds: [],
      skillQualifiedNames: ["frozen:probe"],
      mcpServerNames: ["plugin:frozen:main"],
      subagentNames: ["frozen:reviewer"],
      rootPath: "/plugins/frozen",
    },
  ],
};

function contextWithSession(sessionId: string): ZCodeProtocolAgentServerContext {
  const record = {
    app: {
      getPluginReferenceCatalog: () => SESSION_CATALOG,
    },
  } as unknown as ZCodeProtocolSessionRecord;
  return {
    sessions: new Map([[sessionId, record]]),
  } as unknown as ZCodeProtocolAgentServerContext;
}

describe("plugins/referenceCatalog protocol", () => {
  it("warns but retains packages with unavailable MCP and refreshes choices without mutating identity", async () => {
    const context = contextWithSession("codex-session");
    const record = context.sessions.get("codex-session")!;
    const identity: PluginReferenceCatalog = {
      plugins: [
        ...SESSION_CATALOG.plugins,
        {
          ...SESSION_CATALOG.plugins[0]!,
          name: "mcp-only",
          pluginId: "mcp-only@mkt-a",
          skillQualifiedNames: [],
          mcpServerNames: ["plugin:mcp-only:main"],
          rootPath: "/plugins/mcp-only",
        },
        {
          ...SESSION_CATALOG.plugins[0]!,
          name: "closed",
          pluginId: "closed@mkt-a",
          skillQualifiedNames: [],
          mcpServerNames: ["plugin:closed:main"],
          rootPath: "/plugins/closed",
        },
        {
          ...SESSION_CATALOG.plugins[0]!,
          name: "agent-only",
          pluginId: "agent-only@mkt-a",
          skillQualifiedNames: [],
          mcpServerNames: [],
          rootPath: "/plugins/agent-only",
        },
      ],
    };
    let snapshot: NativeCodexResourceSnapshot = {
      preferences: { codexSyncMcp: true, codexSyncSkills: true },
      mcpServers: { "plugin:mcp-only:main": { type: "stdio", command: "never-executed" } },
      skillPaths: ["/plugins/frozen/skills/probe/SKILL.md"],
    };
    record.app.runtime = { nativeTurnExecutor: {} } as never;
    record.app.getPluginReferenceCatalog = () => identity;
    record.app.getNativeCodexResourceSnapshot = vi.fn(async () => snapshot);
    record.app.getSkillCatalog = vi.fn(
      async () =>
        ({
          skills: [
            {
              name: "probe",
              qualifiedName: "frozen:probe",
              pluginName: "frozen",
              pluginId: "frozen@mkt-a",
              source: "plugin",
              path: "/plugins/frozen/skills/probe/SKILL.md",
            },
          ],
          diagnostics: [],
          totalDiscovered: 1,
        }) as never,
    );
    const before = structuredClone(identity);
    const params = {
      workspace: { workspacePath: "/w", workspaceKey: "/w" },
      sessionId: "codex-session",
    };
    const result = await getPluginReferenceCatalog(context, params, true);
    expect(result.plugins.map((entry) => entry.pluginId)).toEqual([
      "frozen@mkt-a",
      "mcp-only@mkt-a",
      "closed@mkt-a",
    ]);
    expect(result.plugins[0]).toMatchObject({
      skillQualifiedNames: ["frozen:probe"],
      mcpServerNames: [],
      subagentNames: [],
    });
    expect(result.plugins[1]).toMatchObject({
      skillQualifiedNames: [],
      mcpServerNames: ["plugin:mcp-only:main"],
      subagentNames: [],
    });
    expect(result.plugins[0]?.description).toContain(
      "MCP unavailable in Codex: plugin:frozen:main",
    );
    expect(result.plugins[0]?.descriptionI18n?.["zh-CN"]).toContain("仍可选择和调用");
    expect(result.plugins[1]?.description ?? "").not.toContain("MCP unavailable");
    expect(result.plugins[2]).toMatchObject({ mcpServerNames: [], enabled: true });
    expect(result.plugins[2]?.description).toContain("plugin:closed:main");
    expect(() => zcodePluginsReferenceCatalogResultSchema.parse(result)).not.toThrow();
    snapshot = { preferences: { codexSyncMcp: false, codexSyncSkills: false } };
    const off = (await getPluginReferenceCatalog(context, params)).plugins;
    expect(off.map((entry) => entry.pluginId)).toEqual([
      "frozen@mkt-a",
      "mcp-only@mkt-a",
      "closed@mkt-a",
    ]);
    expect(
      off.every(
        (entry) =>
          entry.description?.includes("MCP unavailable") &&
          !entry.mcpServerNames.length &&
          !entry.skillQualifiedNames.length,
      ),
    ).toBe(true);
    expect(identity).toEqual(before);
  });

  it("warns about trusted host MCP dependencies, preserves descriptions/conflicts and hides disabled packages", async () => {
    const context = contextWithSession("codex-session");
    const app = context.sessions.get("codex-session")!.app;
    const make = (name: string, marketplace: string) => ({
      ...SESSION_CATALOG.plugins[0]!,
      name,
      marketplace,
      pluginId: `${name}@${marketplace}`,
      skillQualifiedNames: [],
      mcpServerNames: [],
    });
    app.runtime = { nativeTurnExecutor: {} } as never;
    app.getPluginReferenceCatalog = () => ({
      plugins: [
        make("browser-use", "zcode-plugins-official"),
        make("computer-use", "zcode-plugins-official"),
        make("browser-use", "personal"),
        {
          ...make("conflict", "personal"),
          mcpServerNames: ["missing"],
          conflictingPluginIds: ["conflict@other"],
        },
        { ...make("disabled", "personal"), mcpServerNames: ["missing"], enabled: false },
      ],
    });
    app.getNativeCodexResourceSnapshot = vi.fn(async () => ({ preferences: {} }));
    const result = await getPluginReferenceCatalog(context, {
      workspace: { workspacePath: "/w", workspaceKey: "/w" },
      sessionId: "codex-session",
    });
    expect(result.plugins.map((entry) => entry.pluginId)).toEqual([
      "browser-use@zcode-plugins-official",
      "computer-use@zcode-plugins-official",
      "conflict@personal",
    ]);
    expect(result.plugins[0]?.description).toMatch(/^⚠ MCP unavailable in Codex: node_repl\./u);
    expect(result.plugins[0]?.descriptionI18n?.["zh-CN"]).toContain("node_repl");
    expect(result.plugins[0]?.descriptionI18n?.["zh-CN"]).toContain("浏览");
    expect(result.plugins[2]?.conflictingPluginIds).toEqual(["conflict@other"]);
    expect(() => zcodePluginsReferenceCatalogResultSchema.parse(result)).not.toThrow();
  });

  it("does not advertise Codex plugins when current resource selection cannot be read", async () => {
    const context = contextWithSession("codex-session");
    const app = context.sessions.get("codex-session")!.app;
    app.runtime = { nativeTurnExecutor: {} } as never;
    app.getNativeCodexResourceSnapshot = vi.fn(async () => {
      throw new Error("resource-selection-unavailable");
    });
    await expect(
      getPluginReferenceCatalog(context, {
        workspace: { workspacePath: "/w", workspaceKey: "/w" },
        sessionId: "codex-session",
      }),
    ).rejects.toThrow("resource-selection-unavailable");
  });
  it("registers the protocol method and schemas", () => {
    expect(zcodeProtocolMethods.pluginsReferenceCatalog).toBe("plugins/referenceCatalog");
    expect(() =>
      zcodePluginsReferenceCatalogParamsSchema.parse({
        workspace: { workspacePath: "/w", workspaceKey: "/w" },
        sessionId: "sess_x",
      }),
    ).not.toThrow();
    expect(() =>
      zcodePluginsReferenceCatalogResultSchema.parse({
        authority: "workspace",
        plugins: [
          {
            pluginId: "demo@mkt",
            name: "demo",
            marketplace: "mkt",
            icon: "https://cdn.example.com/demo.png",
            // display-only 本地化显示名投影（沿 icon 先例）：仅供 Picker 展示/搜索。
            displayName: "Demo Plugin",
            displayNameI18n: { "zh-CN": "演示插件" },
            description: "Demo description",
            descriptionI18n: { "zh-CN": "演示描述" },
            enabled: true,
            conflictingPluginIds: [],
            skillQualifiedNames: [],
            mcpServerNames: [],
            subagentNames: [],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("serves the session-owned frozen catalog when sessionId resolves (identifiers-only)", async () => {
    const result = await getPluginReferenceCatalog(contextWithSession("sess_a"), {
      workspace: { workspacePath: "/w", workspaceKey: "/w" },
      sessionId: "sess_a",
    });
    expect(result.authority).toBe("session");
    const enriched = await getPluginReferenceCatalog(
      contextWithSession("sess_a"),
      {
        workspace: { workspacePath: "/w", workspaceKey: "/w" },
        sessionId: "sess_a",
      },
      true,
    );
    expect(enriched.plugins.map((x) => x.pluginId)).toEqual(["frozen@mkt-a"]);
    expect(enriched.plugins[0]?.category).toBe("other");
    expect(result.plugins).toEqual([
      {
        pluginId: "frozen@mkt-a",
        name: "frozen",
        marketplace: "mkt-a",
        enabled: true,
        conflictingPluginIds: [],
        skillQualifiedNames: ["frozen:probe"],
        mcpServerNames: ["plugin:frozen:main"],
        subagentNames: ["frozen:reviewer"],
      },
    ]);
    expect(() => zcodePluginsReferenceCatalogResultSchema.parse(result)).not.toThrow();
  });

  it("fails closed when the sessionId is unknown instead of falling back to workspace authority", async () => {
    await expect(
      getPluginReferenceCatalog(contextWithSession("sess_a"), {
        workspace: { workspacePath: "/w", workspaceKey: "/w" },
        sessionId: "sess_missing",
      }),
    ).rejects.toThrow(/Session is not active/);
  });

  it("serves the live workspace catalog when no sessionId is provided (draft picker)", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-plugin-reference-workspace-"));
    const previousStorageDir = process.env.ZCODE_STORAGE_DIR;
    process.env.ZCODE_STORAGE_DIR = join(root, "cli");
    try {
      const result = await getPluginReferenceCatalog({} as ZCodeProtocolAgentServerContext, {
        workspace: { workspacePath: root, workspaceKey: root },
      });
      expect(result.authority).toBe("workspace");
      expect(() => zcodePluginsReferenceCatalogResultSchema.parse(result)).not.toThrow();
      // workspace catalog 来自当前发现结果：条目须有稳定 `name@marketplace` id 且不带 rootPath。
      for (const entry of result.plugins) {
        expect(entry.pluginId).toBe(`${entry.name}@${entry.marketplace}`);
      }
      const zcodeGuide = result.plugins.find(
        (entry) => entry.pluginId === "zcode-guide@zcode-plugins-official",
      );
      expect(zcodeGuide?.icon).toBe(
        "https://cdn-zcode.z.ai/zcode/official-plugin/assets/zcode-guide/icon.png",
      );
      // 内置 seed listing 的本地化显示名沿 display-only 通道进入 catalog，
      // 供 Picker 中文搜索/展示（插件 @ 引用中文搜索）。
      expect(zcodeGuide?.category).toBeUndefined();
      const enriched = await getPluginReferenceCatalog(
        {} as ZCodeProtocolAgentServerContext,
        {
          workspace: { workspacePath: root, workspaceKey: root },
        },
        true,
      );
      expect(enriched.plugins.find((x) => x.pluginId === zcodeGuide?.pluginId)?.category).toBe(
        "utilities",
      );
      expect(enriched.plugins.map((x) => x.pluginId)).toEqual(
        result.plugins.map((x) => x.pluginId),
      );
      expect(() => zcodePluginsReferenceCatalogResultSchema.parse(enriched)).not.toThrow();
      expect(zcodeGuide?.displayName).toBe("ZCode Guide");
      expect(zcodeGuide?.displayNameI18n?.["zh-CN"]).toBe("ZCode 使用指南");
      expect(zcodeGuide?.description).toEqual(expect.any(String));
      expect(zcodeGuide?.descriptionI18n?.["zh-CN"]).toEqual(expect.any(String));
      expect(
        enriched.plugins.find((x) => x.pluginId === zcodeGuide?.pluginId)?.descriptionI18n,
      ).toEqual(zcodeGuide?.descriptionI18n);
    } finally {
      if (previousStorageDir === undefined) delete process.env.ZCODE_STORAGE_DIR;
      else process.env.ZCODE_STORAGE_DIR = previousStorageDir;
      await rm(root, { force: true, recursive: true });
    }
  });
});
