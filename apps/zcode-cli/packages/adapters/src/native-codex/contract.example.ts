import type { NativeCodexAccountPort } from "./contract.js";

/** Reading account state must not start a login or execute a model. */
export async function observeCodexAccount(account: NativeCodexAccountPort): Promise<string> {
  const state = await account.command({ action: "read" });
  return state.status;
}
