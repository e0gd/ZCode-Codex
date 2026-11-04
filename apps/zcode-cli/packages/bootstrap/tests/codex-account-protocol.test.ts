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
    { action: "login", loginMethod: "password" },
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

  it("roundtrips browser login and a device failure category through the same account boundary", async () => {
    const authorizationUrl = `https://auth.openai.com/oauth/authorize?response_type=code&state=fixture-state&code_challenge=${"a".repeat(43)}&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback`;
    const pending = { status: "logging-in" as const, models: [], login: { type: "browser" as const, loginId: "browser-login", authorizationUrl } };
    const codexAccount = vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce({ status: "error", models: [], errorCode: "device-auth-unavailable" });
    const createZCodeApp = vi.fn(() => { throw new Error("must not create a project"); });
    const server = new ZCodeProtocolAgentServer({ createZCodeApp, codexAccount });
    try {
      const result = await server.handleMessage({ id: 4, method: zcodeProtocolMethods.codexAccount, params: { action: "login", loginMethod: "browser" } });
      expect(result).toMatchObject({ result: pending });
      expect(codexAccount).toHaveBeenCalledWith({ action: "login", loginMethod: "browser" });
      const failed = await server.handleMessage({ id: 5, method: zcodeProtocolMethods.codexAccount, params: { action: "login", loginMethod: "device-code" } });
      expect(failed).toMatchObject({ result: { errorCode: "device-auth-unavailable" } });
      expect(createZCodeApp).not.toHaveBeenCalled();
    } finally { await server.shutdown(); server.disposeProjections(); }
  });

  it("fails explicitly when an older host has no account owner", async () => {
    const server = new ZCodeProtocolAgentServer({ createZCodeApp: () => { throw new Error("unused"); } });
    try {
      const response = await server.handleMessage({ id: 3, method: zcodeProtocolMethods.codexAccount, params: { action: "login" } });
      expect(response).toMatchObject({ error: { message: expect.stringContaining("unavailable") } });
    } finally { await server.shutdown(); server.disposeProjections(); }
  });
});
