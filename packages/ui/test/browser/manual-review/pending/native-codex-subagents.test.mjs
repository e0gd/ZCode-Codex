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
  const ready = Promise.withResolvers(); const previewReady = Promise.withResolvers();
  const previewRelease = Promise.withResolvers(); const release = Promise.withResolvers(); finish = release.resolve;
  const command = agentId => `printf 'CHILD_TOOL_${agentId}'`;
  const childTools = agentId => [{ type: "tool", id: "short-" + agentId, name: "Bash", input: { command: command(agentId) }, output: "CHILD_TOOL_OUTPUT_" + agentId, completed: true, failed: false }];
  const runtime = createTestAgentRuntime(sessionId, { workingDirectory: process.cwd(), titleGeneration: { enabled: false } }, {
    eventStore: createTestSessionEventStore(), sessionStore: createRecordingMessageStore(),
    modelFactory() { throw Error("ZCode model loop must not run"); },
    nativeTurnExecutor: { async execute(input) {
      for (const agentId of ["a", "b"]) {
        await input.onEvent({ type: "toolStarted", id: "spawn-" + agentId, name: "Agent", input: { prompt: "Child " + agentId, description: "Child " + agentId, run_in_background: true } });
        await input.onEvent({ type: "subagentUpdated", agentId, parentToolCallId: "spawn-" + agentId, agentType: "Codex", prompt: "Child " + agentId,
          turnId: "turn-" + agentId, inputText: "CHILD_ACTUAL_INPUT_" + agentId, status: "running", items: childTools(agentId) });
      }
      ready.resolve(); await previewRelease.promise;
      for (const agentId of ["a", "b"]) await input.onEvent({ type: "subagentUpdated", agentId, parentToolCallId: "spawn-" + agentId, agentType: "Codex", prompt: "Child " + agentId,
        turnId: "turn-" + agentId, inputText: "CHILD_ACTUAL_INPUT_" + agentId, status: "running", items: [...childTools(agentId),
          { type: "tool", id: "long-" + agentId, name: "Bash", input: { command: "printf 'LONG_CHILD_" + agentId + "'; sleep 10" }, output: "RUNNING_CHILD_PREVIEW_" + agentId, completed: false, failed: false }] });
      previewReady.resolve(); await release.promise;
      for (const agentId of ["a", "b"]) {
        await input.onEvent({ type: "subagentUpdated", agentId, parentToolCallId: "spawn-" + agentId, agentType: "Codex", prompt: "Child " + agentId,
          turnId: "turn-" + agentId, inputText: "CHILD_ACTUAL_INPUT_" + agentId, status: "success", items: [...childTools(agentId),
            { type: "tool", id: "long-" + agentId, name: "Bash", input: { command: "printf 'LONG_CHILD_" + agentId + "'; sleep 10" }, output: "RUNNING_CHILD_PREVIEW_" + agentId + "\nFINAL_CHILD_TOOL_" + agentId, completed: true, failed: false },
            { type: "text", id: "text", text: "LIVE_CHILD_" + agentId + "_FINAL", completed: true }] });
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
  for (const child of Object.values(children)) {
    assert.equal(child.rows.window.filter(row => row.kind === "assistantText").length, 0);
    assert.equal(child.rows.window.filter(row => row.kind === "toolCall" && row.status === "success").length, 1);
  }
  previewRelease.resolve(); await previewReady.promise;
  const previewSnapshot = conversationSnapshotSchema.parse(projections.get(sessionId).getSnapshot());
  const previewChildren = Object.fromEntries(Object.keys(children).map(childId => [childId, conversationSnapshotSchema.parse(projections.get(childId).getSnapshot())]));
  release.resolve(); await turn;
  const completedSnapshot = conversationSnapshotSchema.parse(projections.get(sessionId).getSnapshot());
  assert.equal(completedSnapshot.subagents.running.length, 0);
  assert.equal(completedSnapshot.rows.window.filter(row => row.kind === "subagent").length, 2);
  const completedChildren = Object.fromEntries(Object.keys(children).map(childId => [childId, conversationSnapshotSchema.parse(projections.get(childId).getSnapshot())]));
  const stages = { running: {snapshot, children}, preview: {snapshot: previewSnapshot, children: previewChildren}, completed: {snapshot: completedSnapshot, children: completedChildren} };
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
      const childPane = page.getByTestId("selected-child");
      assert.match(await childPane.getAttribute("data-child-session-id"), /_a$/);
      await childPane.getByText("CHILD_ACTUAL_INPUT_a", { exact: true }).waitFor({ timeout: 10000 });
      const shortTool = childPane.locator('[data-child-tool-id="short-a"]');
      await shortTool.getByTestId("tool-summary-trigger-short-a").click();
      assert.match(await shortTool.innerText(), /CHILD_TOOL_a/);
      await shortTool.getByText("CHILD_TOOL_OUTPUT_a", { exact: true }).waitFor({ timeout: 10000 });
      assert.equal(await childPane.locator('[data-child-row-kind="assistantText"]').count(), 0, "Child pane must show tools before any assistant text exists");
      await page.getByTestId("preview-native-children").click();
      const longTool = childPane.locator('[data-child-tool-id="long-a"]');
      if (!await longTool.getByTestId("bash-output-preview-full").isVisible()) await longTool.getByTestId("tool-summary-trigger-long-a").click();
      await longTool.getByText("RUNNING_CHILD_PREVIEW_a", { exact: true }).waitFor({ timeout: 10000 });
      assert.equal(await page.getByTestId("v4-composer-background-work-trigger").count(), 1, "Running child with tool output keeps its robot");
      await page.getByTestId("complete-native-children").click();
      await page.locator('main[data-stage="completed"]').waitFor();
      assert.equal(await page.getByTestId("v4-composer-background-work-trigger").count(), 0, "Completed children must not retain the running robot");
      assert.equal(await spawnLinks.count(), 2, "Completion preserves both spawn records");
      await spawnLinks.first().click();
      await childPane.getByText("LIVE_CHILD_a_FINAL", { exact: true }).waitFor({ timeout: 10000 });
      await page.reload();
      await page.locator('main[data-stage="completed"]').waitFor();
      assert.equal(await page.getByTestId("v4-composer-background-work-trigger").count(), 0);
      assert.equal(await spawnLinks.count(), 2, "Reload preserves completed spawn records");
      await spawnLinks.nth(1).click();
      await childPane.getByText("LIVE_CHILD_b_FINAL", { exact: true }).waitFor({ timeout: 10000 });
      await childPane.getByText("CHILD_ACTUAL_INPUT_b", { exact: true }).waitFor({ timeout: 10000 });
      const recoveredTool = childPane.locator('[data-child-tool-id="long-b"]');
      await recoveredTool.getByTestId("tool-summary-trigger-long-b").click();
      assert.match(await recoveredTool.innerText(), /FINAL_CHILD_TOOL_b/);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Completed spawn rows must fit the viewport");
      assert.deepEqual(errors, []);
      const artifacts = join(tmpdir(), "zcode-native-child-browser"); await mkdir(artifacts, { recursive: true });
      await page.screenshot({ path: join(artifacts, `${width}-${locale}-${theme}.png`), fullPage: true, animations: "disabled" });
    } finally { await context.close(); }
  });
}
