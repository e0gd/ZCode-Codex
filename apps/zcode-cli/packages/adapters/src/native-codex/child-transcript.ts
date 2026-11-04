import { open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { record, type NativeTranscriptRecord } from "./connection.js";

type RecordValue = Record<string, unknown>;
type Cursor = { path: string; offset: number; pending: Buffer; verified: boolean; rejected?: boolean; turnId?: string };
const maximumReadBytes = 1024 * 1024;
const maximumLineBytes = 1024 * 1024;
const allowedTypes = new Set(["function_call", "custom_tool_call", "function_call_output", "custom_tool_call_output"]);

/** 只读官方事实；cursor 不拥有执行、终态或 UI 状态，所有展示仍归既有 observer。 */
export class NativeChildTranscriptReader {
  private readonly cursors = new Map<string, Cursor>();
  constructor(private readonly codexHome: string, private readonly request: (method: string, params: RecordValue) => Promise<unknown>) {}

  private async bind(threadId: string): Promise<string | undefined> {
    try {
      const thread = record(record(await this.request("thread/read", { threadId, includeTurns: false })).thread);
      if (thread.id !== threadId || typeof thread.path !== "string") return;
      const root = await realpath(join(this.codexHome, "sessions"));
      const path = await realpath(thread.path);
      const local = relative(root, path);
      if (!local || local.startsWith("..") || isAbsolute(local)) return;
      return path;
    } catch { return; }
  }

  async spawnPrompt(parentThreadId: string, callId: string): Promise<string | undefined> {
    const path = await this.bind(parentThreadId);
    if (!path) return;
    try {
      const file = await open(path, "r");
      try {
        const size = (await file.stat()).size;
        const header = Buffer.alloc(Math.min(size, maximumLineBytes));
        await file.read(header, 0, header.length, 0);
        const first = record(record(JSON.parse(header.toString("utf8").split("\n")[0]!)).payload);
        if (first.id !== parentThreadId) return;
        const offset = Math.max(0, size - maximumReadBytes);
        const data = Buffer.alloc(Math.min(size, maximumReadBytes)); await file.read(data, 0, data.length, offset);
        const rows = data.toString("utf8").split("\n");
        if (offset) rows.shift();
        for (const line of rows) {
          if (!line || Buffer.byteLength(line) > maximumLineBytes) continue;
          let row: RecordValue; try { row = record(JSON.parse(line)); } catch { continue; }
          const item = record(row.payload);
          if (row.type !== "response_item" || item.type !== "function_call" || item.call_id !== callId || item.name !== "spawn_agent" || !["collaboration", "multi_agent_v1"].includes(String(item.namespace)) || typeof item.arguments !== "string") continue;
          const args = record(JSON.parse(item.arguments));
          if (typeof args.message === "string") return args.message;
        }
      } finally { await file.close(); }
    } catch { return; }
  }

  async read(threadId: string, parentThreadId: string): Promise<NativeTranscriptRecord[]> {
    try {
      let cursor = this.cursors.get(threadId);
      if (!cursor) {
        const path = await this.bind(threadId);
        if (!path) return [];
        cursor = { path, offset: 0, pending: Buffer.alloc(0), verified: false };
        this.cursors.set(threadId, cursor);
      }
      if (cursor.rejected) return [];
      const file = await open(cursor.path, "r");
      try {
        const size = (await file.stat()).size;
        if (size < cursor.offset || await realpath(cursor.path) !== cursor.path) return [];
        const count = Math.min(size - cursor.offset, maximumReadBytes);
        if (!count) return [];
        const data = Buffer.alloc(count);
        const read = await file.read(data, 0, count, cursor.offset); cursor.offset += read.bytesRead;
        const bytes = Buffer.concat([cursor.pending, data.subarray(0, read.bytesRead)]);
        const lastNewline = bytes.lastIndexOf(10);
        if (lastNewline < 0) { cursor.pending = bytes.length <= maximumLineBytes ? bytes : Buffer.alloc(0); return []; }
        cursor.pending = bytes.subarray(lastNewline + 1);
        const result: NativeTranscriptRecord[] = [];
        for (const line of bytes.subarray(0, lastNewline).toString("utf8").split("\n")) {
          if (!line || Buffer.byteLength(line) > maximumLineBytes) continue;
          let row: RecordValue; try { row = record(JSON.parse(line)); } catch { continue; }
          const item = record(row.payload);
          if (!cursor.verified) {
            // 子线程的 session_id 可以是根线程；只有 id 才是官方 Thread.id。
            if (row.type !== "session_meta" || item.id !== threadId || item.parent_thread_id !== parentThreadId) { cursor.rejected = true; return []; }
            cursor.verified = true; continue;
          }
          if ((row.type === "event_msg" && item.type === "task_started") || row.type === "turn_context") {
            if (typeof item.turn_id === "string") cursor.turnId = item.turn_id;
          }
          if (row.type === "response_item" && allowedTypes.has(String(item.type))) result.push({ turnId: cursor.turnId, item });
        }
        return result;
      } finally { await file.close(); }
    } catch { return []; }
  }
}
