import { describe, expect, it, vi } from "vitest";
import { SessionEventType, type SessionEvent } from "@zcode/contracts";
import {
  applyConversationDeltas,
  PROTOCOL_V4_LIMITS,
  type ConversationSnapshot,
  type ConversationTopicFrame,
} from "@zcode/shared/zcode-protocol-v4";
import {
  ConversationTopicPublisher,
  ProjectionPayloadTooLargeError,
} from "../src/zcode-protocol-v4/index.js";

function fixture(retentionMaxBytes = 24 * 1024, retention = 2000) {
  const publisher = new ConversationTopicPublisher("session-1", "epoch-1", {
    retentionMaxBytes,
    retention,
    now: () => 0,
  });
  let seq = 0;
  const events: SessionEvent[] = [];
  const ingest = (type: SessionEvent["type"], payload: unknown) => {
    const event: SessionEvent = {
      id: `event-${++seq}` as SessionEvent["id"],
      sessionId: "session-1" as SessionEvent["sessionId"],
      turnId: "turn-1" as SessionEvent["turnId"],
      traceId: "trace-1" as SessionEvent["traceId"],
      sequenceNumber: seq,
      timestamp: new Date(seq * 1000),
      type,
      payload,
    };
    publisher.ingest(event);
    events.push(event);
  };
  ingest(SessionEventType.SessionCreated, { mode: "default" });
  ingest(SessionEventType.TurnStarted, { turnNumber: 1, input: "task" });
  const tool = (id: string, command: string) =>
    ingest(SessionEventType.ToolCallScheduled, {
      toolCallId: id,
      toolName: "Bash",
      input: { command },
    });
  return { publisher, ingest, tool, events };
}

function apply(
  previous: ConversationSnapshot | null,
  frame: ConversationTopicFrame,
): ConversationSnapshot {
  if (frame.payload.kind === "snapshot") return frame.payload.snapshot;
  expect(previous?.seq).toBe(frame.fromSeq);
  return { ...applyConversationDeltas(previous!, frame.payload.deltas), seq: frame.toSeq };
}

