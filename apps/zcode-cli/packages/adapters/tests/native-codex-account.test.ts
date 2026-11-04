import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mock.spawn }));
import { NativeCodexAccountController } from "../src/native-codex/index.js";
import { codexAccountCommandSchema, codexAccountStateSchema, codexBrowserAuthorizationUrlSchema } from "@zcode/shared";

const roots: string[] = [];
const controllers: NativeCodexAccountController[] = [];
afterEach(async () => { for (const controller of controllers.splice(0)) controller.dispose(); mock.spawn.mockReset(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); vi.useRealTimers(); });
const officialModel = { id: "model-row", model: "gpt-subscription-test", displayName: "Subscription test", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }], defaultReasoningEffort: "high", inputModalities: ["text", "image"] };
const browserUrl = `https://auth.openai.com/oauth/authorize?response_type=code&state=fixture-state&code_challenge=${"a".repeat(43)}&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback`;
type Message = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
function server(options: { signedIn?: boolean; unsafeUrl?: boolean; authUrl?: string; failure?: string; paginated?: boolean; earlyComplete?: boolean; hang?: string } = {}) {
  const calls: Message[] = [];
  let signedIn = options.signedIn === true;
  let emit!: (message: Message) => void;
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  mock.spawn.mockImplementation(() => {
    emit = message => { child.stdout.write(JSON.stringify(message) + "\n"); };
    child.stdin.on("data", chunk => {
      for (const line of chunk.toString().trim().split("\n")) {
        const message = JSON.parse(line) as Message; calls.push(message);
        if (options.hang === message.method) continue;
        if (options.failure === message.method) { emit({ id: message.id, error: { code: -32603, message: "Bearer private-auth-error" } }); continue; }
        if (message.method === "initialize") emit({ id: message.id, result: {} });
        if (message.method === "account/read") emit({ id: message.id, result: { account: signedIn ? { type: "chatgpt", email: "example@example.test", planType: "plus" } : null, requiresOpenaiAuth: true } });
        if (message.method === "model/list") emit({ id: message.id, result: { data: [officialModel], nextCursor: options.paginated && !message.params?.cursor ? "next" : null } });
        if (message.method === "account/login/start") {
          if (options.earlyComplete) { signedIn = true; emit({ method: "account/login/completed", params: { loginId: "login-1", success: true, error: null } }); }
          emit({ id: message.id, result: message.params?.type === "chatgpt"
            ? { type: "chatgpt", loginId: "login-1", authUrl: options.authUrl ?? browserUrl }
            : { type: "chatgptDeviceCode", loginId: "login-1", verificationUrl: options.unsafeUrl ? "https://attacker.test/codex/device" : "https://auth.openai.com/codex/device", userCode: "AAAA-BBBB" } });
        }
        if (message.method === "account/login/cancel") emit({ id: message.id, result: { status: "canceled" } });
        if (message.method === "account/logout") { signedIn = false; emit({ id: message.id, result: {} }); }
      }
    });
    return child;
  });
  const notify = (loginId = "login-1", success = true) => emit({ method: "account/login/completed", params: { loginId, success, error: success ? null : "private-auth-error" } });
  return { calls, child, notify, finish: (loginId = "login-1", success = true) => { signedIn = success; notify(loginId, success); } };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "native-codex-account-")); roots.push(root);
  const codexHome = join(root, "home"); await mkdir(codexHome);
  const onCatalog = vi.fn(async () => {});
  const controller = new NativeCodexAccountController({ codexHome, binaryPath: join(root, "codex.exe"), env: { OPENAI_API_KEY: "old-key", openai_base_url: "https://private.test", CODEX_ZCODE_API_KEY: "stale-key", KEEP_SETTING: "keep" }, onCatalog });
  controllers.push(controller);
  return { controller, onCatalog };
}
describe("official Codex ChatGPT account controller", () => {
  it("starts browser OAuth only when explicitly requested and preserves one pending owner", async () => {
    const rpc = server(); const { controller } = await fixture();
    expect(codexAccountCommandSchema.parse({ action: "login", loginMethod: "browser" }).loginMethod).toBe("browser");
    const pending = await controller.command({ action: "login", loginMethod: "browser" });
    expect(pending).toEqual({ status: "logging-in", models: [], login: { type: "browser", loginId: "login-1", authorizationUrl: browserUrl } });
    expect(codexAccountStateSchema.parse(pending)).toEqual(pending);
    expect(rpc.calls.find(call => call.method === "account/login/start")?.params).toEqual({ type: "chatgpt" });
    expect(await controller.command({ action: "read" })).toEqual(pending);
    expect(await controller.command({ action: "login", loginMethod: "device-code" })).toEqual(pending);
    expect(rpc.calls.filter(call => call.method === "account/login/start")).toHaveLength(1);
    expect((await controller.command({ action: "cancel", loginId: "login-1" })).status).toBe("signed-out");
    rpc.notify();
    expect((await controller.command({ action: "read" })).status).toBe("signed-out");
    expect(rpc.calls.some(call => call.method === "turn/start")).toBe(false);
  });

  it.each([undefined, "device-code"] as const)("keeps legacy/explicit device login compatible (%s)", async loginMethod => {
    const rpc = server(); const { controller } = await fixture();
    const pending = await controller.command({ action: "login", ...(loginMethod ? { loginMethod } : {}) });
    expect(pending.login).toMatchObject({ verificationUrl: "https://auth.openai.com/codex/device", userCode: "AAAA-BBBB" });
    expect(codexAccountStateSchema.parse(pending)).toEqual(pending);
    expect(rpc.calls.find(call => call.method === "account/login/start")?.params).toEqual({ type: "chatgptDeviceCode" });
  });

  it("classifies device-code acquisition failures without exposing raw errors or switching method", async () => {
    const rpc = server({ failure: "account/login/start" }); const { controller } = await fixture();
    const result = await controller.command({ action: "login", loginMethod: "device-code" });
    expect(result).toMatchObject({ status: "error", models: [], errorCode: "device-auth-unavailable" });
    expect(JSON.stringify(result)).not.toMatch(/Bearer|private-auth-error/);
    expect(rpc.calls.filter(call => call.method === "account/login/start")).toHaveLength(1);
    expect(codexAccountStateSchema.parse(result)).toEqual(result);
  });

  it("allows an explicit browser retry after a device error without retaining the old failure", async () => {
    server({ failure: "account/login/start" }); const { controller } = await fixture();
    expect((await controller.command({ action: "login" })).errorCode).toBe("device-auth-unavailable");
    const browser = server();
    const pending = await controller.command({ action: "login", loginMethod: "browser" });
    expect(pending).toMatchObject({ status: "logging-in", login: { type: "browser" } });
    expect(pending).not.toHaveProperty("errorCode");
    expect(browser.calls.filter(call => call.method === "account/login/start").map(call => call.params)).toEqual([{ type: "chatgpt" }]);
  });

  it.each(["completion", "early", "timeout", "failure"] as const)("shares the browser login lifecycle: %s", async outcome => {
    const rpc = server({ earlyComplete: outcome === "early" }); const { controller } = await fixture();
    if (outcome === "timeout") vi.useFakeTimers();
    const pending = await controller.command({ action: "login", loginMethod: "browser" });
    if (outcome === "early") { expect(pending.status).toBe("signed-in"); return; }
    if (outcome === "timeout") {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect((await controller.command({ action: "read" })).status).toBe("error");
      expect(rpc.calls.find(call => call.method === "account/login/cancel")?.params).toEqual({ loginId: "login-1" });
    } else {
      rpc.finish("login-1", outcome === "completion");
      await vi.waitFor(async () => expect((await controller.command({ action: "read" })).status).toBe(outcome === "completion" ? "signed-in" : "error"));
    }
  });

  const unsafeBrowserUrls = [
    browserUrl.replace("https://auth.openai.com", "https://attacker.test"),
    browserUrl.replace("/oauth/authorize?", "/other?"),
    browserUrl.replace("https://auth.openai.com", "http://auth.openai.com"),
    browserUrl.replace("127.0.0.1", "attacker.test"),
    browserUrl.replace("http%3A", "https%3A"),
    browserUrl.replace("%2Fauth%2Fcallback", "%2Fevil"),
    browserUrl + "&redirect_uri=http%3A%2F%2Fattacker.test%3A1455%2Fauth%2Fcallback",
    browserUrl.replace("code_challenge_method=S256", "code_challenge_method=plain"),
    browserUrl.replace("state=fixture-state", "state="),
    browserUrl.replace("code_challenge=", "code_challenge=%21"),
    browserUrl + "#fragment",
  ];
  it.each(unsafeBrowserUrls)("rejects invalid browser authorization URLs (%#)", async authUrl => {
    expect(codexBrowserAuthorizationUrlSchema.safeParse(authUrl).success).toBe(false);
    const rpc = server({ authUrl }); const { controller } = await fixture();
    const result = await controller.command({ action: "login", loginMethod: "browser" });
    expect(result).toMatchObject({ status: "error", models: [] });
    expect(JSON.stringify(result)).not.toMatch(/attacker|oauth|fixture-state/);
    expect(rpc.child.kill).toHaveBeenCalled();
  });

  it("reads without starting login or model execution and removes inherited API overrides", async () => {
    const rpc = server(); const { controller, onCatalog } = await fixture();
    expect(await controller.command({ action: "read" })).toEqual({ status: "signed-out", models: [] });
    expect(rpc.calls.map(call => call.method)).toEqual(["initialize", "initialized", "account/read"]);
    expect(onCatalog).toHaveBeenCalledWith([]);
    const options = mock.spawn.mock.calls[0]![2];
    expect(options.env).toMatchObject({ KEEP_SETTING: "keep" });
    expect(options.env).not.toHaveProperty("OPENAI_API_KEY"); expect(options.env).not.toHaveProperty("openai_base_url"); expect(options.env).not.toHaveProperty("CODEX_ZCODE_API_KEY");
    expect(mock.spawn.mock.calls[0]![1].join(" ")).not.toMatch(/old-key|stale-key|private\.test/);
  });
  it("keeps device authorization alive, publishes only official catalog facts and logs out", async () => {
    const rpc = server(); const { controller, onCatalog } = await fixture();
    const pending = await controller.command({ action: "login" });
    expect(pending).toMatchObject({ status: "logging-in", login: { loginId: "login-1", verificationUrl: "https://auth.openai.com/codex/device", userCode: "AAAA-BBBB" } });
    expect(rpc.child.kill).not.toHaveBeenCalled();
    expect((await controller.command({ action: "read" })).status).toBe("logging-in");
    expect(rpc.calls.filter(call => call.method === "account/login/start")).toHaveLength(1);
    rpc.finish();
    await vi.waitFor(async () => expect((await controller.command({ action: "read" })).status).toBe("signed-in"));
    expect(onCatalog).toHaveBeenCalledWith([officialModel]);
    const state = await controller.command({ action: "read" });
    expect(state).toMatchObject({ account: { email: "example@example.test", planType: "plus" }, models: [officialModel] });
    expect(await controller.command({ action: "logout" })).toEqual({ status: "signed-out", models: [] });
    expect(onCatalog).toHaveBeenLastCalledWith([]);
  });
  it("cancels the matching login and ignores late completion", async () => {
    const rpc = server(); const { controller } = await fixture(); await controller.command({ action: "login" });
    const mismatch = await controller.command({ action: "cancel", loginId: "old-login" });
    expect(mismatch.status).toBe("logging-in");
    expect(rpc.calls.filter(call => call.method === "account/login/cancel")).toHaveLength(0);
    expect((await controller.command({ action: "cancel", loginId: "login-1" })).status).toBe("signed-out");
    rpc.notify();
    await Promise.resolve();
    expect((await controller.command({ action: "read" })).status).toBe("signed-out");
  });
  it("cancels a pending device login before logging out", async () => {
    const rpc = server(); const { controller } = await fixture();
    await controller.command({ action: "login" });
    expect((await controller.command({ action: "logout" })).status).toBe("signed-out");
    expect(rpc.calls.filter(call => call.method?.startsWith("account/")).map(call => call.method)).toEqual(["account/login/start", "account/login/cancel", "account/logout"]);
    rpc.notify();
    expect((await controller.command({ action: "read" })).status).toBe("signed-out");
  });
  it("rejects arbitrary authorization URLs and redacts server errors", async () => {
    const rpc = server({ unsafeUrl: true }); const { controller } = await fixture();
    const unsafe = await controller.command({ action: "login" });
    expect(unsafe.status).toBe("error"); expect(JSON.stringify(unsafe)).not.toMatch(/attacker|AAAA|Bearer/);
    expect(rpc.child.kill).toHaveBeenCalled();
  });
  it("removes catalog on protocol failure instead of retaining usable-looking models", async () => {
    server({ signedIn: true, failure: "model/list" }); const { controller, onCatalog } = await fixture();
    const state = await controller.command({ action: "refresh" });
    expect(state.status).toBe("error"); expect(state.models).toEqual([]);
    expect(JSON.stringify(state)).not.toMatch(/private-auth-error|Bearer/);
    expect(onCatalog).toHaveBeenLastCalledWith([]);
  });
  it("correlates login completion that precedes the login response", async () => {
    server({ earlyComplete: true }); const { controller } = await fixture();
    expect((await controller.command({ action: "login" })).status).toBe("signed-in");
  });
  it("shows a safe failure when official device authorization fails", async () => {
    const rpc = server(); const { controller } = await fixture();
    await controller.command({ action: "login" }); rpc.finish("login-1", false);
    await vi.waitFor(async () => expect((await controller.command({ action: "read" })).status).toBe("error"));
    expect(JSON.stringify(await controller.command({ action: "read" }))).not.toMatch(/private-auth-error/);
  });
  it("expires a pending device login and cancels only that login", async () => {
    const rpc = server(); const { controller } = await fixture();
    vi.useFakeTimers();
    await controller.command({ action: "login" });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(rpc.calls.find(call => call.method === "account/login/cancel")?.params).toEqual({ loginId: "login-1" });
    const state = await controller.command({ action: "read" });
    expect(state.status).toBe("error"); expect(state.login).toBeUndefined();
  });
  it("fails closed on repeated pagination instead of accepting an unbounded catalog", async () => {
    server({ signedIn: true, paginated: true }); const { controller } = await fixture();
    expect((await controller.command({ action: "refresh" })).status).toBe("error");
  });
  it("reports a missing binary safely", async () => {
    const { controller } = await fixture();
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    mock.spawn.mockReturnValue(child);
    const state = controller.command({ action: "read" });
    await vi.waitFor(() => expect(mock.spawn).toHaveBeenCalled());
    child.emit("error", new Error("sensitive binary path"));
    expect(await state).toMatchObject({ status: "error", models: [] });
    controller.dispose(); expect(child.kill).toHaveBeenCalled();
  });
  it("times out a stalled official request without retrying it", async () => {
    const rpc = server({ hang: "account/read" }); const { controller } = await fixture();
    vi.useFakeTimers();
    const pending = controller.command({ action: "read" });
    await vi.waitFor(() => expect(rpc.calls.some(call => call.method === "account/read")).toBe(true));
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await pending).status).toBe("error");
    expect(rpc.calls.filter(call => call.method === "account/read")).toHaveLength(1);
    expect(rpc.child.kill).toHaveBeenCalled();
  });
  it("disposes the process and rejects outstanding work without exposing raw protocol data", async () => {
    const rpc = server({ hang: "account/read" }); const { controller } = await fixture();
    const pending = controller.command({ action: "read" });
    await vi.waitFor(() => expect(rpc.calls.some(call => call.method === "account/read")).toBe(true));
    controller.dispose();
    expect((await pending).status).toBe("error"); expect(rpc.child.kill).toHaveBeenCalled();
    expect((await controller.command({ action: "login" })).status).toBe("error");
  });
});
