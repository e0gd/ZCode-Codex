import { describe, expect, it, vi } from "vitest";
import type { NativeSubagentUpdate } from "@zcode/contracts";
import { NativeChildObserver, nativeToolInput, nativeToolOutput } from "../src/native-codex/connection.js";

const envelope = (text: string) => `c2a-msg-v1:${Buffer.from(text).toString("base64")}`;
const reported = "c2a-msg-v1:OTErNzg95aSa5bCR";
const modern = (prompt: string) => ({ type: "subAgentActivity", kind: "started", id: "spawn", agentThreadId: "child", agentPath: "/root/child", prompt });
const legacy = (prompt: string) => ({ type: "collabAgentToolCall", tool: "spawnAgent", id: "spawn", status: "completed", receiverThreadIds: ["child"], prompt });

describe("native child task envelope display", () => {
  it.each([modern, legacy])("decodes child labels, launch cards and ACKs without changing native facts (%#)", async spawn => {
    const emit = vi.fn(async (_event: NativeSubagentUpdate) => {});
    const observer = new NativeChildObserver(emit, "parent");
    const item = spawn(reported);
    await observer.collaboration(item);
    expect(emit.mock.calls[0]?.[0]).toMatchObject({ prompt: "91+78=多少", status: "running" });
    expect(nativeToolInput(item)).toMatchObject({ prompt: "91+78=多少", description: "91+78=多少" });
    expect(JSON.parse(nativeToolOutput(item, "parent"))).toMatchObject({ prompt: "91+78=多少", description: "91+78=多少", status: "async_launched" });
    expect(item.prompt).toBe(reported);
    expect(observer.relations()[0]?.prompt).toBe(reported);
  });

  it.each(["分析中文\n第二行 🧑‍💻", "a", "ab", "abc", "\uFEFFtask"])("preserves UTF-8 and accepts optional canonical padding: %s", async text => {
    for (const prompt of [envelope(text), envelope(text).replace(/=+$/, "")]) {
      const emit = vi.fn(async (_event: NativeSubagentUpdate) => {});
      await new NativeChildObserver(emit, "parent").collaboration(modern(prompt));
      expect(emit.mock.calls[0]?.[0].prompt).toBe(text);
    }
  });

  it.each([
    "OTErNzg95aSa5bCR", "plain input", "c2a-msg-v2:YQ==", "c2a-msg-v1:",
    "c2a-msg-v1:!!!!", "c2a-msg-v1:YQ=", "c2a-msg-v1:YQ===", "c2a-msg-v1:YR==",
    "c2a-msg-v1:a", "c2a-msg-v1:_w==", "c2a-msg-v1:/w==", "c2a-msg-v1:wIA=",
    "c2a-msg-v1:7aCA", "c2a-msg-v1:YQ==\n", "prefix c2a-msg-v1:YQ==",
  ])("preserves unsupported or malformed text: %s", async prompt => {
    const emit = vi.fn(async (_event: NativeSubagentUpdate) => {});
    await new NativeChildObserver(emit, "parent").collaboration(modern(prompt));
    expect(emit.mock.calls[0]?.[0].prompt).toBe(prompt);
    expect(nativeToolInput(modern(prompt)).description).toBe(prompt.slice(0, 160));
  });

  it("bounds decoding before allocating a decoded task", () => {
    const prompt = `c2a-msg-v1:${"YWFh".repeat(262145)}`;
    expect(nativeToolInput(modern(prompt)).prompt).toBe(prompt);
  });

  it("decodes each live/follow-up user block but leaves assistant and tool output alone", async () => {
    const emit = vi.fn(async (_event: NativeSubagentUpdate) => {});
    const observer = new NativeChildObserver(emit, "parent");
    await observer.collaboration(modern(reported));
    for (const turnId of ["first", "followup"]) {
      await observer.notification({ method: "item/completed", params: { threadId: "child", turnId, item: {
        type: "userMessage", id: `input-${turnId}`, content: [{ type: "text", text: reported }, { type: "image", url: "ignored" }, { type: "text", text: envelope("下一步\n🙂") }, { type: "text", text: "unchanged" }],
      } } });
      expect(emit.mock.calls.at(-1)?.[0]).toMatchObject({ turnId, inputText: "91+78=多少\n下一步\n🙂\nunchanged" });
    }
    await observer.notification({ method: "item/completed", params: { threadId: "child", turnId: "followup", item: { type: "agentMessage", id: "answer", text: reported } } });
    await observer.notification({ method: "item/completed", params: { threadId: "child", turnId: "followup", item: { type: "commandExecution", id: "tool", command: "echo", aggregatedOutput: reported } } });
    expect(emit.mock.calls.at(-1)?.[0]).toMatchObject({ items: [expect.objectContaining({ text: reported }), expect.objectContaining({ output: reported })] });
  });

  it("decodes only one layer across repeated publication and restoration", async () => {
    const prompt = envelope(reported);
    const emit = vi.fn(async (_event: NativeSubagentUpdate) => {});
    const observer = new NativeChildObserver(emit, "parent");
    await observer.collaboration(modern(prompt));
    await observer.notification({ method: "item/completed", params: { threadId: "child", turnId: "first", item: { type: "userMessage", id: "input", content: [{ text: prompt }] } } });
    await observer.notification({ method: "item/agentMessage/delta", params: { threadId: "child", turnId: "first", itemId: "answer", delta: "working" } });
    expect(emit.mock.calls.at(-1)?.[0]).toMatchObject({ prompt: reported, inputText: reported });
    const restored = new NativeChildObserver(emit, "parent");
    restored.restore(observer.relations());
    await restored.notification({ method: "turn/started", params: { threadId: "child", turn: { id: "next" } } });
    expect(emit.mock.calls.at(-1)?.[0].prompt).toBe(reported);
    expect(restored.relations()[0]?.prompt).toBe(prompt);
  });

  it("normalizes nested Agent cards and retains native description fallback", async () => {
    const emit = vi.fn(async (_event: NativeSubagentUpdate) => {});
    const observer = new NativeChildObserver(emit, "parent");
    await observer.collaboration(modern("parent task"));
    await observer.notification({ method: "item/completed", params: { threadId: "child", turnId: "first", item: { ...modern(reported), id: "nested", agentThreadId: "nested-child" } } });
    const event = emit.mock.calls.at(-1)?.[0];
    expect(event).toMatchObject({ items: [expect.objectContaining({ name: "Agent", input: expect.objectContaining({ prompt: "91+78=多少", description: "91+78=多少" }) })] });
    if (event?.items[0]?.type !== "tool") throw new Error("Missing nested Agent card");
    expect(JSON.parse(event.items[0].output).description).toBe("91+78=多少");
    const { prompt: _prompt, ...fallback } = modern("");
    expect(nativeToolInput(fallback).description).toBe("/root/child");
    expect(nativeToolInput({ type: "commandExecution", prompt: reported })).toEqual({ type: "commandExecution", prompt: reported });
  });
});
