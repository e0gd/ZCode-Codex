// pnpm exec tsx packages/ui/test/browser/manual-review/pending/codex-resources.test.mjs
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";
import { createSettingService } from "../../../../../../packages/services/src/project-storage/startup-entry.ts";
import { appSettingsPatchSchema } from "@zcode/shared";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/codex-resources.fixture.tsx";
let server, browser, origin, settings, evidence;
before(async () => {
  evidence = await mkdtemp(join(tmpdir(), "zcode-codex-resources-browser-"));
  process.env.ZCODE_DESKTOP_HOME_DIR = evidence;
  process.env.ZCODE_DATA_BASE_DIR = evidence;
  settings = createSettingService();
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "codex-resources-fixture",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            try {
              if (req.url === "/codex-resource-settings") {
                if (req.method === "POST") {
                  const chunks = [];
                  for await (const chunk of req) chunks.push(chunk);
                  await settings.update(
                    appSettingsPatchSchema.parse(
                      JSON.parse(Buffer.concat(chunks).toString("utf8")),
                    ),
                  );
                }
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(await settings.get()));
              } else if (req.url?.startsWith("/codex-mcp-candidates?")) {
                res.setHeader("Content-Type", "application/json");
                const workspace = new URL(req.url, "http://fixture").searchParams.get("workspace");
                res.end(
                  JSON.stringify(
                    workspace === "/fixture/two"
                      ? [{ name: "second-workspace", compatible: true, enabled: true }]
                      : [
                          { name: "compatible-stdio", compatible: true, enabled: true },
                          {
                            name: "plugin:image-search:image_search",
                            compatible: false,
                            enabled: true,
                            reason: "managed_auth",
                          },
                          {
                            name: "disabled-http",
                            compatible: true,
                            enabled: false,
                            reason: "disabled",
                          },
                          {
                            name: "untrusted-project",
                            compatible: true,
                            enabled: false,
                            reason: "untrusted",
                          },
                        ],
                  ),
                );
              } else if (req.url?.startsWith("/codex-skill-candidates?")) {
                res.setHeader("Content-Type", "application/json");
                const workspace = new URL(req.url, "http://fixture").searchParams.get("workspace");
                res.end(
                  JSON.stringify(
                    workspace === "/fixture/two"
                      ? [
                          {
                            name: "second-workspace-skill",
                            path: "/fixture/two/skills/second/SKILL.md",
                            scope: "workspace",
                            enabled: true,
                          },
                        ]
                      : [
                          {
                            name: "shared-skill",
                            path: "C:/Fixture/User/shared/SKILL.md",
                            scope: "user",
                            enabled: true,
                          },
                          {
                            name: "shared-skill",
                            path: "C:/Fixture/Workspace/shared/SKILL.md",
                            scope: "workspace",
                            enabled: true,
                          },
                          {
                            name: "disabled-skill",
                            path: "C:/Fixture/Plugins/disabled/SKILL.md",
                            scope: "plugin",
                            pluginName: "fixture-plugin",
                            enabled: false,
                          },
                        ],
                  ),
                );
              } else if (req.url?.startsWith("/fixture?")) {
                res.setHeader("Content-Type", "text/html");
                res.end(
                  await vite.transformIndexHtml(
                    req.url,
                    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
                  ),
                );
              } else next();
            } catch {
              res.statusCode = 500;
              res.end("Fixture failed");
            }
          });
        },
      },
    ],
    resolve: { alias: { "@": `${root}packages/ui/src` } },
    optimizeDeps: { entries: [entry.slice(1)] },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
  browser = await chromium.launch(
    process.env.CHROME_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
      : {},
  );
});
after(async () => {
  await browser?.close();
  await server?.close();
  console.log("Browser evidence:", evidence);
});

