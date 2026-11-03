// pnpm exec tsx packages/ui/test/browser/manual-review/pending/codex-auto-subagents.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";
import { createSettingService } from "../../../../../../packages/services/src/project-storage/startup-entry.ts";
import {
  appSettingsSchema,
  appSettingsPatchSchema,
  zcodeSessionRuntimePreferencesResultSchema,
} from "@zcode/shared";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/codex-auto-subagents.fixture.tsx";
let server, browser, origin, settings, evidence;
before(async () => {
  evidence = await mkdtemp(join(tmpdir(), "zcode-auto-subagents-browser-"));
  process.env.ZCODE_DESKTOP_HOME_DIR = evidence;
  process.env.ZCODE_DATA_BASE_DIR = evidence;
  settings = createSettingService();
  assert.equal(appSettingsSchema.parse({}).codexAutoSubagentsEnabled, false);
  assert.equal(
    appSettingsPatchSchema.safeParse({ codexAutoSubagentsEnabled: "true" }).success,
    false,
  );
  assert.equal(
    zcodeSessionRuntimePreferencesResultSchema.parse({ nativeSearchEnhancementsEnabled: true })
      .codexAutoSubagentsEnabled ?? false,
    false,
  );
  assert.equal(
    zcodeSessionRuntimePreferencesResultSchema.safeParse({
      nativeSearchEnhancementsEnabled: true,
      codexAutoSubagentsEnabled: "true",
    }).success,
    false,
  );
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "codex-auto-subagents-fixture",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            try {
              if (req.url === "/codex-auto-settings") {
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
      test(`Codex auto subagents ${width}/${locale}/${theme}`, async () => {
        await settings.update({ codexAutoSubagentsEnabled: false });
        const page = await browser.newPage({
          viewport: { width, height: 844 },
          hasTouch: width === 390,
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        try {
          await page.goto(`${origin}fixture?locale=${locale}&theme=${theme}`, { timeout: 90000 });
          const toggle = page.getByRole("switch");
          await toggle.waitFor();
          await page.waitForFunction(() => !document.querySelector('[role="switch"]').disabled);
          assert.equal(await toggle.getAttribute("aria-checked"), "false");
          await toggle.click();
          await page.waitForFunction(
            () => document.querySelector('[role="switch"]').getAttribute("aria-checked") === "true",
          );
          assert.equal((await settings.get()).codexAutoSubagentsEnabled, true);
          await page.waitForFunction(() => {
            const thumb = document.querySelector('[data-slot="switch-thumb"]');
            const track = document.querySelector('[role="switch"]');
            return (
              thumb &&
              track &&
              thumb.getBoundingClientRect().left - track.getBoundingClientRect().left > 10
            );
          });
          await page.reload();
          await toggle.waitFor();
          await page.waitForFunction(
            () => document.querySelector('[role="switch"]').getAttribute("aria-checked") === "true",
          );
          await mkdir(evidence, { recursive: true });
          await page.screenshot({
            path: join(evidence, `${width}-${locale}-${theme}.png`),
            fullPage: true,
        animations: "disabled",
          });
          await page.route("**/codex-auto-settings", (route) =>
            route.request().method() === "POST"
              ? route.fulfill({ status: 500, body: "Save failed" })
              : route.continue(),
          );
          await toggle.click();
          await page.getByRole("alert").waitFor();
          assert.equal(await toggle.getAttribute("aria-checked"), "true");
          assert.equal((await settings.get()).codexAutoSubagentsEnabled, true);
          await page.unroute("**/codex-auto-settings");
          await toggle.click();
          await page.waitForFunction(
            () =>
              document.querySelector('[role="switch"]').getAttribute("aria-checked") === "false",
          );
          assert.equal((await settings.get()).codexAutoSubagentsEnabled, false);
          const reloadedService = createSettingService();
          assert.equal((await reloadedService.get()).codexAutoSubagentsEnabled, false);
          assert.deepEqual(errors, []);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        } finally {
          await page.close();
        }
      });
    }
