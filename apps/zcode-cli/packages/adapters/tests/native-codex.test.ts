import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeTurnApproval, NativeTurnEvent } from "@zcode/contracts";

const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mock.spawn }));
import { NativeCodexExecutor, createNativeCodexExecutor, createNativeCodexExecutorFromEnv, discoverNativeCodexBinary } from "../src/native-codex/index.js";
import { NativeChildObserver } from "../src/native-codex/connection.js";

type Message = { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
const roots: string[] = [];
afterEach(async () => { mock.spawn.mockReset(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

function server(custom?: (message: Message, emit: (message: Message) => void) => boolean) {
  const calls: Message[] = [];
  let threadProvider: unknown;
  let threadCwd: unknown;
  const children: Array<EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }> = [];
  mock.spawn.mockImplementation((_binary, args, options) => {
    threadCwd ??= options.cwd;
    threadProvider ??= JSON.parse(args.find((arg: string) => arg.startsWith("model_provider=")).slice("model_provider=".length));
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    children.push(child);
    const emit = (message: Message) => child.stdout.write(`${JSON.stringify(message)}\n`);
    child.stdin.on("data", chunk => {
      for (const line of chunk.toString().trim().split("\n")) {
        const m = JSON.parse(line) as Message;
        calls.push(m);
        if (custom?.(m, emit)) continue;
        if (m.method === "initialize") emit({ id: m.id, result: {} });
        if (m.method === "thread/start") { threadProvider = m.params?.modelProvider; threadCwd = m.params?.cwd; }
        if (m.method === "thread/read") emit({ id: m.id, result: { thread: { id: "thread-1", modelProvider: threadProvider, cwd: threadCwd } } });
        if (m.method === "thread/resume" && threadProvider !== undefined && m.params?.modelProvider !== threadProvider) {
          emit({ id: m.id, error: { code: -32600, message: "Thread provider mismatch" } }); continue;
        }
        if (m.method === "thread/start" || m.method === "thread/resume") emit({ id: m.id, result: { thread: { id: "thread-1" } } });
        if (m.method === "turn/start") {
          // Deliberately notify before start response; the adapter must preserve order.
          emit({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "msg", delta: "你" } });
          emit({ id: m.id, result: { turn: { id: "turn-1" } } });
          emit({ method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", item: { type: "agentMessage", id: "msg", text: "你好" } } });
          emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
        }
        if (m.method === "turn/interrupt") emit({ id: m.id, result: {} });
      }
    });
    return child;
  });
  return { calls, children };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "native-codex-")); roots.push(root);
  const workspacePath = join(root, "project"); const codexHome = join(root, "home");
  await mkdir(workspacePath); await mkdir(codexHome);
  const options = { workspacePath: await realpath(workspacePath), codexHome: await realpath(codexHome), binaryPath: join(root, "codex.exe"), env: { TEST_CREDENTIAL: "must-not-log" } };
  return { root, options, executor: new NativeCodexExecutor(options) };
}
function input(overrides: Partial<Parameters<NativeCodexExecutor["execute"]>[0]> = {}) {
  return { sessionId: "session-1", inputId: "input-1", text: "hello", signal: new AbortController().signal,
    permission: { mode: "build" as const, planEnabled: false },
    onEvent: vi.fn(async (_event: NativeTurnEvent) => {}), requestApproval: vi.fn(async () => "deny" as const),
    requestUserInput: vi.fn(async () => ({} as Record<string, string>)), ...overrides };
}
const activeParams = { threadId: "thread-1", turnId: "turn-1" };

describe("native ChatGPT subscription execution", () => {
  const model = { id: "subscription-model", model: "gpt-subscription", displayName: "Subscription", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }], defaultReasoningEffort: "high", inputModalities: ["text", "image"] };
  const selection = { providerId: "chatgpt-subscription", modelId: model.model, options: { reasoningLevel: "high" } };
  const resolved = { authMode: "chatgpt" as const, modelId: model.model, reasoningEffort: "high" as const };
  const accountServer = (signedIn = true, catalog: unknown[] = [model]) => server((message, emit) => {
    if (message.method === "account/read") { emit({ id: message.id, result: { account: signedIn ? { type: "chatgpt", email: "test@example.test", planType: "plus" } : null } }); return true; }
    if (message.method === "model/list") { emit({ id: message.id, result: { data: catalog, nextCursor: null } }); return true; }
    return false;
  });

  it("uses managed official auth without inherited API credentials or endpoint overrides", async () => {
    const rpc = accountServer(); const { options } = await fixture();
    const executor = new NativeCodexExecutor({ ...options, baseUrl: "https://stale-api.example.test", env: { OPENAI_API_KEY: "old-key", CODEX_ZCODE_API_KEY: "old-provider", OpenAI_Base_URL: "https://old.example.test" }, resolveModel: async () => resolved });
    await executor.execute(input({ modelSelection: selection }));
    const [binary, args, spawnOptions] = mock.spawn.mock.calls[0]!;
    expect(binary).toBe(options.binaryPath);
    expect(args).toContain('model_provider="openai"');
    expect(args).toContain('forced_login_method="chatgpt"');
    expect(args.join(" ")).not.toMatch(/stale-api|old\.example|env_key|requires_openai_auth=false/);
    expect(spawnOptions.env).not.toHaveProperty("OPENAI_API_KEY"); expect(spawnOptions.env).not.toHaveProperty("CODEX_ZCODE_API_KEY"); expect(spawnOptions.env).not.toHaveProperty("OpenAI_Base_URL");
    expect(rpc.calls.findIndex(call => call.method === "model/list")).toBeLessThan(rpc.calls.findIndex(call => call.method === "thread/start"));
    expect(rpc.calls.find(call => call.method === "thread/start")?.params).toMatchObject({ modelProvider: "openai", model: model.model });
    expect(rpc.calls.find(call => call.method === "turn/start")?.params).toMatchObject({ model: model.model, effort: "high" });
  });

  it("rejects signed-out and unavailable subscription models before thread creation or turn dispatch", async () => {
    let rpc = accountServer(false); let current = await fixture();
    let executor = new NativeCodexExecutor({ ...current.options, resolveModel: async () => resolved });
    await expect(executor.execute(input({ modelSelection: selection }))).rejects.toThrow("Sign in to ChatGPT subscription");
    expect(rpc.calls.some(call => call.method === "thread/start" || call.method === "turn/start")).toBe(false);
    mock.spawn.mockReset(); rpc = accountServer(true, []); current = await fixture();
    executor = new NativeCodexExecutor({ ...current.options, resolveModel: async () => resolved });
    await expect(executor.execute(input({ modelSelection: selection }))).rejects.toThrow("unavailable for the current ChatGPT subscription");
    expect(rpc.calls.some(call => call.method === "thread/start" || call.method === "turn/start")).toBe(false);
  });

  it("revalidates supported efforts and image capabilities before dispatch", async () => {
    const rpc = accountServer(true, [{ ...model, supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Low" }], defaultReasoningEffort: "low" }]);
    const { options } = await fixture(); const executor = new NativeCodexExecutor({ ...options, resolveModel: async () => resolved });
    await expect(executor.execute(input({ modelSelection: selection }))).rejects.toThrow("unavailable for the current ChatGPT subscription");
    expect(rpc.calls.some(call => call.method === "turn/start")).toBe(false);
  });
  it.each(["max", "ultra", "future-effort"])("preserves the official catalog's %s reasoning effort", async effort => {
    const rpc = accountServer(true, [{ ...model, supportedReasoningEfforts: [{ reasoningEffort: effort, description: "Official effort" }], defaultReasoningEffort: effort }]);
    const { options } = await fixture(); const executor = new NativeCodexExecutor({ ...options, resolveModel: async () => ({ ...resolved, reasoningEffort: effort }) });
    await executor.execute(input({ modelSelection: { ...selection, options: { reasoningLevel: effort } } }));
    expect(rpc.calls.find(call => call.method === "turn/start")?.params).toMatchObject({ effort });
  });

  it("resumes the same subscription thread when changing only model", async () => {
    const second = { ...model, id: "second", model: "gpt-subscription-second" };
    const rpc = accountServer(true, [model, second]); const { options } = await fixture();
    const executor = new NativeCodexExecutor({ ...options, resolveModel: async selected => ({ ...resolved, modelId: selected.modelId }) });
    await executor.execute(input({ modelSelection: selection }));
    await executor.execute(input({ inputId: "second", modelSelection: { ...selection, modelId: second.model } }));
    expect(rpc.calls.filter(call => call.method === "thread/start")).toHaveLength(1);
    expect(rpc.calls.find(call => call.method === "thread/resume")?.params).toMatchObject({ threadId: "thread-1", modelProvider: "openai", model: second.model });
    expect(rpc.calls.filter(call => call.method === "turn/start").at(-1)?.params).toMatchObject({ model: second.model });
  });

  it.each(["api-to-subscription", "subscription-to-api"])("preserves thread/history and rejects %s before dispatch", async direction => {
    const rpc = accountServer(); const { options } = await fixture();
    const subscriptionExecutor = new NativeCodexExecutor({ ...options, resolveModel: async () => resolved });
    const apiExecutor = new NativeCodexExecutor(options);
    const first = direction === "api-to-subscription" ? apiExecutor : subscriptionExecutor;
    const second = direction === "api-to-subscription" ? subscriptionExecutor : apiExecutor;
    await first.execute(input(direction === "subscription-to-api" ? { modelSelection: selection } : {}));
    await expect(second.execute(input({ inputId: "switch", ...(direction === "api-to-subscription" ? { modelSelection: selection } : {}) }))).rejects.toThrow("Create a new task to switch");
    expect(rpc.calls.filter(call => call.method === "thread/start")).toHaveLength(1);
    expect(rpc.calls.filter(call => call.method === "turn/start")).toHaveLength(1);
    expect(rpc.calls.filter(call => call.method === "thread/resume")).toHaveLength(0);
  });
});

describe("native child observation", () => {
  it("preserves parallel/nested identities, reuses a child, and rejects retired child turns", async () => {
    const emit = vi.fn(async () => {}); const observer = new NativeChildObserver(emit, "session");
    const spawn = (id: string, target: string) => ({ type: "collabAgentToolCall", id, tool: "spawnAgent", status: "completed", receiverThreadIds: [target], prompt: target });
    await observer.collaboration(spawn("spawn-a", "a"));
    await observer.collaboration(spawn("spawn-b", "b"));
    await observer.collaboration(spawn("spawn-c", "c"), "a");
    expect(observer.relations()).toContainEqual(expect.objectContaining({ agentId: "c", parentAgentId: "a", parentToolCallId: "spawn-c" }));
    await observer.notification({ method: "item/agentMessage/delta", params: { threadId: "a", turnId: "old", itemId: "text", delta: "old" } });
    await observer.notification({ method: "turn/completed", params: { threadId: "a", turn: { id: "old", status: "completed" } } });
    await observer.collaboration({ type: "collabAgentToolCall", id: "followup", tool: "sendInput", receiverThreadIds: ["a"], agentsStates: { a: { status: "running" } } });
    await observer.notification({ method: "item/agentMessage/delta", params: { threadId: "a", turnId: "new", itemId: "text", delta: "new" } });
    const count = emit.mock.calls.length;
    await observer.notification({ method: "item/agentMessage/delta", params: { threadId: "a", turnId: "old", itemId: "text", delta: "stale" } });
    await observer.notification({ method: "turn/completed", params: { threadId: "a", turn: { id: "old", status: "completed" } } });
    expect(emit.mock.calls).toHaveLength(count); expect(observer.children.get("a")?.parentToolCallId).toBe("spawn-a");
    expect(observer.children.get("a")?.status).toBe("running");
    await observer.collaboration({ type: "collabAgentToolCall", tool: "closeAgent", receiverThreadIds: ["a", "b", "c"], agentsStates: { a: { status: "shutdown" }, b: { status: "shutdown" }, c: { status: "shutdown" } } });
    expect(observer.running).toBe(false);
    const restored = new NativeChildObserver(emit, "session"); restored.restore(observer.relations());
    expect(restored.running).toBe(false); expect(restored.relations()).toEqual(observer.relations());
  });

  it("does not invent a child for a failed spawn", async () => {
    const emit = vi.fn(async () => {}); const observer = new NativeChildObserver(emit, "session");
    await observer.collaboration({ type: "collabAgentToolCall", tool: "spawnAgent", id: "failed", status: "failed", receiverThreadIds: [], agentsStates: {} });
    expect(observer.relations()).toEqual([]); expect(emit).not.toHaveBeenCalled();
  });

  it("keeps the process alive after parent completion and forwards only related child output", async () => {
    let finishChild: () => void = () => {};
    const rpc = server((m, emit) => {
      if (m.method !== "turn/start") return false;
      emit({ id: m.id, result: { turn: { id: "turn-1" } } });
      const spawn = { type: "collabAgentToolCall", id: "spawn-item", tool: "spawnAgent", senderThreadId: "thread-1", status: "completed", receiverThreadIds: ["child-1"], prompt: "Inspect the child", agentsStates: { "child-1": { status: "running", message: null } } };
      emit({ method: "item/completed", params: { ...activeParams, item: spawn } });
      emit({ method: "item/agentMessage/delta", params: { threadId: "foreign-child", turnId: "child-turn", itemId: "foreign", delta: "foreign" } });
      emit({ method: "item/agentMessage/delta", params: { threadId: "child-1", turnId: "child-turn", itemId: "child-text", delta: "live child" } });
      emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
      finishChild = () => {
        emit({ method: "item/completed", params: { threadId: "child-1", turnId: "child-turn", item: { type: "agentMessage", id: "child-text", text: "live child done" } } });
        emit({ method: "turn/completed", params: { threadId: "child-1", turn: { id: "child-turn", status: "completed" } } });
      };
      return true;
    });
    const { executor } = await fixture(); const request = input(); let settled = false;
    const pending = executor.execute(request).then(result => { settled = true; return result; });
    await vi.waitFor(() => expect(request.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "subagentUpdated", agentId: "child-1" })));
    expect(settled).toBe(false); expect(rpc.children[0]!.kill).not.toHaveBeenCalled();
    finishChild(); await pending;
    const events = vi.mocked(request.onEvent).mock.calls.map(([event]) => event);
    expect(events).toContainEqual(expect.objectContaining({ type: "toolStarted", name: "Agent", input: expect.objectContaining({ run_in_background: true }) }));
    expect(events).toContainEqual(expect.objectContaining({ type: "subagentUpdated", agentId: "child-1", status: "success" }));
    expect(JSON.stringify(events)).toContain("live child done"); expect(JSON.stringify(events)).not.toContain("foreign");
  });
});

describe("native automatic subagent preference", () => {
  it("defaults to explicit delegation and preserves configured developer instructions", async () => {
    const rpc = server(); const { executor } = await fixture();
    await executor.execute(input());
    expect(mock.spawn.mock.calls[0][1]).toContain("features.multi_agent=true");
    const settings = rpc.calls.find(call => call.method === "thread/start")!.params!;
    expect(settings).not.toHaveProperty("developerInstructions");
    const turn = rpc.calls.find(call => call.method === "turn/start")!.params!;
    expect(turn.additionalContext).toEqual({"zcode-codex-subagents": {kind:"application",value:expect.stringContaining("Do not spawn subagents unless")}});
    expect(settings).not.toHaveProperty("multiAgentMode");
  });
  it("refreshes on the same thread and applies on/off without changing user input or permissions", async () => {
    const rpc = server(); const { options } = await fixture(); let enabled = true;
    const resolveAutoSubagents = vi.fn(async () => enabled);
    const executor = new NativeCodexExecutor({ ...options, resolveAutoSubagents });
    await executor.execute(input()); enabled = false;
    await executor.execute(input({ inputId: "second" }));
    expect(resolveAutoSubagents).toHaveBeenCalledTimes(2);
    const turns = rpc.calls.filter(call => call.method === "turn/start");
    expect(JSON.stringify(turns[0]!.params!.additionalContext)).toContain("Proactively delegate");
    expect(JSON.stringify(turns[1]!.params!.additionalContext)).toContain("Do not spawn subagents unless");
    expect(rpc.calls.filter(call => call.method === "turn/start").map(call => call.params!.input)).toEqual([
      [{type:"text",text:"hello",text_elements:[]}], [{type:"text",text:"hello",text_elements:[]}],
    ]);
    expect(rpc.calls.filter(call => call.method === "thread/start")).toHaveLength(1);
  });
  it("fails before dispatch when Host preference lookup fails", async () => {
    server(); const { options } = await fixture();
    const executor = new NativeCodexExecutor({ ...options, resolveAutoSubagents: async () => { throw Error("Host unavailable"); } });
    await expect(executor.execute(input())).rejects.toThrow("Host unavailable");
    expect(mock.spawn).not.toHaveBeenCalled();
  });
});

describe("native question buttons", () => {
  const questions = [
    { id: "hosting", header: "Hosting", question: "Where to host?", isOther: true, isSecret: false, options: [{ label: "Existing site", description: "Keep the current URL" }, { label: "New server", description: "Deploy separately" }] },
    { id: "address", header: "Address", question: "Server address?", isOther: true, isSecret: false, options: null },
  ];
  it("waits for explicit input and returns option/custom answers under native question IDs", async () => {
    const rpc = server((m, emit) => {
      if (m.method === "turn/start") {
        emit({ id: m.id, result: { turn: { id: "turn-1" } } });
        emit({ id: "question-rpc", method: "item/tool/requestUserInput", params: { ...activeParams, itemId: "question-item", questions, isBlocking: true } });
        return true;
      }
      if (m.id === "question-rpc") emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
      return false;
    });
    const { executor } = await fixture();
    const answer = Promise.withResolvers<Record<string, string>>();
    const request = input({ requestUserInput: vi.fn(() => answer.promise) });
    const pending = executor.execute(request);
    await vi.waitFor(() => expect(request.requestUserInput).toHaveBeenCalledOnce());
    expect(rpc.calls.some(call => call.id === "question-rpc")).toBe(false);
    expect(request.requestApproval).not.toHaveBeenCalled();
    answer.resolve({ "Where to host?": "Existing site", "Server address?": "my.example.test" });
    await pending;
    expect(rpc.calls.find(call => call.id === "question-rpc")?.result).toEqual({ answers: { hosting: { answers: ["Existing site"] }, address: { answers: ["my.example.test"] } } });
    expect(vi.mocked(request.onEvent).mock.calls.map(([event]) => event.type)).toEqual(["toolStarted", "toolCompleted"]);
  });

  it("renders completed async message questions once and continues on the same thread after the answer", async () => {
    let turns = 0;
    const rpc = server((m, emit) => {
      if (m.method !== "turn/start") return false;
      const turnId = `turn-${++turns}`;
      emit({ id: m.id, result: { turn: { id: turnId } } });
      const item = { type: "agentMessage", id: `message-${turns}`, text: turns === 1 ? "Choose a host" : "Answer received", questions: turns === 1 ? [{ title: "Where to host?", options: ["Existing site", "New server"] }] : null };
      emit({ method: "item/completed", params: { threadId: "thread-1", turnId, item } });
      if (turns === 1) emit({ method: "item/completed", params: { threadId: "thread-1", turnId, item } });
      emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: turnId, status: "completed" } } });
      return true;
    });
    const { executor } = await fixture();
    const request = input({ requestUserInput: vi.fn(async () => ({ "Where to host?": "Existing site" })) });
    const result = await executor.execute(request);
    expect(request.requestUserInput).toHaveBeenCalledOnce();
    expect(rpc.calls.filter(call => call.method === "thread/start")).toHaveLength(1);
    const continuation = rpc.calls.filter(call => call.method === "turn/start")[1];
    expect(continuation?.params?.threadId).toBe("thread-1");
    expect(JSON.stringify(continuation?.params?.input)).toContain("Existing site");
    expect(result.text).toBe("Choose a hostAnswer received");
  });

  it.each(["cancel", "disconnect"])("settles a pending question on %s without fabricating an answer", async outcome => {
    const rpc = server((m, emit) => {
      if (m.method !== "turn/start") return false;
      emit({ id: m.id, result: { turn: { id: "turn-1" } } });
      emit({ id: "question-rpc", method: "item/tool/requestUserInput", params: { ...activeParams, itemId: "question-item", questions } });
      return true;
    });
    const { executor } = await fixture(); const controller = new AbortController();
    const request = input({ signal: controller.signal, requestUserInput: vi.fn(async (_request, options) => {
      return new Promise<Record<string, string>>((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    }) });
    const pending = executor.execute(request);
    await vi.waitFor(() => expect(request.requestUserInput).toHaveBeenCalledOnce());
    if (outcome === "cancel") controller.abort(); else rpc.children[0]!.emit("exit", 1);
    await expect(pending).rejects.toBeDefined();
    expect(rpc.calls.some(call => call.id === "question-rpc")).toBe(false);
  });
});

