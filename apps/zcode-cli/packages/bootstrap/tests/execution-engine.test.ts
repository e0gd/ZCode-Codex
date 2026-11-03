import { chmod, mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import { createRegistryBackedTestApp } from "./helpers/registry-backed-test-app.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("session execution engine assembly", () => {
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
      await expect(createRegistryBackedTestApp({ ...common, env: { PATH: "" } })).rejects.toThrow("Install the official Codex CLI");
    } finally {
      await sessionStore.close();
    }
  });
});