describe("conversation replay log byte retention", () => {
  it.each(["continuous", "replayable"] as const)(
    "%s byte eviction preserves live delivery and snapshot recovery",
    (profile) => {
      const { publisher, tool, ingest } = fixture();
      const initial = publisher.subscribe({ connectionId: "live", deliveryProfile: profile });
      let live = apply(null, initial.frame!);
      const offlineBase = { logEpoch: "epoch-1", seq: live.seq };
      for (let n = 0; n < 12; n++) {
        tool(`tool-${n}`, `${n}:${"command ".repeat(256)}`);
        live = apply(live, publisher.flush(initial.ack.subscriptionId)!);
      }
      // 不满 2000 条但字节已超限：旧实现仍 resume，长时间保留大输入的全部 upsert。
      const recovered = publisher.subscribe({
        connectionId: "reconnected",
        deliveryProfile: profile,
        base: offlineBase,
      });
      expect(recovered.ack.mode).toBe("snapshot");
      let remote = apply(null, recovered.frame!);
      expect(remote).toEqual(live);
      const sameSub = publisher.resyncReserved(initial.ack.subscriptionId, { base: offlineBase });
      expect(sameSub?.ack.mode).toBe("snapshot");
      live = apply(live, sameSub!.frame!);
      ingest(SessionEventType.ToolCallStarted, { toolCallId: "tool-11", toolName: "Bash" });
      live = apply(live, publisher.flush(initial.ack.subscriptionId)!);
      remote = apply(remote, publisher.flush(recovered.ack.subscriptionId)!);
      expect(remote).toEqual(live);
      expect(live).toEqual(publisher.getSnapshot());
    },
  );

  it("drops an oversized single entry and resumes from the exact advanced floor", () => {
    const { publisher, tool, ingest } = fixture(1024);
    const base = { logEpoch: "epoch-1", seq: publisher.getSnapshot().seq };
    tool("oversized", "input".repeat(2048));
    const floor = publisher.getSnapshot().seq;
    expect(publisher.subscribe({ connectionId: "old", base }).ack.mode).toBe("snapshot");
    ingest(SessionEventType.ModelStreaming, { kind: "text_start", delta: "", done: false });
    ingest(SessionEventType.ModelStreaming, { kind: "text_delta", delta: "ok", done: false });
    expect(
      publisher.subscribe({ connectionId: "at-floor", base: { ...base, seq: floor } }).ack.mode,
    ).toBe("resume");
    expect(
      publisher.subscribe({ connectionId: "before-floor", base: { ...base, seq: floor - 1 } }).ack
        .mode,
    ).toBe("snapshot");
  });

  it("charges multibyte and escaped text by UTF-8 JSON bytes", () => {
    const { publisher, ingest } = fixture(2048);
    ingest(SessionEventType.ModelStreaming, { kind: "text_start", delta: "", done: false });
    const base = { logEpoch: "epoch-1", seq: publisher.getSnapshot().seq };
    for (let n = 0; n < 4; n++)
      ingest(SessionEventType.ModelStreaming, {
        kind: "text_delta",
        delta: '你🙂"\\'.repeat(50),
        done: false,
      });
    expect(publisher.subscribe({ connectionId: "utf8", base }).ack.mode).toBe("snapshot");
  });

  it("retains the count bound and accounts for empty delta entries", () => {
    const { publisher, ingest } = fixture(1024 * 1024, 2);
    const base = { logEpoch: "epoch-1", seq: publisher.getSnapshot().seq };
    for (let n = 0; n < 4; n++) ingest(SessionEventType.ModelRequest, {});
    expect(publisher.subscribe({ connectionId: "count", base }).ack.mode).toBe("snapshot");
    expect(
      publisher.subscribe({
        connectionId: "current",
        base: { ...base, seq: publisher.getSnapshot().seq },
      }).ack.mode,
    ).toBe("resume");
  });

  it("keeps exact byte accounting and the inclusive limit without serializing during sampling", () => {
    const { publisher, ingest } = fixture();
    const expected = [
      { seq: publisher.getSnapshot().seq + 1, deltas: [] },
      { seq: publisher.getSnapshot().seq + 2, deltas: [] },
    ].reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry), "utf8"), 0);
    const initial = publisher.collectMemoryDiagnostics();
    ingest(SessionEventType.ModelRequest, {});
    ingest(SessionEventType.ModelRequest, {});
    expect(publisher.collectMemoryDiagnostics()).toEqual({
      replayEntries: initial.replayEntries + 2,
      replayBytes: initial.replayBytes + expected,
    });
    const stringify = vi.spyOn(JSON, "stringify");
    publisher.collectMemoryDiagnostics();
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();

    const size = publisher.collectMemoryDiagnostics().replayBytes;
    const exact = fixture(size);
    exact.ingest(SessionEventType.ModelRequest, {});
    exact.ingest(SessionEventType.ModelRequest, {});
    expect(exact.publisher.collectMemoryDiagnostics().replayBytes).toBe(size);
    const smaller = fixture(size - 1);
    smaller.ingest(SessionEventType.ModelRequest, {});
    smaller.ingest(SessionEventType.ModelRequest, {});
    expect(smaller.publisher.collectMemoryDiagnostics().replayBytes).toBeLessThan(size);
    expect(smaller.publisher.collectMemoryDiagnostics().replayEntries).toBeLessThan(
      exact.publisher.collectMemoryDiagnostics().replayEntries,
    );
  });

  it("successful batch hydration resets the replay byte ledger and creates a recovery boundary", () => {
    const { publisher, tool, events, ingest } = fixture();
    tool("large", "command ".repeat(512));
    const live = publisher.subscribe({ connectionId: "live" });
    const previousBase = { logEpoch: "epoch-1", seq: publisher.getSnapshot().seq };
    publisher.rehydrate(events);
    expect(publisher.collectMemoryDiagnostics()).toEqual({ replayEntries: 0, replayBytes: 0 });
    expect(publisher.flush(live.ack.subscriptionId)?.payload.kind).toBe("snapshot");
    expect(
      publisher.subscribe({
        connectionId: "stale",
        base: { ...previousBase, seq: previousBase.seq - 1 },
      }).ack.mode,
    ).toBe("snapshot");
    ingest(SessionEventType.ModelRequest, {});
    expect(publisher.collectMemoryDiagnostics()).toEqual({
      replayEntries: 1,
      replayBytes: Buffer.byteLength(
        JSON.stringify({ seq: publisher.getSnapshot().seq, deltas: [] }),
        "utf8",
      ),
    });
    expect(publisher.subscribe({ connectionId: "current", base: previousBase }).ack.mode).toBe(
      "resume",
    );
  });

  it("strict hydration fallback carries its bounded ledger instead of retaining previous byte counts", () => {
    const { publisher, tool, events } = fixture();
    tool("large", "command ".repeat(512));
    // 使用真实的超限事件触发现有 fallback；候选拒收后仍能保留后续安全事件。
    const oversized = {
      ...events.at(-1)!,
      sequenceNumber: events.length + 1,
      payload: {
        toolCallId: "oversized",
        toolName: "Bash",
        input: { command: "x".repeat(PROTOCOL_V4_LIMITS.logicalFrameAssemblyMaxBytes) },
      },
    };
    const checkpoint = {
      ...oversized,
      sequenceNumber: oversized.sequenceNumber + 1,
      type: SessionEventType.ModelRequest,
      payload: {},
    };
    const fallbackEvents = [...events, oversized, checkpoint];
    const expected = new ConversationTopicPublisher("session-1", "epoch-1", {
      retentionMaxBytes: 24 * 1024,
    });
    for (const event of fallbackEvents) {
      try {
        expected.ingest(event);
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectionPayloadTooLargeError);
      }
    }
    const onPayloadTooLarge = vi.fn();
    publisher.rehydrate(fallbackEvents, { onPayloadTooLarge });
    expect(onPayloadTooLarge).toHaveBeenCalledTimes(1);
    expect(publisher.getSnapshot()).toEqual(expected.getSnapshot());
    expect(publisher.collectMemoryDiagnostics()).toEqual(expected.collectMemoryDiagnostics());
  });

  it("failed hydration preserves the existing replay ledger, floor, projection and reservation", () => {
    const { publisher, tool, events } = fixture();
    tool("first", "command ".repeat(512));
    const subscription = publisher.subscribe({ connectionId: "live" });
    tool("second", "command ".repeat(512));
    const reserved = publisher.reserveFlush(subscription.ack.subscriptionId);
    const before = publisher.getSnapshot();
    const counters = publisher.collectMemoryDiagnostics();
    const malformed = {
      ...events.at(-1)!,
      type: SessionEventType.TurnError,
      payload: { turnPhase: "model" },
    };
    expect(() => publisher.rehydrate([events[0]!, malformed])).toThrow(TypeError);
    expect(publisher.getSnapshot()).toEqual(before);
    expect(publisher.collectMemoryDiagnostics()).toEqual(counters);
    expect(publisher.reserveFlush(subscription.ack.subscriptionId)).toBe(reserved);
    expect(reserved?.commit()).toBe(true);
  });
});
