// Run with pnpm exec tsx packages/ui/test/browser/manual-review/pending/native-codex-questions.test.mjs.
// Real Core/broker/projection -> production question UI -> real broker answer, without inference.
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
import { createProtocolInteractionBroker } from "../../../../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/interaction-broker.ts";
import { V4InteractionRegistry } from "../../../../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/interaction-registry.ts";
import { ProductProjection } from "../../../../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/product-projection.ts";
import {
  SessionEventType,
  createSessionId,
} from "../../../../../../apps/zcode-cli/packages/contracts/src/index.ts";
import { conversationSnapshotSchema } from "@zcode/shared/zcode-protocol-v4";
import { zcodeProtocolMethods, zcodeUserInputRequestParamsSchema } from "@zcode/shared";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/native-codex-questions.fixture.tsx";
let server, browser, origin, current;
before(async () => {
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "native-codex-questions",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (req.url === "/native-question-data") {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ request: current.request }));
            } else if (req.url === "/native-question-answer") {
              const chunks = [];
              for await (const chunk of req) chunks.push(chunk);
              const answer = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              const accepted = current.registry.resolve(answer.requestId, {
                action: answer.action,
                content: answer.content,
              });
              res.statusCode = accepted ? 200 : 409;
              res.end();
            } else if (req.url?.startsWith("/fixture?")) {
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
                ),
              );
            } else next();
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
});

for (const width of [390, 1200])
  for (const locale of ["zh-CN", "en-US"])
    for (const theme of ["zai-light", "zai-dark"]) {
      test(`native question buttons ${width} ${locale} ${theme}`, async () => {
        for (const kind of ["option", "custom", "freeText"]) {
          const sessionId = createSessionId(`native-question-${width}-${locale}-${theme}-${kind}`);
          const registry = new V4InteractionRegistry();
          const broker = createProtocolInteractionBroker({
            v4Interactions: registry,
            requestClient: (method, params, _schema, options) => {
              // Match the desktop Host boundary before allowing v4 UI responses to win the race.
              if (method === zcodeProtocolMethods.interactionRequestUserInput)
                zcodeUserInputRequestParamsSchema.parse(params);
              return new Promise((_resolve, reject) =>
                options.signal.addEventListener("abort", () => reject(new Error("RPC cancelled")), {
                  once: true,
                }),
              );
            },
          });
          const projection = new ProductProjection(sessionId, "native-question-browser");
          const input = {
            questions: [
              {
                question: "Which hosting entry?",
                header: "Hosting",
                multiSelect: false,
                options:
                  kind === "freeText"
                    ? []
                    : [
                        { label: "Existing site", description: "Keep the current URL" },
                        { label: "New server", description: "Deploy separately" },
                      ],
              },
            ],
            metadata: { source: "native-codex" },
          };
          let answers;
          const published = Promise.withResolvers();
          const controller = new AbortController();
          const eventStore = createTestSessionEventStore();
          const runtime = createTestAgentRuntime(
            sessionId,
            { workingDirectory: root, titleGeneration: { enabled: false } },
            {
              eventStore,
              permissionBroker: broker,
              modelFactory: () => {
                throw Error("ZCode model must not execute");
              },
              nativeTurnExecutor: {
                async execute(request) {
                  await request.onEvent({
                    type: "toolStarted",
                    id: "native-question",
                    name: "AskUserQuestion",
                    input,
                  });
                  answers = await request.requestUserInput(
                    {
                      id: "rpc-question",
                      toolCallId: "native-question",
                      questions: input.questions,
                    },
                    { signal: request.signal },
                  );
                  await request.onEvent({
                    type: "toolCompleted",
                    id: "native-question",
                    name: "AskUserQuestion",
                    output: JSON.stringify({ questions: input.questions, answers }),
                  });
                  return { text: "", threadId: "native-thread", toolCallCount: 1 };
                },
              },
            },
          );
          runtime.subscribeEvents({
            onSessionEvent(event) {
              try {
                projection.applyEvent(event);
                if (event.type === SessionEventType.PermissionRequested) published.resolve();
              } catch (error) {
                published.reject(error);
                controller.abort(error);
              }
            },
          });
          const turn = runtime.executeTurn("Ask a hosting question", undefined, {
            abortSignal: controller.signal,
          });
          void turn.catch(() => {});
          await Promise.race([
            published.promise,
            turn.then(() => {
              throw new Error("Turn ended without a question");
            }),
          ]);
          const snapshot = conversationSnapshotSchema.parse(projection.getSnapshot());
          const pending = snapshot.pendingInteractions[0];
          assert.equal(pending.kind, "userInput");
          assert.equal(pending.autoResolution, undefined);
          const request = { ...pending.payload, requestId: pending.interactionId, sessionId };
          current = { registry, request };
          const context = await browser.newContext({
            viewport: { width, height: 844 },
            hasTouch: width === 390,
            locale,
          });
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (error) => {
            errors.push(error.message);
            console.error(error.message);
          });
          try {
            await page.goto(new URL(`/fixture?locale=${locale}&theme=${theme}`, origin).href, {
              timeout: 90_000,
            });
            await page.getByText("Which hosting entry?", { exact: true }).waitFor();
            assert.equal(answers, undefined, "Showing a default must not submit it");
            assert.equal(registry.has(request.requestId), true);
            const artifacts = join(tmpdir(), "zcode-native-question-browser");
            await mkdir(artifacts, { recursive: true });
            await page.screenshot({
              path: join(artifacts, `${width}-${locale}-${theme}-${kind}-pending.png`),
              fullPage: true,
            });
            if (kind === "option")
              await page.getByRole("option", { name: /Existing site/ }).click();
            else {
              const textbox = page.getByRole("textbox");
              await textbox.fill("my.example.test");
              await textbox.press("Enter");
            }
            await page.getByTestId("question-response").waitFor();
            await turn;
            assert.deepEqual(answers, {
              "Which hosting entry?": kind === "option" ? "Existing site" : "my.example.test",
            });
            assert.equal(projection.getSnapshot().pendingInteractions.length, 0);
            assert.equal(registry.has(request.requestId), false);
            const replay = new ProductProjection(sessionId, "native-question-replay");
            for (const event of await eventStore.getEvents(sessionId)) replay.applyEvent(event);
            assert.equal(replay.getSnapshot().pendingInteractions.length, 0);
            assert.deepEqual(errors, []);
            await page.screenshot({
              path: join(artifacts, `${width}-${locale}-${theme}-${kind}.png`),
              fullPage: true,
            });
          } catch (error) {
            console.error(
              "Question browser failure",
              error,
              errors,
              await page.locator("body").innerText(),
            );
            throw error;
          } finally {
            controller.abort();
            await turn.catch(() => {});
            await context.close();
          }
        }
      });
    }
