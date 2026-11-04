import { afterEach, describe, expect, it } from "vitest";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeChildTranscriptReader } from "../src/native-codex/child-transcript.js";
import { NativeChildObserver } from "../src/native-codex/connection.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const row = (type: string, payload: Record<string, unknown>) => JSON.stringify({ type, payload }) + "\n";
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "child-transcript-")); roots.push(home);
  await mkdir(join(home, "sessions"));
  const paths = { parent: join(home, "sessions", "parent.jsonl"), child: join(home, "sessions", "child.jsonl") };
  await writeFile(paths.parent, row("session_meta", { id: "parent" }) + row("response_item", { type: "function_call", call_id: "spawn", namespace: "collaboration", name: "spawn_agent", arguments: JSON.stringify({ message: "Actual child task" }) }));
  await writeFile(paths.child, row("session_meta", { id: "child", session_id: "parent", parent_thread_id: "parent" }) + row("event_msg", { type: "task_started", turn_id: "child-turn" }));
  const reader = new NativeChildTranscriptReader(home, async (_method, params) => ({ thread: { id: params.threadId, path: paths[params.threadId as keyof typeof paths] } }));
  return { home, paths, reader };
}
describe("official native child transcript observations", () => {
  it("reads the exact trusted parent spawn prompt and incremental completed child tools before final output", async () => {
    const { paths, reader } = await fixture();
    expect(await reader.spawnPrompt("parent", "spawn")).toBe("Actual child task");
    const updates: unknown[] = []; const observer = new NativeChildObserver(async update => { updates.push(update); }, "session");
    await observer.collaboration({ type: "subAgentActivity", kind: "started", id: "spawn", agentThreadId: "child", prompt: "Actual child task" });
    await observer.notification({ method: "turn/started", params: { threadId: "child", turn: { id: "child-turn" } } });
    await appendFile(paths.child, row("response_item", { type: "custom_tool_call", call_id: "exec-1", name: "exec", input: 'text("running child output")' }));
    await observer.transcript("child", await reader.read("child", "parent"));
    expect(observer.children.get("child")?.items.get("exec-1")).toMatchObject({ type: "tool", completed: false, name: "exec" });
    await appendFile(paths.child, row("response_item", { type: "custom_tool_call_output", call_id: "exec-1", output: [{ type: "input_text", text: "running child output" }] }));
    await observer.transcript("child", await reader.read("child", "parent"));
    expect(observer.children.get("child")?.items.get("exec-1")).toMatchObject({ completed: true, output: "running child output" });
    expect(observer.running).toBe(true); expect(await reader.read("child", "parent")).toEqual([]);
    expect(updates.length).toBeGreaterThan(2);
  });
  it("holds incomplete UTF8 lines, ignores private records and rejects foreign identity or paths", async () => {
    const { paths, reader, home } = await fixture();
    await appendFile(paths.child, row("response_item", { type: "reasoning", content: ["private"] }) + row("response_item", { type: "message", role: "developer", content: [{ text: "private" }] }));
    const part = row("response_item", { type: "function_call", call_id: "unicode", name: "lookup", arguments: '{"text":"中文"}' });
    await appendFile(paths.child, part.slice(0, -2));
    expect(await reader.read("child", "parent")).toEqual([]);
    await appendFile(paths.child, part.slice(-2));
    expect(await reader.read("child", "parent")).toHaveLength(1);
    const outside = join(home, "outside.jsonl"); await writeFile(outside, row("session_meta", { id: "child" }));
    const unsafe = new NativeChildTranscriptReader(home, async () => ({ thread: { id: "child", path: outside } }));
    expect(await unsafe.read("child", "parent")).toEqual([]);
    const foreign = new NativeChildTranscriptReader(home, async () => ({ thread: { id: "child", path: paths.parent } }));
    expect(await foreign.read("child", "parent")).toEqual([]);
  });
  it("publishes child turn start immediately and exposes command output deltas without completing the tool", async () => {
    const updates: unknown[] = []; const observer = new NativeChildObserver(async update => { updates.push(update); }, "session");
    await observer.collaboration({ type: "subAgentActivity", kind: "started", id: "spawn", agentThreadId: "child", prompt: "Actual child task" });
    await observer.notification({ method: "turn/started", params: { threadId: "child", turn: { id: "child-turn" } } });
    expect(updates.at(-1)).toMatchObject({ turnId: "child-turn", prompt: "Actual child task", status: "running" });
    await observer.notification({ method: "item/started", params: { threadId: "child", turnId: "child-turn", item: { type: "commandExecution", id: "command", command: "dummy" } } });
    await observer.notification({ method: "item/commandExecution/outputDelta", params: { threadId: "child", turnId: "child-turn", itemId: "command", delta: "live stdout" } });
    expect(observer.children.get("child")?.items.get("command")).toMatchObject({ completed: false, output: "live stdout" });
  });
  it("finds a recent spawn in a long parent transcript without accepting unrelated call IDs", async () => {
    const { paths, reader } = await fixture();
    await appendFile(paths.parent, row("response_item", { type: "message", role: "developer", text: "x".repeat(2 * 1024 * 1024) }));
    await appendFile(paths.parent, row("response_item", { type: "function_call", call_id: "latest", namespace: "collaboration", name: "spawn_agent", arguments: JSON.stringify({ message: "Recent child input" }) }));
    expect(await reader.spawnPrompt("parent", "latest")).toBe("Recent child input");
    expect(await reader.spawnPrompt("parent", "missing")).toBeUndefined();
  });
  it("permanently rejects a mismatched file header even if later lines impersonate the expected identity", async () => {
    const { paths, reader } = await fixture();
    await writeFile(paths.child, row("session_meta", { id: "foreign", parent_thread_id: "parent" }));
    expect(await reader.read("child", "parent")).toEqual([]);
    await appendFile(paths.child, row("session_meta", { id: "child", parent_thread_id: "parent" }) + row("event_msg", { type: "task_started", turn_id: "child-turn" }) + row("response_item", { type: "custom_tool_call", name: "exec", call_id: "foreign", input: "private" }));
    expect(await reader.read("child", "parent")).toEqual([]);
  });
  it("does not import stale turn tools, unsolicited outputs or repeat a completed tool", async () => {
    const observer = new NativeChildObserver(async () => {}, "session");
    await observer.collaboration({ type: "subAgentActivity", kind: "started", id: "spawn", agentThreadId: "child" });
    await observer.notification({ method: "turn/started", params: { threadId: "child", turn: { id: "current" } } });
    await observer.transcript("child", [
      { turnId: "old", item: { type: "custom_tool_call", name: "exec", call_id: "stale", input: "ignored" } },
      { turnId: "current", item: { type: "custom_tool_call_output", call_id: "unknown", output: "ignored" } },
      { turnId: "current", item: { type: "custom_tool_call", name: "exec", call_id: "current", input: "actual" } },
      { turnId: "current", item: { type: "custom_tool_call_output", call_id: "current", output: "actual output" } },
      { turnId: "current", item: { type: "custom_tool_call_output", call_id: "current", output: "duplicate" } },
    ]);
    expect(observer.children.get("child")?.items.size).toBe(1);
    expect(observer.children.get("child")?.items.get("current")).toMatchObject({ output: "actual output", completed: true });
  });
});