describe("native image inputs", () => {
  const image = { type: "image" as const, mediaType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=" };

  it("sends images and attachment text in order on both new and resumed threads", async () => {
    const rpc = server(); const { executor } = await fixture();
    for (const text of ["describe these", ""]) {
      await executor.execute(input({ text, inputId: `image-${text || "only"}`, attachments: [image, { type: "text", text: "image notes" }, image] }));
    }
    const turns = rpc.calls.filter(call => call.method === "turn/start");
    expect(turns.map(call => call.params?.input)).toEqual(["describe these", ""].map(text => [
      ...(text ? [{ type: "text", text, text_elements: [] }] : []),
      { type: "image", url: image.dataUrl },
      { type: "text", text: "image notes", text_elements: [] },
      { type: "image", url: image.dataUrl },
    ]));
    expect(rpc.calls.filter(call => call.method === "thread/start")).toHaveLength(1);
    expect(rpc.calls.filter(call => call.method === "thread/resume")).toHaveLength(1);
  });

  it.each([
    { type: "image" as const, mediaType: "image/png", dataUrl: "https://example.test/private.png" },
    { type: "image" as const, mediaType: "image/jpeg", dataUrl: image.dataUrl },
    { type: "file" as const, mediaType: "application/pdf", dataUrl: "data:application/pdf;base64,JVBERg==" },
    { type: "video" as const, mediaType: "video/mp4", dataUrl: "data:video/mp4;base64,AAAA" },
  ])("rejects invalid or unsupported media before touching a native thread: $type $mediaType", async attachment => {
    server(); const { executor } = await fixture();
    await expect(executor.execute(input({ attachments: [attachment] }))).rejects.toThrow(/Native Codex.*(image|attachment)/);
    expect(mock.spawn).not.toHaveBeenCalled();
  });
});

describe("project Codex discovery", () => {
  async function binary(path: string) {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "test executable");
    await chmod(path, 0o700);
    return await realpath(path);
  }

  it("uses an explicit native binary and fails for invalid overrides without PATH fallback", async () => {
    const { root } = await fixture();
    const installed = await binary(join(root, "installed", process.platform === "win32" ? "codex.exe" : "codex"));
    expect(await discoverNativeCodexBinary({ env: {}, binaryPath: installed })).toBe(installed);
    await expect(discoverNativeCodexBinary({ env: { PATH: join(root, "installed") }, binaryPath: join(root, "missing") })).rejects.toThrow("ZCODE_CODEX_BINARY");
    await expect(discoverNativeCodexBinary({ env: {}, binaryPath: await binary(join(root, "codex.cmd")) })).rejects.toThrow("native executable");
  });

  it("finds PATH binaries without requiring a workspace environment opt-in", async () => {
    const { root } = await fixture();
    const installed = await binary(join(root, "on-path", process.platform === "win32" ? "codex.exe" : "codex"));
    expect(await discoverNativeCodexBinary({ env: { PATH: join(root, "on-path") } })).toBe(installed);
    await expect(discoverNativeCodexBinary({ env: { PATH: "" } })).rejects.toThrow("Install the official Codex CLI");
  });

  it.each(["codex", "codex-win32-x64"])("resolves Windows npm %s vendor layouts without running cmd wrappers", async name => {
    const { root } = await fixture();
    const prefix = join(root, "npm prefix");
    await binary(join(prefix, "codex.cmd"));
    const installed = await binary(join(prefix, "node_modules", "@openai", name, "vendor", "x86_64-pc-windows-msvc", "codex", "codex.exe"));
    expect(await discoverNativeCodexBinary({ env: { Path: prefix }, platform: "win32", arch: "x64" })).toBe(installed);
    expect(mock.spawn).not.toHaveBeenCalled();
  });

  it("finds the Windows Codex app vendor executable", async () => {
    const { root } = await fixture();
    const installed = await binary(join(root, "Programs", "Codex", "package", "vendor", "aarch64-pc-windows-msvc", "bin", "codex.exe"));
    expect(await discoverNativeCodexBinary({ env: { LOCALAPPDATA: root }, platform: "win32", arch: "arm64" })).toBe(installed);
  });

  it.each([
    ["linux", "x64", "x86_64-unknown-linux-musl"],
    ["darwin", "arm64", "aarch64-apple-darwin"],
  ] as const)("finds official npm native packages on %s/%s", async (platform, arch, target) => {
    const { root } = await fixture();
    const prefix = join(root, "prefix");
    const installed = await binary(join(prefix, "lib", "node_modules", "@openai", `codex-${platform}-${arch}`, "vendor", target, "bin", "codex"));
    expect(await discoverNativeCodexBinary({ env: { PATH: join(prefix, "bin") }, platform, arch })).toBe(installed);
  });

  it("rejects home overrides inside the project and relative binary overrides", async () => {
    const { root, options } = await fixture();
    const installed = await binary(join(root, process.platform === "win32" ? "codex.exe" : "codex"));
    await expect(createNativeCodexExecutor({ workspacePath: options.workspacePath, env: { ZCODE_CODEX_BINARY: installed, ZCODE_CODEX_HOME: join(options.workspacePath, "data") } })).rejects.toThrow("outside the project");
    expect(await readdir(options.workspacePath)).toEqual([]);
    await expect(discoverNativeCodexBinary({ env: {}, binaryPath: "codex" })).rejects.toThrow("absolute native executable");
  });

  it("uses a separate Host data home and ignores the user's default CODEX_HOME", async () => {
    const remote = server();
    const { root, options } = await fixture();
    const installed = await binary(join(root, "codex.exe"));
    const userHome = join(root, "user-codex");
    await mkdir(userHome);
    await writeFile(join(userHome, "config.toml"), "untouched = true\n");
    const env = { ZCODE_CODEX_BINARY: installed, ZCODE_DATA_BASE_DIR: join(root, "host-data"), CODEX_HOME: userHome };
    const executor = await createNativeCodexExecutor({ workspacePath: options.workspacePath, env });
    await executor.execute(input());
    expect(remote.calls.some(call => call.method === "turn/start")).toBe(true);
    expect(mock.spawn.mock.calls[0][2].env.CODEX_HOME).toBe(await realpath(join(root, "host-data", ".zcode", "codex-home")));
    expect(await readFile(join(userHome, "config.toml"), "utf8")).toBe("untouched = true\n");
    expect(await readdir(userHome)).toEqual(["config.toml"]);
    const override = join(root, "explicit-home");
    const second = await createNativeCodexExecutor({ workspacePath: options.workspacePath, env: { ...env, ZCODE_CODEX_HOME: override } });
    await second.execute(input({ sessionId: "second" }));
    expect(mock.spawn.mock.calls[1][2].env.CODEX_HOME).toBe(await realpath(override));
  });
});

