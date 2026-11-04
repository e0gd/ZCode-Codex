// pnpm exec tsx packages/ui/test/browser/manual-review/pending/native-codex-subagents.test.mjs
// Core child events -> production projection -> production spawn rows and robot -> completed/reloaded child navigation.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";
import { createTestAgentRuntime } from "../../../../../../apps/zcode-cli/packages/core/tests/test-agent-runtime.ts";
import { createTestSessionEventStore } from "../../../../../../apps/zcode-cli/packages/core/tests/test-event-store.ts";
import { createRecordingMessageStore } from "../../../../../../apps/zcode-cli/packages/core/tests/runtime-output-token-continuation-test-helpers.ts";
import { ProductProjection } from "../../../../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/product-projection.ts";
import { createSessionId } from "../../../../../../apps/zcode-cli/packages/contracts/src/index.ts";
import { conversationSnapshotSchema } from "@zcode/shared/zcode-protocol-v4";
const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/native-codex-subagents.fixture.tsx";
let server, browser, origin, finish, turn;
before(async () => {
  const sessionId = createSessionId("native-child-browser"); const projections = new Map();
  const ready = Promise.withResolvers(); const release = Promise.withResolvers(); finish = release.resolve;
  const runtime = createTestAgentRuntime(sessionId, { workingDirectory: process.cwd(), titleGeneration: { enabled: false } }, {
    eventStore: createTestSessionEventStore(), sessionStore: createRecordingMessageStore(),
    modelFactory() { throw Error("ZCode model loop must not run"); },
    nativeTurnExecutor: { async execute(input) {
      for (const agentId of ["a", "b"]) {
        await input.onEvent({ type: "toolStarted", id: "spawn-" + agentId, name: "Agent", input: { prompt: "Child " + agentId, description: "Child " + agentId, run_in_background: true } });
        await input.onEvent({ type: "subagentUpdated", agentId, parentToolCallId: "spawn-" + agentId, agentType: "Codex", prompt: "Child " + agentId,
          turnId: "turn-" + agentId, status: "running", items: [{ type: "text", id: "text", text: "LIVE_CHILD_" + agentId, completed: false }] });
      }
      ready.resolve(); await release.promise;
      for (const agentId of ["a", "b"]) {
        await input.onEvent({ type: "subagentUpdated", agentId, parentToolCallId: "spawn-" + agentId, agentType: "Codex", prompt: "Child " + agentId,
          turnId: "turn-" + agentId, status: "success", items: [{ type: "text", id: "text", text: "LIVE_CHILD_" + agentId + "_FINAL", completed: true }] });
        await input.onEvent({ type: "toolCompleted", id: "spawn-" + agentId, name: "Agent", output: "Child completed" });
      }
      return { text: "", threadId: "parent", toolCallCount: 2 };
    } },
  });
  runtime.subscribeEvents({ onSessionEvent(event) {
    let projection = projections.get(event.sessionId);
    if (!projection) { projection = new ProductProjection(event.sessionId, "browser"); projections.set(event.sessionId, projection); }
    projection.applyEvent(event);
  } });
  turn = runtime.executeTurn("Explicitly delegate"); await Promise.race([ready.promise, turn]);
  const snapshot = conversationSnapshotSchema.parse(projections.get(sessionId).getSnapshot());
  assert.equal(snapshot.subagents.running.length, 2);
  const children = Object.fromEntries(snapshot.subagents.running.map(child => [child.childSessionId, conversationSnapshotSchema.parse(projections.get(child.childSessionId).getSnapshot())]));
  release.resolve(); await turn;
  const completedSnapshot = conversationSnapshotSchema.parse(projections.get(sessionId).getSnapshot());
  assert.equal(completedSnapshot.subagents.running.length, 0);
  assert.equal(completedSnapshot.rows.window.filter(row => row.kind === "subagent").length, 2);
  const completedChildren = Object.fromEntries(Object.keys(children).map(childId => [childId, conversationSnapshotSchema.parse(projections.get(childId).getSnapshot())]));
  const stages = { running: {snapshot, children}, completed: {snapshot: completedSnapshot, children: completedChildren} };
  server = await createServer({ root, configFile: false,
    plugins: [react(), tailwindcss(), { name: "native-child-browser", configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url === "/native-child-data") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(stages)); }
        else if (req.url?.startsWith("/fixture?")) { res.setHeader("Content-Type", "text/html"); res.end(await vite.transformIndexHtml(req.url,
          `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`)); }
        else next();
      });
    } }], resolve: { alias: { "@": `${root}packages/ui/src` } }, optimizeDeps: { entries: [entry.slice(1)] }, server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen(); origin = server.resolvedUrls.local[0];
  browser = await chromium.launch(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {});
});
after(async () => { finish?.(); await turn; await browser?.close(); await server?.close(); });
for (const width of [390, 1200]) for (const locale of ["zh-CN", "en-US"]) for (const theme of ["zai-light", "zai-dark"]) {
  test(`native robot and child navigation ${width} ${locale} ${theme}`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width === 390, locale });
    const page = await context.newPage(); const errors = []; page.on("pageerror", e => errors.push(e.message));
    try {
      await page.goto(new URL(`/fixture?locale=${locale}&theme=${theme}`, origin).href, { timeout: 90000 });
      const spawnRecords = page.getByTestId("native-spawn-records");
      const spawnLinks = spawnRecords.locator('[data-testid^="v4-subagent-open-side-pane-"]');
      await spawnLinks.first().waitFor({ timeout: 15000 }).catch(async error => { throw new Error(`${error.message}; page errors=${JSON.stringify(errors)}; body=${await page.locator("body").innerText()}`); });
      assert.equal(await spawnLinks.count(), 2, "Both production message spawn rows must render");
      await page.locator('button[data-testid="v4-composer-background-work-trigger"]').click();
      await page.locator('button[data-running-subagent-session-trigger][data-child-session-id$="_a"]').click();
      assert.equal(await page.getByTestId("selected-child").textContent(), "LIVE_CHILD_a");
      assert.match(await page.getByTestId("selected-child").getAttribute("data-child-session-id"), /_a$/);
      await page.getByTestId("complete-native-children").click();
      await page.locator('main[data-stage="completed"]').waitFor();
      assert.equal(await page.getByTestId("v4-composer-background-work-trigger").count(), 0, "Completed children must not retain the running robot");
      assert.equal(await spawnLinks.count(), 2, "Completion preserves both spawn records");
      await spawnLinks.first().click();
      assert.equal(await page.getByTestId("selected-child").textContent(), "LIVE_CHILD_a_FINAL");
      await page.reload();
      await page.locator('main[data-stage="completed"]').waitFor();
      assert.equal(await page.getByTestId("v4-composer-background-work-trigger").count(), 0);
      assert.equal(await spawnLinks.count(), 2, "Reload preserves completed spawn records");
      await spawnLinks.nth(1).click();
      assert.equal(await page.getByTestId("selected-child").textContent(), "LIVE_CHILD_b_FINAL");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Completed spawn rows must fit the viewport");
      assert.deepEqual(errors, []);
      const artifacts = join(tmpdir(), "zcode-native-child-browser"); await mkdir(artifacts, { recursive: true });
      await page.screenshot({ path: join(artifacts, `${width}-${locale}-${theme}.png`), fullPage: true, animations: "disabled" });
    } finally { await context.close(); }
  });
}
