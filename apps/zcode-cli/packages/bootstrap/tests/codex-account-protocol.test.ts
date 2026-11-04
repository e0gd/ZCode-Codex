import { describe, expect, it, vi } from "vitest";
import { codexAccountStateSchema, zcodeProtocolMethods } from "@zcode/shared";
import { ZCodeProtocolAgentServer } from "../src/zcode-protocol/server.js";

describe("Codex subscription control boundary", () => {
  it("routes safe commands without constructing a project/session runtime", async () => {
    const createZCodeApp = vi.fn(() => { throw new Error("must not create a project"); });
    const codexAccount = vi.fn(async () => ({ status: "signed-out" as const, models: [] }));
    const server = new ZCodeProtocolAgentServer({ createZCodeApp, codexAccount });
    try {
      const response = await server.handleMessage({ id: 1, method: zcodeProtocolMethods.codexAccount, params: { action: "read" } });
      expect(response).toMatchObject({ id: 1, result: { status: "signed-out", models: [] } });
      expect(codexAccount).toHaveBeenCalledWith({ action: "read" });
      expect(createZCodeApp).not.toHaveBeenCalled();
    } finally { await server.shutdown(); server.disposeProjections(); }
  });

  it.each([
    { action: "login", apiKey: "forbidden" },
    { action: "login", baseUrl: "https://unexpected.example" },
    { action: "cancel", loginId: "" },
    { action: "unknown" },
  ])("rejects invalid or credential-bearing control input %j", async params => {
    const codexAccount = vi.fn(async () => ({ status: "signed-out" as const, models: [] }));
    const server = new ZCodeProtocolAgentServer({ createZCodeApp: () => { throw new Error("unused"); }, codexAccount });
    try {
      const response = await server.handleMessage({ id: 2, method: zcodeProtocolMethods.codexAccount, params });
      expect(response).toHaveProperty("error");
      expect(codexAccount).not.toHaveBeenCalled();
    } finally { await server.shutdown(); server.disposeProjections(); }
  });

  it("rejects credential-bearing responses at the shared projection boundary", () => {
    expect(codexAccountStateSchema.safeParse({ status: "signed-in", models: [], accessToken: "forbidden" }).success).toBe(false);
    expect(codexAccountStateSchema.safeParse({ status: "signed-in", models: [], account: { email: "account@example.test", planType: "plus", refreshToken: "forbidden" } }).success).toBe(false);
  });

  it("fails explicitly when an older host has no account owner", async () => {
    const server = new ZCodeProtocolAgentServer({ createZCodeApp: () => { throw new Error("unused"); } });
    try {
      const response = await server.handleMessage({ id: 3, method: zcodeProtocolMethods.codexAccount, params: { action: "login" } });
      expect(response).toMatchObject({ error: { message: expect.stringContaining("unavailable") } });
    } finally { await server.shutdown(); server.disposeProjections(); }
  });
});
