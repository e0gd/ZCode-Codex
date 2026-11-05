import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireNativeProcessLock } from "../src/native-codex/process-lock.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "native-lock-"));
  roots.push(directory);
  const ownerPath = join(directory, "active.lock", "owner.json");
  return { directory, ownerPath };
}
function deadPid(): number {
  const result = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
    encoding: "utf8",
    windowsHide: true,
  });
  expect(result.status).toBe(0);
  return Number(result.stdout);
}
async function replaceOwner(path: string, patch: object) {
  const owner = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...owner, ...patch }));
}

describe("native process lock crash reconciliation", () => {
  it("rejects another executor while its owner is alive and releases normally", async () => {
    const { directory } = await fixture();
    const lock = await acquireNativeProcessLock(directory);
    await expect(acquireNativeProcessLock(directory)).rejects.toThrow("already active");
    await lock.release();
    await (await acquireNativeProcessLock(directory)).release();
  });

  it.each(["empty", "corrupt", "pending-spawn", "live-child"])(
    "preserves %s locks despite a dead owner",
    async (kind) => {
      const { directory, ownerPath } = await fixture();
      if (kind === "empty" || kind === "corrupt") {
        await mkdir(join(directory, "active.lock"));
        if (kind === "corrupt") await writeFile(ownerPath, "broken");
      } else {
        await acquireNativeProcessLock(directory);
        await replaceOwner(ownerPath, {
          pid: deadPid(),
          spawnPending: kind === "pending-spawn",
          children: kind === "live-child" ? [process.pid] : [],
        });
      }
      await expect(acquireNativeProcessLock(directory)).rejects.toThrow("unreconciled");
    },
  );

  it("recovers only proven-dead owner and child with exactly one competing winner", async () => {
    const { directory, ownerPath } = await fixture();
    await acquireNativeProcessLock(directory);
    const pid = deadPid();
    await replaceOwner(ownerPath, { pid, children: [pid] });
    const attempts = await Promise.allSettled([
      acquireNativeProcessLock(directory),
      acquireNativeProcessLock(directory),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    for (const attempt of attempts)
      if (attempt.status === "fulfilled") await attempt.value.release();
  });

  it("does not remove another owner's replacement during release", async () => {
    const { directory, ownerPath } = await fixture();
    const lock = await acquireNativeProcessLock(directory);
    await replaceOwner(ownerPath, { token: "replacement-owner" });
    await lock.release();
    expect(JSON.parse(await readFile(ownerPath, "utf8")).token).toBe("replacement-owner");
  });

  it("marks spawning uncertain until a real child PID is recorded", async () => {
    const { directory, ownerPath } = await fixture();
    const lock = await acquireNativeProcessLock(directory);
    await lock.beforeSpawn();
    await lock.spawned(undefined);
    expect(JSON.parse(await readFile(ownerPath, "utf8")).spawnPending).toBe(true);
    await lock.spawned(process.pid);
    expect(JSON.parse(await readFile(ownerPath, "utf8"))).toMatchObject({
      spawnPending: false,
      children: [process.pid],
    });
    await lock.release();
  });
});