for (const width of [390, 1200])
  for (const locale of ["zh-CN", "en-US"])
    for (const theme of ["light", "dark"]) {
      test(`Codex resources ${width}/${locale}/${theme}`, async () => {
        await settings.update({
          codexMcpConfigPath: "",
          codexSkillRoots: [],
          codexSyncMcp: false,
          codexSyncSkills: false,
          codexMcpDisabledServers: ["not-currently-listed"],
          codexSkillDisabledPaths: ["C:/Not-currently-listed/SKILL.md"],
        });
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
          hasTouch: width === 390,
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        try {
          await page.goto(`${origin}fixture?locale=${locale}&theme=${theme}`, { timeout: 90000 });
          const mcp = page.locator('[data-testid="codex-mcp-config-path"]');
          const skills = page.locator('[data-testid="codex-skill-roots"]');
          const mcpSync = page.locator('[data-testid="codex-sync-mcp"]');
          const skillSync = page.locator('[data-testid="codex-sync-skills"]');
          const save = page.locator('[data-testid="codex-resources-save"]');
          await mcp.waitFor();
          assert.equal(await page.locator("main").getAttribute("data-codex-navigation"), "true");
          await page.waitForFunction(
            () => !document.querySelector('[data-testid="codex-mcp-config-path"]').disabled,
          );
          assert.equal(await mcp.inputValue(), "");
          assert.equal(await skills.inputValue(), "");
          assert.equal(await mcpSync.getAttribute("aria-checked"), "false");
          assert.equal(await skillSync.getAttribute("aria-checked"), "false");
          await mcp.fill("C:\\Codex Config\\config.toml");
          await skills.fill("C:\\Codex Skills\nC:\\More Skills");
          await save.click();
          await page.getByRole("status").waitFor();
          assert.equal((await settings.get()).codexMcpConfigPath, "C:\\Codex Config\\config.toml");
          assert.deepEqual((await settings.get()).codexSkillRoots, [
            "C:\\Codex Skills",
            "C:\\More Skills",
          ]);
          await mcpSync.click();
          assert(await mcp.isDisabled());
          const mcpToggle = page.getByTestId("codex-mcp-catalog-toggle");
          assert.equal(await mcpToggle.getAttribute("aria-expanded"), "false");
          await mcpToggle.click();
          const compatible = page.locator(
            '[data-testid="codex-mcp-candidate"][data-name="compatible-stdio"]',
          );
          const incompatible = page.locator(
            '[data-testid="codex-mcp-candidate"][data-name="plugin:image-search:image_search"]',
          );
          await compatible.waitFor();
          assert.equal(await compatible.getAttribute("aria-checked"), "true");
          assert.equal(await incompatible.getAttribute("aria-checked"), "false");
          assert(await incompatible.isDisabled());
          assert(
            await page
              .locator('[data-testid="codex-mcp-candidate"][data-name="disabled-http"]')
              .isDisabled(),
          );
          assert(
            await page
              .locator('[data-testid="codex-mcp-candidate"][data-name="untrusted-project"]')
              .isDisabled(),
          );
          await compatible.click();
          assert(!(await skills.isDisabled()));
          await skillSync.click();
          assert(await skills.isDisabled());
          const skillToggle = page.getByTestId("codex-skill-catalog-toggle");
          assert.equal(await skillToggle.getAttribute("aria-expanded"), "false");
          await skillToggle.click();
          const userSkill = page.locator(
            '[data-testid="codex-skill-candidate"][data-path="C:/Fixture/User/shared/SKILL.md"]',
          );
          const workspaceSkill = page.locator(
            '[data-testid="codex-skill-candidate"][data-path="C:/Fixture/Workspace/shared/SKILL.md"]',
          );
          const disabledSkill = page.locator(
            '[data-testid="codex-skill-candidate"][data-name="disabled-skill"]',
          );
          await userSkill.waitFor();
          assert.equal(await userSkill.getAttribute("aria-checked"), "true");
          assert.equal(await workspaceSkill.getAttribute("aria-checked"), "true");
          assert.equal(await disabledSkill.getAttribute("aria-checked"), "false");
          assert(await disabledSkill.isDisabled());
          await userSkill.click();
          assert.equal(await workspaceSkill.getAttribute("aria-checked"), "true");
          await save.click();
          await page.getByRole("status").waitFor();
          assert.deepEqual((await settings.get()).codexMcpDisabledServers, [
            "not-currently-listed",
            "compatible-stdio",
          ]);
          assert.deepEqual((await settings.get()).codexSkillDisabledPaths, [
            "C:/Not-currently-listed/SKILL.md",
            "C:/Fixture/User/shared/SKILL.md",
          ]);
          await page.reload();
          await page.waitForFunction(
            () =>
              document
                .querySelector('[data-testid="codex-sync-mcp"]')
                ?.getAttribute("aria-checked") === "true",
          );
          assert(await mcp.isDisabled());
          assert(await skills.isDisabled());
          await mcpToggle.click();
          await skillToggle.click();
          await compatible.waitFor();
          assert.equal(await compatible.getAttribute("aria-checked"), "false");
          await userSkill.waitFor();
          assert.equal(await userSkill.getAttribute("aria-checked"), "false");
          assert.equal(await workspaceSkill.getAttribute("aria-checked"), "true");
          assert.equal(await mcp.inputValue(), "C:\\Codex Config\\config.toml");
          await page.screenshot({
            path: join(evidence, `${width}-${locale}-${theme}.png`),
            fullPage: true,
            animations: "disabled",
          });
          await page.getByTestId("codex-skill-catalog").screenshot({
            path: join(evidence, `skills-${width}-${locale}-${theme}.png`),
            animations: "disabled",
          });
          await mcpSync.click();
          await mcp.fill("C:\\Unsaved\\config.toml");
          await workspaceSkill.click();
          await page.route("**/codex-resource-settings", (route) =>
            route.request().method() === "POST"
              ? route.fulfill({ status: 500, body: "Save failed" })
              : route.continue(),
          );
          await save.click();
          await page.getByRole("alert").waitFor();
          assert.equal(await mcp.inputValue(), "C:\\Unsaved\\config.toml");
          assert.equal((await settings.get()).codexMcpConfigPath, "C:\\Codex Config\\config.toml");
          assert.equal((await settings.get()).codexSyncMcp, true);
          assert.equal(await userSkill.getAttribute("aria-checked"), "false");
          assert.equal(await workspaceSkill.getAttribute("aria-checked"), "false");
          assert(
            !(await settings.get()).codexSkillDisabledPaths.includes(
              "C:/Fixture/Workspace/shared/SKILL.md",
            ),
          );
          await page.unroute("**/codex-resource-settings");
          await workspaceSkill.click();
          await mcp.fill("");
          await skillSync.click();
          await skills.fill("");
          await save.click();
          await page.getByRole("status").waitFor();
          const reloaded = await createSettingService().get();
          assert.equal(reloaded.codexMcpConfigPath, "");
          assert.deepEqual(reloaded.codexSkillRoots, []);
          assert.equal(reloaded.codexSyncMcp, false);
          assert.equal(reloaded.codexSyncSkills, false);
          assert.deepEqual(reloaded.codexMcpDisabledServers, [
            "not-currently-listed",
            "compatible-stdio",
          ]);
          assert.deepEqual(reloaded.codexSkillDisabledPaths, [
            "C:/Not-currently-listed/SKILL.md",
            "C:/Fixture/User/shared/SKILL.md",
          ]);
          if (width === 390 && locale === "zh-CN" && theme === "light") {
            await skills.fill(
              Array.from({ length: 33 }, (_, index) => `C:\\Skills${index}`).join("\n"),
            );
            assert(await save.isDisabled());
            await page.getByRole("alert").waitFor();
            await skills.fill(`C:\\${"a".repeat(4097)}`);
            assert(await save.isDisabled());
            await skills.fill("relative-directory");
            await save.click();
            await page.getByRole("alert").waitFor();
            assert.deepEqual((await settings.get()).codexSkillRoots, []);
            assert.equal(await skills.inputValue(), "relative-directory");
          }
          assert.deepEqual(errors, []);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        } finally {
          await page.close();
        }
      });
    }

