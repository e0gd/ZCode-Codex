// pnpm exec tsx packages/ui/test/browser/manual-review/pending/codex-subscription.test.mjs
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/codex-subscription.fixture.tsx";
let server, browser, origin;
before(async () => {
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "codex-subscription-fixture",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (!req.url?.startsWith("/fixture?")) return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await vite.transformIndexHtml(
                req.url,
                `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
              ),
            );
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
const signedOut = { status: "signed-out", models: [] };
const login = {
  status: "logging-in",
  models: [],
  login: {
    loginId: "fixture-login",
    verificationUrl: "https://auth.openai.com/codex/device",
    userCode: "ABCD-EFGH",
  },
};
const browserAuthorizationUrl =
  "https://auth.openai.com/oauth/authorize?" +
  new URLSearchParams({
    client_id: "fixture-client",
    response_type: "code",
    redirect_uri: "http://localhost:1455/auth/callback",
    state: "fixture-state-1234567890",
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
  });
const browserLogin = {
  status: "logging-in",
  models: [],
  login: {
    type: "browser",
    loginId: "fixture-browser-login",
    authorizationUrl: browserAuthorizationUrl,
  },
};
const signedIn = {
  status: "signed-in",
  account: { email: "fixture@example.test", planType: "plus" },
  models: [
    {
      id: "official-catalog-id",
      model: "official-model",
      displayName: "Official model",
      supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }],
      defaultReasoningEffort: "high",
      inputModalities: ["text", "image"],
    },
  ],
};

for (const width of [390, 1200])
  for (const locale of ["zh-CN", "en-US"])
    for (const theme of ["light", "dark"]) {
      test(`subscription login/cancel/catalog/logout ${width}/${locale}/${theme}`, async () => {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        const requests = [],
          errors = [];
        let state = signedOut;
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/account", async (route) => {
          const input = route.request().postDataJSON();
          requests.push(input);
          assert.equal(input.workspacePath, "fixture-conversation");
          assert.equal(input.workspaceIdentity, undefined);
          if (input.action === "login") state = login;
          if (input.action === "cancel") {
            assert.equal(input.loginId, "fixture-login");
            state = signedOut;
          }
          if (input.action === "refresh") state = signedIn;
          if (input.action === "logout") state = signedOut;
          await route.fulfill({ json: state });
        });
        try {
          await page.goto(`${origin}fixture?${new URLSearchParams({ locale, theme })}`, {
            timeout: 90000,
          });
          await page.getByTestId("codex-account-login").click();
          assert.equal(
            requests.find((request) => request.action === "login")?.loginMethod,
            "device-code",
          );
          await page.getByTestId("codex-account-code").waitFor();
          assert.equal(await page.getByTestId("codex-account-code").textContent(), "ABCD-EFGH");
          await page.getByTestId("codex-account-open").click();
          assert.equal(await page.getByTestId("opened").textContent(), login.login.verificationUrl);
          await page.getByTestId("codex-account-cancel").click();
          await page.getByTestId("codex-account-login").waitFor();
          await page.getByTestId("codex-account-refresh").click();
          await page.getByTestId("codex-account-catalog").waitFor();
          assert.match(
            await page.getByTestId("codex-account-card").textContent(),
            /fixture@example.test/,
          );
          assert.match(
            await page.getByTestId("codex-account-catalog").textContent(),
            /official-model/,
          );
          assert.equal(
            await page.getByTestId("codex-account-card").locator("input,textarea,select").count(),
            0,
          );
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
          );
          const artifacts = join(tmpdir(), "zcode-codex-subscription-ui");
          await mkdir(artifacts, { recursive: true });
          await page.screenshot({
            path: join(artifacts, `${width}-${locale}-${theme}.png`),
            fullPage: true,
            animations: "disabled",
          });
          await page.getByTestId("codex-account-logout").click();
          await page.getByTestId("codex-account-login").waitFor();
          assert.equal(await page.getByTestId("codex-account-catalog").count(), 0);
          assert.deepEqual(errors, []);
          assert.deepEqual(
            requests.filter((r) => r.action !== "read").map((r) => r.action),
            ["login", "cancel", "refresh", "logout"],
          );
        } finally {
          await context.close();
        }
      });
    }

for (const width of [390, 1200])
  for (const locale of ["zh-CN", "en-US"])
    for (const theme of ["light", "dark"]) {
      test(`desktop browser login/cancel and device alternative ${width}/${locale}/${theme}`, async () => {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const requests = [];
        let state = signedOut;
        await page.route("**/account", async (route) => {
          const input = route.request().postDataJSON();
          requests.push(input);
          if (input.action === "login")
            state = input.loginMethod === "browser" ? browserLogin : login;
          if (input.action === "cancel") state = signedOut;
          await route.fulfill({ json: state });
        });
        try {
          await page.goto(
            `${origin}fixture?${new URLSearchParams({ locale, theme, desktop: "1" })}`,
            { timeout: 90000 },
          );
          await page.getByTestId("codex-account-login").click();
          await page.getByTestId("codex-account-browser-login").waitFor();
          assert.equal(
            requests.find((request) => request.action === "login")?.loginMethod,
            "browser",
          );
          assert.equal(await page.getByTestId("codex-account-code").count(), 0);
          assert.equal(
            await page.getByTestId("opened").textContent(),
            "",
            "Authorization must not open automatically",
          );
          const browserArtifacts = join(tmpdir(), "zcode-codex-browser-login-ui");
          await mkdir(browserArtifacts, { recursive: true });
          await page.screenshot({
            path: join(browserArtifacts, `${width}-${locale}-${theme}.png`),
            fullPage: true,
            animations: "disabled",
          });
          await page.getByTestId("codex-account-open").click();
          assert.equal(await page.getByTestId("opened").textContent(), browserAuthorizationUrl);
          await page.getByTestId("codex-account-cancel").click();
          await page.getByTestId("codex-account-device-login").click();
          await page.getByTestId("codex-account-code").waitFor();
          assert.equal(
            requests.filter((request) => request.action === "login").at(-1)?.loginMethod,
            "device-code",
          );
          assert.equal(
            requests.find((request) => request.action === "cancel")?.loginId,
            "fixture-browser-login",
          );
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
          );
        } finally {
          await page.close();
        }
      });
    }

test("Web observes pending browser login without exposing the computer's callback link", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await page.route("**/account", (route) => route.fulfill({ json: browserLogin }));
  try {
    await page.goto(`${origin}fixture?locale=en-US&theme=dark`);
    await page.getByTestId("codex-account-browser-login").waitFor();
    assert.equal(await page.getByTestId("codex-account-open").count(), 0);
    assert.equal(await page.getByTestId("codex-account-device-login").count(), 0);
    assert.equal(await page.getByTestId("opened").textContent(), "");
    assert.match(await page.getByTestId("codex-account-browser-login").textContent(), /computer/i);
  } finally {
    await page.close();
  }
});

test("desktop without a local Settings account keeps device-code login", async () => {
  const page = await browser.newPage();
  const requests = [];
  await page.route("**/account", async (route) => {
    const input = route.request().postDataJSON();
    requests.push(input);
    await route.fulfill({ json: input.action === "login" ? login : signedOut });
  });
  try {
    await page.goto(`${origin}fixture?locale=en-US&theme=light&desktop=1&remoteAccount=1`);
    await page.getByTestId("codex-account-login").click();
    await page.getByTestId("codex-account-code").waitFor();
    assert.equal(
      requests.find((request) => request.action === "login")?.loginMethod,
      "device-code",
    );
    assert.equal(await page.getByTestId("codex-account-device-login").count(), 0);
  } finally {
    await page.close();
  }
});

for (const desktop of [false, true])
  test(`device auth failure has actionable fixed guidance ${desktop ? "desktop" : "Web"}`, async () => {
    const page = await browser.newPage();
    await page.route("**/account", (route) =>
      route.fulfill({
        json: {
          status: "error",
          models: [],
          errorCode: "device-auth-unavailable",
          error: "raw sensitive upstream detail",
        },
      }),
    );
    try {
      await page.goto(`${origin}fixture?locale=en-US&theme=light${desktop ? "&desktop=1" : ""}`);
      const alert = page.getByTestId("codex-account-card").getByRole("alert");
      await alert.waitFor();
      assert.match(await alert.textContent(), /device/i);
      assert.match(await alert.textContent(), desktop ? /browser/i : /connected computer/i);
      assert.doesNotMatch(await alert.textContent(), /sensitive|upstream/);
    } finally {
      await page.close();
    }
  });

for (const authorizationUrl of [
  browserAuthorizationUrl.replace("auth.openai.com", "evil.example"),
  browserAuthorizationUrl.replace(
    encodeURIComponent("http://localhost:1455/auth/callback"),
    encodeURIComponent("https://evil.example/auth/callback"),
  ),
  browserAuthorizationUrl.replace("code_challenge_method=S256", "code_challenge_method=plain"),
])
  test(`unsafe browser authorization remains disabled ${authorizationUrl.includes("evil") ? "origin-or-redirect" : "PKCE"}`, async () => {
    const page = await browser.newPage();
    await page.route("**/account", (route) =>
      route.fulfill({
        json: { ...browserLogin, login: { ...browserLogin.login, authorizationUrl } },
      }),
    );
    try {
      await page.goto(`${origin}fixture?locale=en-US&theme=light&desktop=1`);
      await page.getByTestId("codex-account-card").getByRole("alert").waitFor();
      assert.equal(await page.getByTestId("codex-account-open").count(), 0);
      assert.doesNotMatch(
        await page.getByTestId("codex-account-card").textContent(),
        /evil\.example|fixture-state/,
      );
      assert.equal(await page.getByTestId("opened").textContent(), "");
    } finally {
      await page.close();
    }
  });
test("unsafe login URL and read failures stay visible without leaking raw errors", async () => {
  const page = await browser.newPage();
  await page.route("**/account", (route) =>
    route.fulfill({
      json: { ...login, login: { ...login.login, verificationUrl: "https://evil.example/" } },
    }),
  );
  try {
    await page.goto(`${origin}fixture?locale=en-US&theme=light`);
    await page.getByTestId("codex-account-code").waitFor();
    assert.equal(await page.getByTestId("codex-account-open").isDisabled(), true);
    await page.unroute("**/account");
    await page.route("**/account", (route) =>
      route.fulfill({ status: 500, body: "raw sensitive error" }),
    );
    await page.getByTestId("codex-account-refresh").click();
    await page.getByTestId("codex-account-card").getByRole("alert").waitFor();
    assert.doesNotMatch(await page.getByTestId("codex-account-card").textContent(), /sensitive/);
  } finally {
    await page.close();
  }
});
test("pending login polling observes the same owner and stops after unmount", async () => {
  const page = await browser.newPage();
  let reads = 0;
  await page.route("**/account", async (route) => {
    reads++;
    await route.fulfill({ json: login });
  });
  try {
    await page.goto(`${origin}fixture?locale=en-US&theme=dark`);
    await page.getByTestId("codex-account-code").waitFor();
    await page.waitForResponse((response) => response.url().endsWith("/account"));
    assert(reads >= 2);
    await page.getByTestId("unmount").click();
    const afterUnmount = reads;
    await page.waitForTimeout(1900);
    assert.equal(reads, afterUnmount);
  } finally {
    await page.close();
  }
});
test("changing Settings owner rejects late account results and never reuses the old cwd", async () => {
  const page = await browser.newPage();
  const firstRequested = Promise.withResolvers();
  const releaseFirst = Promise.withResolvers();
  const secondRequests = [];
  await page.route("**/account", async (route) => {
    firstRequested.resolve();
    await releaseFirst.promise;
    await route.fulfill({ json: login });
  });
  await page.route("**/second-account", async (route) => {
    secondRequests.push(route.request().postDataJSON());
    await route.fulfill({ json: signedIn });
  });
  try {
    await page.goto(`${origin}fixture?locale=en-US&theme=light`);
    await firstRequested.promise;
    await page.getByTestId("switch-owner").click();
    await page.getByTestId("codex-account-catalog").waitFor();
    releaseFirst.resolve();
    await page.waitForTimeout(100);
    assert.equal(await page.getByTestId("codex-account-code").count(), 0);
    assert.equal(secondRequests.length, 1);
    assert.equal(secondRequests[0].workspacePath, "second-conversation");
  } finally {
    releaseFirst.resolve();
    await page.close();
  }
});
test("refresh retries unavailable local workspace resolution", async () => {
  const page = await browser.newPage();
  const requests = [];
  await page.route("**/account", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: signedOut });
  });
  try {
    await page.goto(`${origin}fixture?locale=en-US&theme=light&pathFailure=1`);
    await page.getByTestId("codex-account-card").getByRole("alert").waitFor();
    assert.equal(requests.length, 0);
    await page.getByTestId("codex-account-refresh").click();
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="codex-account-login"]')?.disabled,
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].workspacePath, "fixture-conversation");
  } finally {
    await page.close();
  }
});
for (const width of [390, 1200])
  for (const [target, engine] of [
    ["zcode", "zcode"],
    ["codex", "codex"],
    ["legacy", "zcode"],
    ["zcode-task", "zcode"],
    ["codex-task", "codex"],
    ["other-host", "zcode"],
    ["unknown-task", "unknown"],
    ["no-owner", "unknown"],
  ]) {
    test(`subscription engine filtering ${width}/${target}`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.goto(`${origin}fixture?filter=1&locale=en-US&theme=light&target=${target}`);
        await page.getByTestId("engine").waitFor();
        assert.equal(await page.getByTestId("engine").textContent(), engine);
        const groups = await page.getByTestId("groups").textContent();
        assert.match(groups, /API provider/);
        if (engine === "codex") {
          assert.match(groups, /ChatGPT/);
          assert.equal(await page.getByTestId("preferred").textContent(), "chatgpt-subscription");
        } else {
          assert.doesNotMatch(groups, /ChatGPT/);
          assert.equal(await page.getByTestId("preferred").textContent(), "none");
        }
      } finally {
        await page.close();
      }
    });
  }