describe("native Codex transport", () => {
  describe("safe response stream failures", () => {
    const safeMessage = "Official Codex could not complete the response stream. Check the API provider and network before sending again.";
    const terminalMethods = ["error", "turn/completed"] as const;
    const variants = ["responseStreamConnectionFailed", "responseStreamDisconnected", "responseTooManyFailedAttempts"] as const;
    const terminal = (emit: (message: Message) => void, method: typeof terminalMethods[number], error: unknown) => {
      emit(method === "error"
        ? { method, params: { ...activeParams, willRetry: false, error } }
        : { method, params: { threadId: "thread-1", turn: { id: "turn-1", status: "failed", error } } });
    };

    it.each(variants.flatMap(variant => terminalMethods.map(method => ({ variant, method }))))("classifies $variant from $method without exposing provider details or replaying", async ({ variant, method }) => {
      const remote = server((m, emit) => {
        if (m.method !== "turn/start") return false;
        emit({ id: m.id, result: { turn: { id: "turn-1" } } });
        terminal(emit, method, { message: "Bearer secret-key", additionalDetails: "private-provider-details", codexErrorInfo: { [variant]: { httpStatusCode: 502, private: "private-provider-details" } } });
        return true;
      });
      const { executor } = await fixture();
      const failure = await executor.execute(input()).then(() => undefined, error => error as Error);
      expect(failure).toMatchObject({ code: "NATIVE_CODEX_RESPONSE_STREAM_FAILED", httpStatusCode: 502, message: `${safeMessage} (HTTP 502)` });
      expect(String(failure) + JSON.stringify(failure)).not.toMatch(/secret-key|private-provider-details/);
      await expect(executor.execute(input())).rejects.toThrow("will not be replayed");
      expect(remote.calls.filter(m => m.method === "turn/start")).toHaveLength(1);
    });

    it.each([100, 599, 99, 600, 502.5, "502", null, undefined])("validates HTTP status %s independently of the category", async httpStatusCode => {
      server((m, emit) => {
        if (m.method !== "turn/start") return false;
        emit({ id: m.id, result: { turn: { id: "turn-1" } } });
        terminal(emit, "error", { message: "secret-key", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode } } });
        return true;
      });
      const { executor } = await fixture();
      const failure = await executor.execute(input()).then(() => undefined, error => error as Error);
      expect(failure).toMatchObject({ code: "NATIVE_CODEX_RESPONSE_STREAM_FAILED" });
      if (httpStatusCode === 100 || httpStatusCode === 599) {
        expect(failure).toMatchObject({ httpStatusCode, message: `${safeMessage} (HTTP ${httpStatusCode})` });
      } else {
        expect(failure).not.toHaveProperty("httpStatusCode");
        expect(failure?.message).toBe(safeMessage);
      }
    });

    it.each(terminalMethods)("keeps malformed or unknown categories generic for %s", async method => {
      const categories: unknown[] = [undefined, null, "responseStreamDisconnected", [], { other: { httpStatusCode: 502 } }, { responseStreamDisconnected: { httpStatusCode: 502 }, other: {} }];
      let nextCategory = 0;
      const remote = server((m, emit) => {
        if (m.method !== "turn/start") return false;
        emit({ id: m.id, result: { turn: { id: "turn-1" } } });
        terminal(emit, method, { message: "secret-key", additionalDetails: "private-provider-details", codexErrorInfo: categories[nextCategory++] });
        return true;
      });
      const { executor } = await fixture();
      for (let index = 0; index < categories.length; index++) {
        const failure = await executor.execute(input({ inputId: `invalid-category-${index}` })).then(() => undefined, error => error as Error);
        expect(failure?.message).toBe(method === "error" ? "Official Codex reported a turn error." : "Official Codex turn failed. Inspect its thread before submitting another input.");
        expect(failure).not.toHaveProperty("httpStatusCode");
        expect(failure).not.toHaveProperty("code", "NATIVE_CODEX_RESPONSE_STREAM_FAILED");
        expect(String(failure) + JSON.stringify(failure)).not.toMatch(/secret-key|private-provider-details/);
      }
      expect(remote.calls.filter(m => m.method === "turn/start")).toHaveLength(categories.length);
    });

    it.each(terminalMethods.flatMap(method => [null, 502].map(httpStatusCode => ({ method, httpStatusCode }))))("inherits only the latest structured retry for terminal other via $method (HTTP $httpStatusCode)", async ({ method, httpStatusCode }) => {
      const remote = server((m, emit) => {
        if (m.method !== "turn/start") return false;
        emit({ id: m.id, result: { turn: { id: "turn-1" } } });
        for (const status of [503, httpStatusCode]) emit({ method: "error", params: { ...activeParams, willRetry: true,
          error: { message: "secret retry detail", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: status } } } } });
        terminal(emit, method, { message: "secret final detail", additionalDetails: "private-provider-details", codexErrorInfo: "other" });
        return true;
      });
      const { executor } = await fixture();
      const failure = await executor.execute(input()).then(() => undefined, error => error as Error);
      expect(failure).toMatchObject({ code: "NATIVE_CODEX_RESPONSE_STREAM_FAILED", message: httpStatusCode === null ? safeMessage : `${safeMessage} (HTTP 502)` });
      if (httpStatusCode === null) expect(failure).not.toHaveProperty("httpStatusCode");
      else expect(failure).toHaveProperty("httpStatusCode", 502);
      expect(String(failure) + JSON.stringify(failure)).not.toMatch(/secret|private-provider-details/);
      expect(remote.calls.filter(m => m.method === "turn/start")).toHaveLength(1);
    });

    it.each(terminalMethods)("does not inherit retry diagnostics for non-other or missing terminal categories via %s", async method => {
      const categories: unknown[] = ["badRequest", "futureUnknownCategory", undefined, null, {}, { other: {} }];
      let category = 0;
      server((m, emit) => {
        if (m.method !== "turn/start") return false;
        emit({ id: m.id, result: { turn: { id: "turn-1" } } });
        emit({ method: "error", params: { ...activeParams, willRetry: true, error: { codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } } } } });
        terminal(emit, method, { message: "secret-key", codexErrorInfo: categories[category++] });
        return true;
      });
      const { executor } = await fixture();
      for (let index = 0; index < categories.length; index++) {
        const failure = await executor.execute(input({ inputId: `non-other-${index}` })).then(() => undefined, error => error as Error);
        expect(failure?.message).toBe(method === "error" ? "Official Codex reported a turn error." : "Official Codex turn failed. Inspect its thread before submitting another input.");
        expect(failure).not.toHaveProperty("code", "NATIVE_CODEX_RESPONSE_STREAM_FAILED");
        expect(failure).not.toHaveProperty("httpStatusCode");
      }
    });

    it.each(terminalMethods)("clears a previous stream retry when the latest retry is not structured stream failure via %s", async method => {
      const categories: unknown[] = ["badRequest", "other", undefined, { responseStreamDisconnected: {}, other: {} }];
      let category = 0;
      server((m, emit) => {
        if (m.method !== "turn/start") return false;
        emit({ id: m.id, result: { turn: { id: "turn-1" } } });
        for (const codexErrorInfo of [{ responseStreamDisconnected: { httpStatusCode: 502 } }, categories[category++]]) {
          emit({ method: "error", params: { ...activeParams, willRetry: true, error: { codexErrorInfo } } });
        }
        terminal(emit, method, { message: "secret-key", codexErrorInfo: "other" });
        return true;
      });
      const { executor } = await fixture();
      for (let index = 0; index < categories.length; index++) {
        const failure = await executor.execute(input({ inputId: `latest-retry-${index}` })).then(() => undefined, error => error as Error);
        expect(failure).not.toHaveProperty("code", "NATIVE_CODEX_RESPONSE_STREAM_FAILED");
        expect(failure).not.toHaveProperty("httpStatusCode");
      }
    });

    it.each([false, true])("does not let stale or foreign retry notifications seed or overwrite active retry diagnostics (seeded: %s)", async seeded => {
      server((m, emit) => {
        if (m.method !== "turn/start") return false;
        emit({ id: m.id, result: { turn: { id: "turn-1" } } });
        const retry = (params: Record<string, unknown>, codexErrorInfo: unknown) => emit({ method: "error", params: { ...params, willRetry: true, error: { codexErrorInfo } } });
        if (seeded) retry(activeParams, { responseStreamDisconnected: { httpStatusCode: 502 } });
        for (const params of [{ ...activeParams, turnId: "stale-turn" }, { ...activeParams, threadId: "foreign-thread" }]) {
          retry(params, { responseStreamDisconnected: { httpStatusCode: 504 } });
          retry(params, "badRequest");
        }
        terminal(emit, "error", { codexErrorInfo: "other" });
        return true;
      });
      const { executor } = await fixture();
      const failure = await executor.execute(input()).then(() => undefined, error => error as Error);
      if (seeded) expect(failure).toMatchObject({ code: "NATIVE_CODEX_RESPONSE_STREAM_FAILED", httpStatusCode: 502 });
      else {
        expect(failure?.message).toBe("Official Codex reported a turn error.");
        expect(failure).not.toHaveProperty("httpStatusCode");
      }
    });

    it.each([false, true])("clears retry diagnostics before a subsequent turn (async question continuation: %s)", async asyncContinuation => {
      let turns = 0;
      const remote = server((m, emit) => {
        if (m.method !== "turn/start") return false;
        const turnId = `turn-${++turns}`;
        emit({ id: m.id, result: { turn: { id: turnId } } });
        if (turns === 1) {
          emit({ method: "error", params: { ...activeParams, willRetry: true, error: { codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } } } } });
          if (asyncContinuation) emit({ method: "item/completed", params: { ...activeParams, item: { type: "agentMessage", id: "question", text: "Choose", questions: [{ title: "Continue?", options: ["Yes", "No"] }] } } });
          emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: turnId, status: "completed" } } });
        } else emit({ method: "error", params: { threadId: "thread-1", turnId, willRetry: false, error: { codexErrorInfo: "other" } } });
        return true;
      });
      const { executor } = await fixture();
      const request = input({ requestUserInput: vi.fn(async () => ({ "Continue?": "Yes" })) });
      if (!asyncContinuation) await executor.execute(request);
      const failure = await executor.execute(asyncContinuation ? request : input({ inputId: "second-turn" })).then(() => undefined, error => error as Error);
      expect(failure?.message).toBe("Official Codex reported a turn error.");
      expect(failure).not.toHaveProperty("code", "NATIVE_CODEX_RESPONSE_STREAM_FAILED");
      expect(failure).not.toHaveProperty("httpStatusCode");
      expect(remote.calls.filter(m => m.method === "turn/start")).toHaveLength(2);
      expect(remote.calls.filter(m => m.method === "thread/start")).toHaveLength(1);
    });

    it("ignores retrying and stale errors before a successful completion", async () => {
      const remote = server((m, emit) => {
        if (m.method !== "turn/start") return false;
        emit({ id: m.id, result: { turn: { id: "turn-1" } } });
        const error = { message: "secret-key", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } } };
        emit({ method: "error", params: { ...activeParams, willRetry: true, error } });
        emit({ method: "error", params: { ...activeParams, threadId: "foreign-thread", willRetry: false, error } });
        emit({ method: "error", params: { ...activeParams, turnId: "stale-turn", willRetry: false, error } });
        emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "stale-turn", status: "failed", error } } });
        emit({ method: "item/completed", params: { ...activeParams, item: { type: "agentMessage", id: "recovered", text: "completed after native retry" } } });
        emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
        return true;
      });
      const { executor } = await fixture(); const request = input();
      await expect(executor.execute(request)).resolves.toMatchObject({ text: "completed after native retry", threadId: "thread-1" });
      expect(remote.calls.filter(m => m.method === "turn/start")).toHaveLength(1);
      expect(mock.spawn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(vi.mocked(request.onEvent).mock.calls)).not.toContain("secret-key");
    });
  });

  it("forwards compact item identity and lifecycle without adapter-owned dedupe", async () => {
    server((m, emit) => {
      if (m.method !== "turn/start") return false;
      const item = { type: "contextCompaction", id: "compact-1" };
      // 原生事件可能先于 turn/start 应答，仍需沿既有缓冲顺序传给 Core。
      emit({ method: "item/started", params: { ...activeParams, item } });
      emit({ id: m.id, result: { turn: { id: "turn-1" } } });
      for (const method of ["item/started", "item/completed", "item/completed", "item/started"]) {
        emit({ method, params: { ...activeParams, item } });
      }
      emit({ method: "item/completed", params: { ...activeParams, item: { ...item, id: "completed-only" } } });
      emit({ method: "thread/compacted", params: activeParams });
      emit({ method: "thread/compacted", params: activeParams });
      emit({ method: "item/started", params: { ...activeParams, turnId: "stale-turn", item } });
      emit({ method: "item/completed", params: { ...activeParams, threadId: "stale-thread", item } });
      emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
      return true;
    });
    const { executor } = await fixture(); const request = input();
    expect(await executor.execute(request)).toEqual({ text: "", threadId: "thread-1", toolCallCount: 0 });
    expect(vi.mocked(request.onEvent).mock.calls.map(([event]) => event)).toEqual([
      ...["contextCompactionStarted", "contextCompactionStarted", "contextCompactionCompleted", "contextCompactionCompleted", "contextCompactionStarted"].map(type => ({ type, ...activeParams, itemId: "compact-1" })),
      { type: "contextCompactionCompleted", ...activeParams, itemId: "completed-only" },
    ]);
  });

  it.each(["error", "interrupted", "failed"])("propagates %s without inventing compact completion", async outcome => {
    server((m, emit) => {
      if (m.method !== "turn/start") return false;
      emit({ id: m.id, result: { turn: { id: "turn-1" } } });
      emit({ method: "item/started", params: { ...activeParams, item: { type: "contextCompaction", id: "pending" } } });
      emit({ method: "thread/compacted", params: activeParams });
      if (outcome === "error") emit({ method: "error", params: activeParams });
      else emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: outcome } } });
      return true;
    });
    const { executor } = await fixture(); const request = input();
    await expect(executor.execute(request)).rejects.toBeDefined();
    expect(vi.mocked(request.onEvent).mock.calls.map(([event]) => event)).toEqual([{ type: "contextCompactionStarted", ...activeParams, itemId: "pending" }]);
  });
  it.each([false, true])("preserves item boundaries across tools (same item: %s)", async sameItem => {
    server((m, emit) => {
      if (m.method !== "turn/start") return false;
      emit({ id: m.id, result: { turn: { id: "turn-1" } } });
      const notify = (method: string, item: Record<string, unknown>) => emit({ method, params: { ...activeParams, item } });
      notify("item/started", { type: "agentMessage", id: "before" });
      notify("item/started", { type: "agentMessage", id: "before" });
      emit({ method: "item/agentMessage/delta", params: { ...activeParams, itemId: "before", delta: "before" } });
      if (!sameItem) {
        notify("item/completed", { type: "agentMessage", id: "before", text: "before" });
        notify("item/completed", { type: "agentMessage", id: "before", text: "before" });
      }
      for (const id of ["tool-a", "tool-b"]) {
        notify("item/started", { type: "commandExecution", id });
        notify("item/completed", { type: "commandExecution", id, aggregatedOutput: "ok" });
      }
      const itemId = sameItem ? "before" : "after";
      // No delta: completed-item text must produce one identified suffix before completion.
      notify("item/completed", { type: "agentMessage", id: itemId, text: sameItem ? "beforeafter" : "after" });
      notify("item/completed", { type: "agentMessage", id: itemId, text: sameItem ? "beforeafter" : "after" });
      notify("item/started", { type: "agentMessage", id: itemId });
      emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
      return true;
    });
    const { executor } = await fixture();
    const request = input();
    expect(await executor.execute(request)).toEqual({ text: "beforeafter", threadId: "thread-1", toolCallCount: 2 });
    const itemId = sameItem ? "before" : "after";
    const events = vi.mocked(request.onEvent).mock.calls.map(([event]) => event);
    expect(events.map(event => event.type)).toEqual(["textStarted", "textDelta", ...(!sameItem ? ["textCompleted"] : []), "toolStarted", "toolCompleted", "toolStarted", "toolCompleted", ...(!sameItem ? ["textStarted"] : []), "textDelta", "textCompleted"]);
    expect(events.filter(event => event.type === "textDelta")).toEqual([{ type: "textDelta", itemId: "before", delta: "before" }, { type: "textDelta", itemId, delta: "after" }]);
  });

  it("rejects changed repeated completion without duplicating observed text", async () => {
    server((m, emit) => {
      if (m.method !== "turn/start") return false;
      emit({ id: m.id, result: { turn: { id: "turn-1" } } });
      for (const text of ["done", "done again"]) emit({ method: "item/completed", params: { ...activeParams, item: { type: "agentMessage", id: "msg", text } } });
      return true;
    });
    const { executor } = await fixture(); const request = input();
    await expect(executor.execute(request)).rejects.toMatchObject({ code: "NATIVE_CODEX_FINAL_TEXT_MISMATCH" });
    expect(vi.mocked(request.onEvent).mock.calls.map(([event]) => event)).toEqual([{ type: "textStarted", itemId: "msg" }, { type: "textDelta", itemId: "msg", delta: "done" }, { type: "textCompleted", itemId: "msg" }]);
  });

  it("retains identified partial text on provider failure", async () => {
    server((m, emit) => {
      if (m.method !== "turn/start") return false;
      emit({ id: m.id, result: { turn: { id: "turn-1" } } });
      emit({ method: "item/agentMessage/delta", params: { ...activeParams, itemId: "partial", delta: "shown" } });
      emit({ method: "error", params: activeParams });
      return true;
    });
    const { executor } = await fixture(); const request = input();
    await expect(executor.execute(request)).rejects.toThrow("turn error");
    expect(vi.mocked(request.onEvent).mock.calls.map(([event]) => event)).toEqual([{ type: "textStarted", itemId: "partial" }, { type: "textDelta", itemId: "partial", delta: "shown" }]);
  });

  it("routes each admitted selection and scoped key through startup, thread resume and turn RPC", async () => {
    const remote = server(); const { options } = await fixture();
    const resolveModel = vi.fn(async (selection: NonNullable<Parameters<NativeCodexExecutor["execute"]>[0]["modelSelection"]>) => ({
      modelId: selection.modelId, baseUrl: `https://${selection.providerId}.example.test/v1`,
      apiKey: `dummy-${selection.providerId}`, reasoningEffort: selection.options!.reasoningLevel as "high" | "xhigh" | "low",
    }));
    const executor = new NativeCodexExecutor({ ...options, model: "launcher-model", baseUrl: "https://launcher.example.test/v1", env: { CODEX_ZCODE_API_KEY: "launcher-key" }, resolveModel });
    const first = { providerId: "provider-a", modelId: "deepseek-v4.1-flash", options: { reasoningLevel: "high" } };
    const second = { providerId: "provider-b", modelId: "gpt-test", options: { reasoningLevel: "xhigh" } };
    const third = { ...second, options: { reasoningLevel: "low" } };
    await executor.execute(input({ modelSelection: first }));
    await executor.execute(input({ inputId: "input-2", modelSelection: second }));
    await executor.execute(input({ inputId: "input-3", modelSelection: third }));
    expect(resolveModel.mock.calls.map(([selection]) => selection)).toEqual([first, second, third]);
    expect(remote.calls.find(m => m.method === "thread/start")?.params).toMatchObject({ model: first.modelId, modelProvider: "zcode_api", config: { model_reasoning_effort: "high" } });
    expect(remote.calls.filter(m => m.method === "thread/resume").map(m => m.params)).toEqual([
      expect.objectContaining({ threadId: "thread-1", model: second.modelId, modelProvider: "zcode_api", config: { model_reasoning_effort: "xhigh" } }),
      expect.objectContaining({ threadId: "thread-1", model: third.modelId, modelProvider: "zcode_api", config: { model_reasoning_effort: "low" } }),
    ]);
    expect(remote.calls.filter(m => m.method === "turn/start").map(m => ({ model: m.params?.model, effort: m.params?.effort }))).toEqual([{ model: first.modelId, effort: "high" }, { model: second.modelId, effort: "xhigh" }, { model: third.modelId, effort: "low" }]);
    for (const [index, selection] of [first, second, third].entries()) {
      const [, args, spawnOptions] = mock.spawn.mock.calls[index]!;
      expect(args).toContain(`model_providers.zcode_api.base_url=${JSON.stringify(`https://${selection.providerId}.example.test/v1`)}`);
      expect(args).toContain(`model_providers.zcode_selected.base_url=${JSON.stringify(`https://${selection.providerId}.example.test/v1`)}`);
      expect(args).toContain('shell_environment_policy.exclude=["CODEX_ZCODE_API_KEY"]');
      expect(JSON.stringify(args)).not.toContain("dummy-");
      expect(spawnOptions.env.CODEX_ZCODE_API_KEY).toBe(`dummy-${selection.providerId}`);
    }
    expect(executor).toBeDefined();
  });

  it.each(["zcode_api", "zcode_selected"])("preserves %s thread identity while selecting provider B", async savedProvider => {
    const { options } = await fixture();
    const remote = server((m, emit) => {
      if (m.method !== "thread/read") return false;
      emit({ id: m.id, result: { thread: { id: "thread-1", cwd: options.workspacePath, modelProvider: savedProvider } } }); return true;
    });
    await new NativeCodexExecutor({ ...options, provider: savedProvider }).execute(input());
    const resolveModel = vi.fn(async () => ({ modelId: "provider-b-model", baseUrl: "http://127.0.0.1:41112/provider-b/v1", apiKey: "dummy-provider-b", reasoningEffort: "low" as const }));
    await new NativeCodexExecutor({ ...options, env: { CODEX_ZCODE_API_KEY: "stale-provider-a" }, resolveModel }).execute(input({ inputId: "next", modelSelection: { providerId: "provider-b", modelId: "provider-b-model", options: { reasoningLevel: "low" } } }));
    expect(remote.calls.filter(m => m.method === "thread/start")).toHaveLength(1);
    expect(remote.calls.filter(m => m.method === "thread/read").map(m => m.params)).toEqual([{ threadId: "thread-1", includeTurns: false }]);
    expect(remote.calls.findIndex(m => m.method === "thread/read")).toBeLessThan(remote.calls.findIndex(m => m.method === "thread/resume"));
    expect(remote.calls.find(m => m.method === "thread/resume")?.params).toMatchObject({ modelProvider: savedProvider, model: "provider-b-model", config: { model_reasoning_effort: "low" } });
    expect(remote.calls.filter(m => m.method === "turn/start").at(-1)?.params).toMatchObject({ model: "provider-b-model", effort: "low" });
    const [, args, child] = mock.spawn.mock.calls[1]!;
    expect(args).toContain('model_provider="zcode_api"');
    for (const alias of ["zcode_api", "zcode_selected"]) {
      expect(args.filter((arg: string) => arg === `model_providers.${alias}.base_url="http://127.0.0.1:41112/provider-b/v1"`)).toHaveLength(1);
      expect(args).toContain(`model_providers.${alias}.env_key="CODEX_ZCODE_API_KEY"`);
    }
    expect(child.env.CODEX_ZCODE_API_KEY).toBe("dummy-provider-b");
    expect(JSON.stringify(args)).not.toContain("dummy-provider-b");
    const state = join(options.codexHome, "zcode-native");
    const workspaceDir = join(state, (await readdir(state))[0]);
    const sessionDir = join(workspaceDir, (await readdir(workspaceDir))[0]);
    expect(JSON.parse(await readFile(join(sessionDir, "thread.json"), "utf8"))).not.toHaveProperty("provider");
  });

  it.each([
    { id: "wrong-thread", modelProvider: "zcode_api" },
    { modelProvider: undefined }, { modelProvider: "bad.alias" }, { cwd: "wrong-workspace" },
  ])("fails closed for invalid thread metadata %j", async mismatch => {
    const { executor, options } = await fixture();
    const remote = server((m, emit) => {
      if (m.method !== "thread/read") return false;
      emit({ id: m.id, result: { thread: { id: "thread-1", cwd: options.workspacePath, modelProvider: "zcode_api", ...mismatch } } }); return true;
    });
    await executor.execute(input());
    await expect(executor.execute(input({ inputId: "next" }))).rejects.toThrow("thread metadata");
    expect(remote.calls.filter(m => m.method === "thread/start")).toHaveLength(1);
    expect(remote.calls.filter(m => m.method === "turn/start")).toHaveLength(1);
    expect(remote.calls.filter(m => m.method === "thread/resume")).toHaveLength(0);
  });

  it("rejects an unresolved explicit selection before spawn instead of using launcher defaults", async () => {
    server(); const { options } = await fixture();
    const selection = { providerId: "missing", modelId: "missing", options: { reasoningLevel: "high" } };
    await expect(new NativeCodexExecutor(options).execute(input({ modelSelection: selection }))).rejects.toThrow("resolver is unavailable");
    await expect(new NativeCodexExecutor({ ...options, resolveModel: () => { throw new Error("unsupported effort"); } }).execute(input({ modelSelection: selection }))).rejects.toThrow("unsupported effort");
    expect(mock.spawn).not.toHaveBeenCalled();
  });

  it("opts in only the exact configured workspace and requires explicit paths", async () => {
    const { options } = await fixture();
    expect(createNativeCodexExecutorFromEnv(options.workspacePath, {})).toBeUndefined();
    const env = { ZCODE_CODEX_WORKSPACE: options.workspacePath, ZCODE_CODEX_BINARY: options.binaryPath, CODEX_HOME: options.codexHome };
    expect(createNativeCodexExecutorFromEnv(`${options.workspacePath}-other`, env)).toBeUndefined();
    expect(createNativeCodexExecutorFromEnv(options.workspacePath, env)).toBeInstanceOf(NativeCodexExecutor);
    expect(() => createNativeCodexExecutorFromEnv(options.workspacePath, { ZCODE_CODEX_WORKSPACE: options.workspacePath })).toThrow("absolute");
  });

  it("handshakes without a shell, serializes events and resumes durable threads across instances", async () => {
    const remote = server(); const { executor, options } = await fixture();
    let active = 0; let max = 0; const events: NativeTurnEvent[] = [];
    const first = input({ onEvent: async event => { active++; max = Math.max(max, active); await new Promise(resolve => setTimeout(resolve, 5)); events.push(event); active--; } });
    expect(await executor.execute(first)).toEqual({ text: "你好", threadId: "thread-1", toolCallCount: 0 });
    expect(max).toBe(1); expect(events).toEqual([{ type: "textStarted", itemId: "msg" }, { type: "textDelta", itemId: "msg", delta: "你" }, { type: "textDelta", itemId: "msg", delta: "好" }, { type: "textCompleted", itemId: "msg" }]);
    await new NativeCodexExecutor(options).execute(input({ inputId: "input-2" }));
    expect(remote.calls.filter(m => m.method === "thread/start")).toHaveLength(1);
    expect(remote.calls.filter(m => m.method === "thread/resume")).toHaveLength(1);
    expect(remote.calls.map(m => m.method).slice(0, 4)).toEqual(["initialize", "initialized", "thread/start", "turn/start"]);
    expect(remote.calls.find(m => m.method === "thread/start")?.params).toMatchObject({ sandbox: "workspace-write", approvalPolicy: "on-request", model: "gpt-6.1-sol", modelProvider: "zcode_api" });
    expect(mock.spawn.mock.calls[0][2]).toMatchObject({ shell: false, windowsHide: true, env: { CODEX_HOME: options.codexHome, TEST_CREDENTIAL: "must-not-log" } });
    expect(remote.children.every(child => child.kill.mock.calls.length === 1)).toBe(true);
  });

  it.each([
    ["yolo", false, "danger-full-access", "never", "dangerFullAccess"],
    ["plan", false, "read-only", "never", "readOnly"],
    ["yolo", true, "read-only", "never", "readOnly"],
    ["build", false, "workspace-write", "on-request", "workspaceWrite"],
    ["edit", false, "workspace-write", "on-request", "workspaceWrite"],
    ["auto", false, "workspace-write", "on-request", "workspaceWrite"],
    ["guarded", false, "workspace-write", "untrusted", "workspaceWrite"],
  ] as const)("applies %s plan=%s at startup, thread and turn boundaries", async (mode, planEnabled, sandbox, approvalPolicy, type) => {
    const remote = server(); const { executor } = await fixture();
    await executor.execute(input({ permission: { mode, planEnabled } }));
    expect(mock.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining([`sandbox_mode=${JSON.stringify(sandbox)}`, `approval_policy=${JSON.stringify(approvalPolicy)}`]));
    expect(remote.calls.find(m => m.method === "thread/start")?.params).toMatchObject({ sandbox, approvalPolicy });
    expect(remote.calls.find(m => m.method === "turn/start")?.params).toMatchObject({ approvalPolicy, sandboxPolicy: { type } });
  });

  it("overrides persisted yolo permissions on resume and isolates another session", async () => {
    const remote = server(); const { executor } = await fixture();
    await executor.execute(input({ permission: { mode: "yolo", planEnabled: false } }));
    await executor.execute(input({ inputId: "next", permission: { mode: "build", planEnabled: false } }));
    await executor.execute(input({ sessionId: "other", inputId: "other" }));
    expect(remote.calls.find(m => m.method === "thread/resume")?.params).toMatchObject({ sandbox: "workspace-write", approvalPolicy: "on-request" });
    expect(remote.calls.filter(m => m.method === "turn/start").map(m => m.params?.sandboxPolicy)).toEqual([
      { type: "dangerFullAccess" }, expect.objectContaining({ type: "workspaceWrite" }), expect.objectContaining({ type: "workspaceWrite" }),
    ]);
    expect(remote.calls.filter(m => m.method === "thread/start")).toHaveLength(2);
  });

  it("forwards approval denial and translates command tools while ignoring stale events", async () => {
    const remote = server((m, emit) => {
      if (m.method === "turn/start") {
        emit({ id: m.id, result: { turn: { id: "turn-1" } } });
        emit({ method: "item/agentMessage/delta", params: { ...activeParams, turnId: "stale", itemId: "bad", delta: "stale" } });
        emit({ method: "item/started", params: { ...activeParams, item: { type: "commandExecution", id: "cmd", command: "pwd" } } });
        emit({ id: 900, method: "item/commandExecution/requestApproval", params: { ...activeParams, itemId: "cmd", command: "pwd", reason: "permission" } });
        return true;
      }
      if (m.id === 900 && m.result) {
        emit({ method: "item/completed", params: { ...activeParams, item: { type: "commandExecution", id: "cmd", status: "declined", aggregatedOutput: "denied" } } });
        emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
        return true;
      }
      return false;
    });
    const { executor } = await fixture(); const request = input();
    expect(await executor.execute(request)).toEqual({ text: "", threadId: "thread-1", toolCallCount: 1 });
    expect(request.requestApproval).toHaveBeenCalledWith(expect.objectContaining({ id: "900", toolCallId: "cmd", name: "Bash", input: expect.objectContaining({ command: "pwd" }), reason: "permission" }));
    expect(remote.calls.find(m => m.id === 900)?.result).toEqual({ decision: "decline" });
    expect(vi.mocked(request.onEvent).mock.calls.map(([event]) => event.type)).toEqual(["toolStarted", "toolCompleted"]);
    expect(vi.mocked(request.onEvent).mock.calls[1][0]).toMatchObject({ failed: true, output: "denied" });
  });

  it.each([
    { kind: "commandExecution", name: "Bash", rpcId: 902, decision: "allow", reply: "accept", first: true },
    { kind: "commandExecution", name: "Bash", rpcId: "approval-command", decision: "deny", reply: "decline", first: false },
    { kind: "fileChange", name: "Edit", rpcId: "approval-file", decision: "allow", reply: "accept", first: true },
    { kind: "fileChange", name: "Edit", rpcId: 0, decision: "deny", reply: "decline", first: false },
  ] as const)("keeps $kind approval $rpcId separate from its item (approval first: $first)", async ({ kind, name, rpcId, decision, reply, first }) => {
    const toolCallId = "native-tool-item";
    const item = { type: kind, id: toolCallId, ...(kind === "commandExecution" ? { command: "Get-Location", cwd: "workspace" } : { changes: [{ path: "example.txt", kind: { type: "update" }, diff: "+test" }] }) };
    const params = { ...activeParams, itemId: toolCallId, startedAtMs: 1, ...(kind === "commandExecution" ? { kind: "command", environmentId: null, command: "Get-Location", cwd: "workspace" } : { grantRoot: null }) };
    const events: NativeTurnEvent[] = [];
    const remote = server((m, emit) => {
      if (m.method === "turn/start") {
        emit({ id: m.id, result: { turn: { id: "turn-1" } } });
        if (!first) emit({ method: "item/started", params: { ...activeParams, item } });
        emit({ id: rpcId, method: `item/${kind}/requestApproval`, params });
        return true;
      }
      if (m.id === rpcId && m.result) {
        // 重复、迟到的 started/completed 不能再次建卡或增加工具计数。
        emit({ method: "item/started", params: { ...activeParams, item } });
        emit({ method: "item/started", params: { ...activeParams, item } });
        const completed = { ...activeParams, item: { ...item, status: decision === "allow" ? "completed" : "declined", aggregatedOutput: "done" } };
        emit({ method: "item/completed", params: completed });
        emit({ method: "item/completed", params: completed });
        emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
        return true;
      }
      return false;
    });
    const { executor } = await fixture();
    const requestApproval = vi.fn(async (request: NativeTurnApproval) => {
      expect(request).toEqual({ id: String(rpcId), toolCallId, name, input: params });
      expect(events).toEqual([expect.objectContaining({ type: "toolStarted", id: toolCallId, name, input: expect.objectContaining(kind === "commandExecution" ? { command: "Get-Location" } : { type: "fileChange" }) })]);
      return decision;
    });
    expect(await executor.execute(input({ onEvent: async event => { await Promise.resolve(); events.push(event); }, requestApproval }))).toMatchObject({ toolCallCount: 1 });
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(remote.calls.filter(m => m.id === rpcId)).toEqual([{ id: rpcId, result: { decision: reply } }]);
    expect(events.map(event => event.type)).toEqual(["toolStarted", "toolCompleted"]);
  });

  it.each([undefined, null, 42, "", "   ", " item ", "item\n", "x".repeat(513)])("fails closed for invalid approval item ID %j", async itemId => {
    const remote = server((m, emit) => {
      if (m.method !== "turn/start") return false;
      emit({ id: m.id, result: { turn: { id: "turn-1" } } });
      emit({ id: "invalid-item", method: "item/commandExecution/requestApproval", params: { ...activeParams, itemId, command: "Get-Location" } });
      return true;
    });
    const { executor } = await fixture(); const request = input();
    await expect(executor.execute(request)).rejects.toThrow("invalid tool item identifier");
    expect(remote.calls.find(m => m.id === "invalid-item")).toEqual({ id: "invalid-item", error: expect.objectContaining({ code: -32602 }) });
    expect(request.requestApproval).not.toHaveBeenCalled();
    expect(request.onEvent).not.toHaveBeenCalled();
    await expect(executor.execute(request)).rejects.toThrow("will not be replayed");
    expect(remote.calls.filter(m => m.method === "turn/start")).toHaveLength(1);
  });

  it.each([{ threadId: "wrong" }, { turnId: "wrong" }, { threadId: undefined }, { turnId: undefined }])("rejects approval outside the exact active thread/turn %j", async mismatch => {
    const remote = server((m, emit) => {
      if (m.method !== "turn/start") return false;
      emit({ id: m.id, result: { turn: { id: "turn-1" } } });
      emit({ id: "stale", method: "item/fileChange/requestApproval", params: { ...activeParams, ...mismatch, itemId: "edit" } });
      return true;
    });
    const { executor } = await fixture(); const request = input();
    await expect(executor.execute(request)).rejects.toThrow("does not belong to the active turn");
    expect(remote.calls.find(m => m.id === "stale")?.error).toMatchObject({ code: -32600 });
    expect(request.requestApproval).not.toHaveBeenCalled();
    expect(request.onEvent).not.toHaveBeenCalled();
  });

  it("answers approval broker errors without granting permission or replaying input", async () => {
    const remote = server((m, emit) => {
      if (m.method !== "turn/start") return false;
      emit({ id: m.id, result: { turn: { id: "turn-1" } } });
      emit({ id: "broker-error", method: "item/fileChange/requestApproval", params: { ...activeParams, itemId: "edit" } });
      return true;
    });
    const { executor } = await fixture();
    const request = input({ requestApproval: async () => { throw new Error("broker unavailable"); } });
    await expect(executor.execute(request)).rejects.toThrow("broker unavailable");
    expect(remote.calls.find(m => m.id === "broker-error")).toEqual({ id: "broker-error", error: expect.objectContaining({ code: -32603 }) });
    await expect(executor.execute(request)).rejects.toThrow("will not be replayed");
    expect(remote.calls.filter(m => m.method === "turn/start")).toHaveLength(1);
  });

  it("interrupts even if cancellation occurs before the turn/start response", async () => {
    const controller = new AbortController();
    const remote = server((m, emit) => {
      if (m.method !== "turn/start") return false;
      controller.abort();
      emit({ id: m.id, result: { turn: { id: "turn-1" } } });
      return true;
    });
    const { executor } = await fixture();
    await expect(executor.execute(input({ signal: controller.signal }))).rejects.toMatchObject({ name: "AbortError" });
    expect(remote.calls.find(m => m.method === "turn/interrupt")?.params).toEqual(activeParams);
  });

  it("fails unsupported user questions visibly without granting permission", async () => {
    const remote = server((m, emit) => {
      if (m.method !== "turn/start") return false;
      emit({ id: m.id, result: { turn: { id: "turn-1" } } });
      emit({ id: "q", method: "item/unknown/requestInput", params: { ...activeParams } });
      return true;
    });
    const { executor } = await fixture(); const request = input();
    await expect(executor.execute(request)).rejects.toThrow("unsupported interaction");
    expect(remote.calls.find(m => m.id === "q")?.error).toMatchObject({ code: -32601 });
    expect(request.requestApproval).not.toHaveBeenCalled();
  });

  it("does not replay duplicate input IDs or silently fork failed resumes", async () => {
    const { executor, options } = await fixture();
    const first = server();
    await executor.execute(input());
    await expect(executor.execute(input())).rejects.toThrow("will not be replayed");
    expect(first.calls.filter(m => m.method === "turn/start")).toHaveLength(1);
    const next = server((m, emit) => { if (m.method === "thread/read") { emit({ id: m.id, result: { thread: { id: "thread-1", cwd: options.workspacePath, modelProvider: "zcode_api" } } }); return true; } if (m.method !== "thread/resume") return false; emit({ id: m.id, error: { code: -32600, message: "secret provider error", data: { key: "secret" } } }); return true; });
    await expect(new NativeCodexExecutor(options).execute(input({ inputId: "next" }))).rejects.toThrow("Codex thread/resume failed (-32600).");
    await expect(new NativeCodexExecutor(options).execute(input({ inputId: "third" }))).rejects.toThrow("Codex thread/resume failed (-32600).");
    expect(next.calls.some(m => m.method === "thread/start" || m.method === "turn/start")).toBe(false);
  });

  it("redacts provider details from safe RPC failure diagnostics", async () => {
    const remote = server((m, emit) => {
      if (m.method !== "thread/read") return false;
      emit({ id: m.id, error: { code: -32600, message: "Bearer secret-key", data: { apiKey: "secret-data" } } }); return true;
    });
    const { executor } = await fixture(); await executor.execute(input());
    const error = await executor.execute(input({ inputId: "read-error" })).then(() => undefined, value => value as Error);
    expect(error?.message).toBe("Codex thread/read failed (-32600).");
    expect(error?.message).not.toContain("secret");
  });

  it("distinguishes malformed RPC responses from coded failures", async () => {
    const remote = server((m, emit) => { if (m.method !== "thread/read") return false; emit({ id: m.id, error: { message: "not a string", data: { apiKey: "secret-data" } } }); return true; });
    const { executor } = await fixture(); await executor.execute(input());
    const error = await executor.execute(input({ inputId: "invalid-response" })).then(() => undefined, value => value as Error);
    expect(error?.message).toBe("Codex thread/read returned an invalid response.");
  });

  it("rejects concurrent session ownership and aborts without waiting for approval UI", async () => {
    let approvalReady!: () => void; const ready = new Promise<void>(resolve => { approvalReady = resolve; });
    const remote = server((m, emit) => {
      if (m.method !== "turn/start") return false;
      emit({ id: m.id, result: { turn: { id: "turn-1" } } });
      emit({ id: 901, method: "item/fileChange/requestApproval", params: { ...activeParams, itemId: "edit-waiting", startedAtMs: 1 } }); return true;
    });
    const { executor, options } = await fixture(); const controller = new AbortController();
    let resolveApproval!: (decision: "allow" | "deny") => void;
    const request = input({ signal: controller.signal, requestApproval: async () => { approvalReady(); return await new Promise<"allow" | "deny">(resolve => { resolveApproval = resolve; }); } });
    const pending = executor.execute(request);
    await ready;
    expect(vi.mocked(request.onEvent).mock.calls).toEqual([[expect.objectContaining({ type: "toolStarted", id: "edit-waiting", name: "Edit" })]]);
    await expect(new NativeCodexExecutor(options).execute(input({ inputId: "concurrent" }))).rejects.toThrow("already active");
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    resolveApproval("allow");
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(remote.calls.find(m => m.method === "turn/interrupt")).toBeDefined();
    expect(remote.calls.some(m => m.id === 901)).toBe(false);
    expect(remote.children[0].kill).toHaveBeenCalledTimes(1);
    await expect(executor.execute(input())).rejects.toThrow("will not be replayed");
    expect(remote.calls.filter(m => m.method === "turn/start")).toHaveLength(1);
  });

  it("reports remote turn failures and process exits without replaying", async () => {
    const remote = server((m, emit) => {
      if (m.method !== "turn/start") return false;
      emit({ id: m.id, result: { turn: { id: "turn-1" } } });
      emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "failed", error: { message: "credential must not escape" } } } });
      return true;
    });
    const { executor } = await fixture();
    await expect(executor.execute(input())).rejects.toThrow("Official Codex turn failed");
    expect(remote.calls.filter(m => m.method === "turn/start")).toHaveLength(1);
    const disconnected = server((m) => {
      if (m.method !== "turn/start") return false;
      queueMicrotask(() => disconnected.children[0].emit("exit", 1));
      return true;
    });
    await expect(executor.execute(input({ inputId: "disconnect" }))).rejects.toThrow("disconnected");
  });

  it("registers optional skill roots and passes provider credentials only in environment", async () => {
    const remote = server((m, emit) => {
      if (m.method !== "skills/extraRoots/set") return false;
      emit({ id: m.id, result: {} }); return true;
    });
    const { options } = await fixture();
    await new NativeCodexExecutor({ ...options, baseUrl: "https://example.invalid/v1", skillRoots: [options.workspacePath], env: { CODEX_ZCODE_API_KEY: "test-secret" } }).execute(input());
    expect(remote.calls.find(m => m.method === "skills/extraRoots/set")?.params).toEqual({ extraRoots: [options.workspacePath] });
    expect(mock.spawn.mock.calls[0][1].join(" ")).not.toContain("test-secret");
    expect(mock.spawn.mock.calls[0][2].env.CODEX_ZCODE_API_KEY).toBe("test-secret");
  });

  it("passes reviewed documents MCP overrides unchanged through optional environment config", async () => {
    server(); const { options } = await fixture();
    const overrides = ["-c", 'mcp_servers.documents.command="C:\\\\Program Files\\\\ZCode\\\\ZCode.exe"', "-c", 'mcp_servers.documents.args=["__zcode-plugin-host", "documents"]', "-c", 'mcp_servers.documents.enabled=true'];
    const env = { ZCODE_CODEX_WORKSPACE: options.workspacePath, ZCODE_CODEX_BINARY: options.binaryPath, CODEX_HOME: options.codexHome, ZCODE_CODEX_MCP_OVERRIDES_JSON: JSON.stringify(overrides) };
    await createNativeCodexExecutorFromEnv(options.workspacePath, env)!.execute(input());
    expect(mock.spawn.mock.calls[0][1].slice(-overrides.length)).toEqual(overrides);
    expect(mock.spawn.mock.calls[0][2].shell).toBe(false);
    await new NativeCodexExecutor({ ...options, configOverrides: [] }).execute(input({ inputId: "empty" }));
    expect(mock.spawn.mock.calls[1][1].some((arg: string) => arg.startsWith("mcp_servers."))).toBe(false);
  });

  it.each([
    ["-c", 'model_provider="other"'],
    ["-c", 'sandbox_mode="danger-full-access"'],
    ["-c", 'approval_policy="never"'],
    ["-c", 'mcp_servers.documents.enabled=true', "-c", 'sandbox_mode="danger-full-access"'],
    ["--config", 'mcp_servers.documents.enabled=true'],
    ["-c"],
    ["-c", 42],
    ["-c", 'mcp_servers.documents.'],
    ["-c", 'mcp_servers.documents..enabled=true'],
  ])("rejects disallowed or malformed MCP override pairs (%j)", async (...overrides) => {
    const { options } = await fixture();
    const env = { ZCODE_CODEX_WORKSPACE: options.workspacePath, ZCODE_CODEX_BINARY: options.binaryPath, CODEX_HOME: options.codexHome, ZCODE_CODEX_MCP_OVERRIDES_JSON: JSON.stringify(overrides) };
    expect(() => createNativeCodexExecutorFromEnv(options.workspacePath, env)).toThrow("MCP overrides");
    await expect(new NativeCodexExecutor({ ...options, configOverrides: overrides as string[] }).execute(input())).rejects.toThrow("MCP overrides");
    expect(mock.spawn).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and non-array MCP overrides", async () => {
    const { options } = await fixture();
    for (const value of ["", "{", "null", "{}", '"-c"']) {
      expect(() => createNativeCodexExecutorFromEnv(options.workspacePath, { ZCODE_CODEX_WORKSPACE: options.workspacePath, ZCODE_CODEX_BINARY: options.binaryPath, CODEX_HOME: options.codexHome, ZCODE_CODEX_MCP_OVERRIDES_JSON: value })).toThrow();
    }
    expect(mock.spawn).not.toHaveBeenCalled();
  });

  it("keeps credentials and prompt text out of durable mapping and receipts", async () => {
    server(); const { executor, options } = await fixture(); await executor.execute(input({ text: "sensitive prompt" }));
    const state = join(options.codexHome, "zcode-native"); const workspaceDir = join(state, (await readdir(state))[0]);
    const sessionDir = join(workspaceDir, (await readdir(workspaceDir))[0]);
    const content = (await Promise.all((await readdir(sessionDir)).map(file => readFile(join(sessionDir, file), "utf8")))).join("");
    expect(content).not.toContain("must-not-log"); expect(content).not.toContain("sensitive prompt");
    await writeFile(join(sessionDir, "thread.json"), "corrupt");
    await expect(executor.execute(input({ inputId: "new" }))).rejects.toThrow("refusing to fork");
  });
});
