import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

type RecordValue = Record<string, unknown>;
export const record = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const recordError = (value: unknown): { code: number } | undefined => {
  const error = record(value);
  return Number.isInteger(error.code) ? { code: error.code as number } : undefined;
};
export const identifier = (value: unknown): string => {
  if (typeof value !== "string" || !value || value.length > 512) {
    throw new Error("Codex returned an invalid identifier.");
  }
  return value;
};
export type RpcMessage = { method: string; params: RecordValue; id?: string | number };

/** One stdio connection; never retries a possibly accepted request. */
export class CodexConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private failure?: Error;
  private readonly onFailure: (error: Error) => void;
  private readonly pending = new Map<number, {
    method: string;
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(options: {
    binaryPath: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    onMessage(message: RpcMessage): void;
    onFailure(error: Error): void;
  }) {
    this.onFailure = options.onFailure;
    this.child = spawn(options.binaryPath, options.args, {
      cwd: options.cwd, env: options.env, shell: false, windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const fail = (message: string) => {
      if (this.failure) return;
      const error = new Error(message);
      this.close(error);
      options.onFailure(error);
    };
    this.child.on("error", () => fail("Official Codex could not start."));
    this.child.on("exit", () => fail("Official Codex disconnected; the input was not retried."));
    this.child.stdin.on("error", () => fail("Official Codex input connection closed."));
    // Diagnostics can contain provider credentials: drain without persisting or logging.
    this.child.stderr.on("data", () => {});
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    this.child.stdout.on("data", (chunk: Buffer) => {
      if (this.failure) return;
      buffer += decoder.write(chunk);
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > 16 * 1024 * 1024) return fail("Codex protocol frame too large.");
        if (!line.trim()) continue;
        try {
          const message = record(JSON.parse(line));
          if (typeof message.method === "string") {
            if (message.id !== undefined && typeof message.id !== "string" && typeof message.id !== "number") {
              return fail("Invalid Codex request identifier.");
            }
            options.onMessage({ method: message.method, params: record(message.params),
              ...(message.id !== undefined ? { id: message.id as string | number } : {}) });
          } else {
            const request = this.pending.get(message.id as number);
            if (!request) continue;
            this.pending.delete(message.id as number);
            clearTimeout(request.timer);
            if (message.error || !("result" in message)) {
              const responseError = recordError(message.error);
              request.reject(responseError
                ? new Error(`Codex ${request.method} failed (${responseError.code}).`)
                : new Error(`Codex ${request.method} returned an invalid response.`));
            } else request.resolve(message.result);
          }
        } catch {
          return fail("Codex sent an invalid protocol message.");
        }
      }
      if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) fail("Codex protocol buffer too large.");
    });
  }

  send(message: RecordValue): void {
    if (this.failure) throw this.failure;
    if (!this.child.stdin.writable || this.child.stdin.writableLength > 1024 * 1024) {
      throw new Error("Codex input connection is unavailable.");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method: string, params: RecordValue): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`Codex ${method} timed out; the operation was not retried.`);
        this.close(error);
        this.onFailure(error);
        reject(error);
      }, 60_000);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close(error = new Error("Codex connection closed.")): void {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.child.kill();
  }
}