test("MCP catalog failure, retry, empty and stale workspace results", async () => {
  await settings.update({
    codexSyncMcp: true,
    codexSyncSkills: false,
    codexMcpDisabledServers: [],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
  try {
    await page.route("**/codex-mcp-candidates?*", (route) =>
      route.fulfill({ status: 500, body: "Catalog unavailable" }),
    );
    await page.goto(`${origin}fixture?locale=zh-CN&theme=light`, { timeout: 90000 });
    await page.getByTestId("codex-mcp-catalog-toggle").click();
    await page.getByTestId("codex-mcp-catalog-error").waitFor();
    await page.screenshot({ path: join(evidence, "catalog-load-error.png"), fullPage: true });
    await page.unroute("**/codex-mcp-candidates?*");
    await page.getByTestId("codex-mcp-catalog-retry").click();
    await page
      .locator('[data-testid="codex-mcp-candidate"][data-name="compatible-stdio"]')
      .waitFor();
    await page.route("**/codex-mcp-candidates?*", (route) => route.fulfill({ json: [] }));
    await page.getByTestId("codex-mcp-catalog-refresh").click();
    await page.getByTestId("codex-mcp-catalog-empty").waitFor();
    await page.screenshot({ path: join(evidence, "catalog-empty.png"), fullPage: true });
    await page.unroute("**/codex-mcp-candidates?*");
    let firstRequest;
    const requestHeld = new Promise((resolve) => {
      firstRequest = resolve;
    });
    let releaseFirst;
    const released = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    await page.route("**/codex-mcp-candidates?*", async (route) => {
      if (new URL(route.request().url()).searchParams.get("workspace") === "/fixture/one") {
        firstRequest();
        await released;
        await route.fulfill({
          json: [{ name: "stale-old-host", compatible: true, enabled: true }],
        });
      } else await route.continue();
    });
    await page.getByTestId("codex-mcp-catalog-refresh").click();
    await requestHeld;
    await page.getByTestId("fixture-workspace-switch").click();
    await page
      .locator('[data-testid="codex-mcp-candidate"][data-name="second-workspace"]')
      .waitFor();
    releaseFirst();
    await page.waitForTimeout(100);
    assert.equal(
      await page.locator('[data-testid="codex-mcp-candidate"][data-name="stale-old-host"]').count(),
      0,
    );
    await page.screenshot({ path: join(evidence, "catalog-new-workspace.png"), fullPage: true });
    await page.getByTestId("fixture-workspace-clear").click();
    await page.getByTestId("codex-mcp-catalog-unavailable").waitFor();
    assert.equal(await page.getByTestId("codex-mcp-candidate").count(), 0);
  } finally {
    await page.close();
  }
});

test("Skill catalog failure, retry, empty, stale workspace and sync-off behavior", async () => {
  await settings.update({
    codexSyncMcp: false,
    codexSyncSkills: true,
    codexSkillDisabledPaths: [],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
  try {
    await page.route("**/codex-skill-candidates?*", (route) =>
      route.fulfill({ status: 500, body: "Skill catalog unavailable" }),
    );
    await page.goto(`${origin}fixture?locale=zh-CN&theme=light`, { timeout: 90000 });
    await page.getByTestId("codex-skill-catalog-toggle").click();
    await page.getByTestId("codex-skill-catalog-error").waitFor();
    await page.unroute("**/codex-skill-candidates?*");
    await page.getByTestId("codex-skill-catalog-retry").click();
    await page
      .locator('[data-testid="codex-skill-candidate"][data-name="shared-skill"]')
      .first()
      .waitFor();
    await page.route("**/codex-skill-candidates?*", (route) => route.fulfill({ json: [] }));
    await page.getByTestId("codex-skill-catalog-refresh").click();
    await page.getByTestId("codex-skill-catalog-empty").waitFor();
    await page.unroute("**/codex-skill-candidates?*");
    let firstRequest;
    const requestHeld = new Promise((resolve) => {
      firstRequest = resolve;
    });
    let releaseFirst;
    const released = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    await page.route("**/codex-skill-candidates?*", async (route) => {
      if (new URL(route.request().url()).searchParams.get("workspace") === "/fixture/one") {
        firstRequest();
        await released;
        await route.fulfill({
          json: [
            { name: "stale-old-skill", path: "/stale/SKILL.md", scope: "user", enabled: true },
          ],
        });
      } else await route.continue();
    });
    await page.getByTestId("codex-skill-catalog-refresh").click();
    await requestHeld;
    await page.getByTestId("fixture-workspace-switch").click();
    await page
      .locator('[data-testid="codex-skill-candidate"][data-name="second-workspace-skill"]')
      .waitFor();
    releaseFirst();
    await page.waitForTimeout(100);
    assert.equal(
      await page
        .locator('[data-testid="codex-skill-candidate"][data-name="stale-old-skill"]')
        .count(),
      0,
    );
    await page.getByTestId("fixture-workspace-clear").click();
    await page.getByTestId("codex-skill-catalog-unavailable").waitFor();
    assert.equal(await page.getByTestId("codex-skill-candidate").count(), 0);
    await page.getByTestId("codex-sync-skills").click();
    let requests = 0;
    await page.route("**/codex-skill-candidates?*", (route) => {
      requests++;
      return route.continue();
    });
    await page.getByTestId("fixture-workspace-switch").click();
    await page.waitForTimeout(100);
    assert.equal(requests, 0);
    assert.equal(await page.getByTestId("codex-skill-catalog").count(), 0);
  } finally {
    await page.close();
  }
});

test("Skill exclusions use Host path identity independently of browser OS", async () => {
  await settings.update({
    codexSyncMcp: false,
    codexSyncSkills: true,
    codexSkillDisabledPaths: ["c:\\fixture\\user\\SHARED\\SKILL.md", "/fixture/Case/SKILL.md"],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  try {
    await page.route("**/codex-skill-candidates?*", (route) =>
      route.fulfill({
        json: [
          {
            name: "Windows skill",
            path: "C:/Fixture/User/shared/SKILL.md",
            scope: "user",
            enabled: true,
          },
          {
            name: "POSIX upper",
            path: "/fixture/Case/SKILL.md",
            scope: "workspace",
            enabled: true,
          },
          {
            name: "POSIX lower",
            path: "/fixture/case/SKILL.md",
            scope: "workspace",
            enabled: true,
          },
        ],
      }),
    );
    await page.goto(`${origin}fixture?locale=en-US&theme=dark`, { timeout: 90000 });
    await page.getByTestId("codex-skill-catalog-toggle").click();
    const windows = page.locator(
      '[data-testid="codex-skill-candidate"][data-name="Windows skill"]',
    );
    const upper = page.locator('[data-testid="codex-skill-candidate"][data-name="POSIX upper"]');
    const lower = page.locator('[data-testid="codex-skill-candidate"][data-name="POSIX lower"]');
    await windows.waitFor();
    assert.equal(await windows.getAttribute("aria-checked"), "false");
    assert.equal(await upper.getAttribute("aria-checked"), "false");
    assert.equal(await lower.getAttribute("aria-checked"), "true");
    await windows.click();
    await page.getByTestId("codex-resources-save").click();
    await page.getByRole("status").waitFor();
    assert.deepEqual((await settings.get()).codexSkillDisabledPaths, ["/fixture/Case/SKILL.md"]);
  } finally {
    await page.close();
  }
});

for (const width of [390, 1200]) {
  test(`Resource catalogs collapse independently with many entries ${width}`, async () => {
    await settings.update({
      codexSyncMcp: true,
      codexSyncSkills: true,
      codexMcpDisabledServers: [],
      codexSkillDisabledPaths: [],
      codexMcpConfigPath: "",
      codexSkillRoots: [],
    });
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
    });
    const rows = 80;
    try {
      await page.route("**/codex-mcp-candidates?*", (route) =>
        route.fulfill({
          json: Array.from({ length: rows }, (_, index) => ({
            name: `service-${index}`,
            compatible: true,
            enabled: true,
          })),
        }),
      );
      await page.route("**/codex-skill-candidates?*", (route) =>
        route.fulfill({
          json: Array.from({ length: rows }, (_, index) => ({
            name: `skill-${index}`,
            path: `/fixture/skills/${index}/SKILL.md`,
            scope: "workspace",
            enabled: true,
          })),
        }),
      );
      await page.goto(
        `${origin}fixture?locale=${width === 390 ? "zh-CN" : "en-US"}&theme=${width === 390 ? "light" : "dark"}`,
        { timeout: 90000 },
      );
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="codex-sync-mcp"]')?.getAttribute("aria-checked") ===
          "true",
      );
      const mcpToggle = page.getByTestId("codex-mcp-catalog-toggle");
      const skillToggle = page.getByTestId("codex-skill-catalog-toggle");
      assert.equal(await mcpToggle.count(), 1);
      assert.equal(await skillToggle.count(), 1);
      assert.equal(await mcpToggle.getAttribute("aria-expanded"), "false");
      assert.equal(await skillToggle.getAttribute("aria-expanded"), "false");
      assert.equal(await page.getByTestId("codex-mcp-candidate").isVisible(), false);
      assert.equal(await page.getByTestId("codex-skill-candidate").isVisible(), false);
      await mcpToggle.focus();
      await page.keyboard.press("Enter");
      await page.getByTestId("codex-mcp-candidate").first().waitFor();
      assert.equal(await skillToggle.getAttribute("aria-expanded"), "false");
      await page.locator('[data-testid="codex-mcp-candidate"][data-name="service-0"]').click();
      await skillToggle.click();
      await page.getByTestId("codex-skill-candidate").first().waitFor();
      await page.locator('[data-testid="codex-skill-candidate"][data-name="skill-0"]').click();
      for (const kind of ["mcp", "skill"]) {
        const list = page.getByTestId(`codex-${kind}-catalog-list`);
        assert(
          await list.evaluate(
            (element) =>
              element.scrollHeight > element.clientHeight &&
              element.clientHeight <= 320 &&
              getComputedStyle(element).overflowY === "auto",
          ),
        );
        await list.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        assert(await list.evaluate((element) => element.scrollTop > 0));
      }
      await mcpToggle.click();
      assert.equal(await mcpToggle.getAttribute("aria-expanded"), "false");
      assert.equal(await skillToggle.getAttribute("aria-expanded"), "true");
      await mcpToggle.click();
      const selectedMcp = page.locator(
        '[data-testid="codex-mcp-candidate"][data-name="service-0"]',
      );
      await selectedMcp.waitFor();
      assert.equal(await selectedMcp.getAttribute("aria-checked"), "false");
      await skillToggle.click();
      await skillToggle.click();
      const selectedSkill = page.locator(
        '[data-testid="codex-skill-candidate"][data-name="skill-0"]',
      );
      await selectedSkill.waitFor();
      assert.equal(await selectedSkill.getAttribute("aria-checked"), "false");
      const save = page.getByTestId("codex-resources-save");
      await save.scrollIntoViewIfNeeded();
      assert(await save.isVisible());
      await save.click();
      await page.getByRole("status").waitFor();
      assert.deepEqual((await settings.get()).codexMcpDisabledServers, ["service-0"]);
      assert.deepEqual((await settings.get()).codexSkillDisabledPaths, [
        "/fixture/skills/0/SKILL.md",
      ]);
      await mcpToggle.click();
      await skillToggle.click();
      await page.screenshot({
        path: join(evidence, `collapsed-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    } finally {
      await page.close();
    }
  });
}
