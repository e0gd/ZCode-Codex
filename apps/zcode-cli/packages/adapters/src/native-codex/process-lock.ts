import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface LockOwner {
  version: 1;
  token: string;
  pid: number;
  children: number[];
  spawnPending: boolean;
}

const lockMessage =
  "This native session is already active or has an unreconciled process lock. Inspect its Codex thread before clearing the lock.";
const ownerFile = "owner.json";
const isPid = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
function absent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
async function readOwner(lock: string): Promise<LockOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(join(lock, ownerFile), "utf8"));
    return value?.version === 1 &&
      typeof value.token === "string" &&
      value.token.length > 0 &&
      isPid(value.pid) &&
      typeof value.spawnPending === "boolean" &&
      Array.isArray(value.children) &&
      value.children.every(isPid)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
function stale(owner: LockOwner | undefined): owner is LockOwner {
  return (
    owner !== undefined && !owner.spawnPending && absent(owner.pid) && owner.children.every(absent)
  );
}

/** A lock is recoverable only with proof that both the owner and its native children are gone. */
export async function acquireNativeProcessLock(directory: string) {
  const lock = join(directory, "active.lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const previous = await readOwner(lock);
    if (!stale(previous)) throw new Error(lockMessage);
    // CLI 崩溃时 Codex 仍可能存活；只凭目录年龄或父 PID 死亡清锁会并发写同一线程。
    // 在旧锁内部选举唯一恢复者，避免两个请求把刚创建的新锁误当成旧锁移走。
    try {
      await mkdir(join(lock, "recovery"));
    } catch {
      throw new Error(lockMessage);
    }
    const current = await readOwner(lock);
    if (!current || current.token !== previous.token || !stale(current))
      throw new Error(lockMessage);
    const retired = `${lock}.retired-${randomUUID()}`;
    await rename(lock, retired);
    await rm(retired, { recursive: true, force: true });
    try {
      await mkdir(lock);
    } catch {
      throw new Error(lockMessage);
    }
  }
  const owner: LockOwner = {
    version: 1,
    token: randomUUID(),
    pid: process.pid,
    children: [],
    spawnPending: false,
  };
  async function save() {
    const temporary = join(lock, `${ownerFile}.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
    await rename(temporary, join(lock, ownerFile));
  }
  try {
    await save();
  } catch (error) {
    await rm(lock, { recursive: true, force: true });
    throw error;
  }
  return {
    async beforeSpawn() {
      owner.spawnPending = true;
      await save();
    },
    async spawned(pid: number | undefined) {
      // 未取得 PID 的启动窗口不能声明可自动恢复；正常 finally 仍会释放本次锁。
      if (!isPid(pid)) return;
      owner.children.push(pid);
      owner.spawnPending = false;
      await save();
    },
    async release() {
      if ((await readOwner(lock))?.token === owner.token)
        await rm(lock, { recursive: true, force: true });
    },
  };
}

export type NativeProcessLock = Awaited<ReturnType<typeof acquireNativeProcessLock>>;
