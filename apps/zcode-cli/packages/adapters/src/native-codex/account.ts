import { mkdir } from "node:fs/promises";
import type { CodexAccountCommand, CodexAccountState, CodexSubscriptionModel } from "@zcode/shared";
import { codexBrowserAuthorizationUrlSchema } from "@zcode/shared";
import { CodexConnection, record, type RpcMessage } from "./connection.js";

const loginTimeoutMs = 10 * 60 * 1000;
const maxCatalogPages = 10;
const maxCatalogModels = 500;
const maxReasoningEfforts = 32;
const unsafeEnvironmentNames = new Set(["CODEX_HOME", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_BASE", "OPENAI_ORGANIZATION", "OPENAI_ORG_ID", "CODEX_ZCODE_API_KEY", "CODEX_API_KEY", "CODEX_AUTH_TOKEN", "CHATGPT_ACCESS_TOKEN", "CHATGPT_BASE_URL", "CODEX_CHATGPT_BASE_URL"]);
const accountFailureMessage = "ChatGPT subscription authentication is unavailable. Check the official Codex installation or sign in again.";
class DeviceAuthorizationUnavailable extends Error {}

/** The managed official account must never inherit an API provider's credentials or endpoint. */
export function nativeSubscriptionEnvironment(env: NodeJS.ProcessEnv, codexHome: string): NodeJS.ProcessEnv {
  return { ...Object.fromEntries(Object.entries(env).filter(([name]) => !unsafeEnvironmentNames.has(name.toUpperCase()))), CODEX_HOME: codexHome };
}

/** Official 0.166 reserves openai and rejects provider-table overrides; use the built-in identity. */
export function nativeSubscriptionArguments(): string[] {
  return ["-c", 'model_provider="openai"', "-c", 'forced_login_method="chatgpt"', "-c", 'cli_auth_credentials_store="file"',
    "-c", 'chatgpt_base_url="https://chatgpt.com/backend-api/"'];
}

function boundedString(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > maximum || /[\p{Cc}]/u.test(value)) throw new Error(accountFailureMessage);
  return value;
}

function safeVerificationUrl(value: unknown): string {
  const raw = boundedString(value, 1024);
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "auth.openai.com" || url.port || url.username || url.password || url.search || url.hash || !["/codex/device", "/codex/device/"].includes(url.pathname)) throw new Error(accountFailureMessage);
  return url.href;
}

function parseModel(value: unknown): CodexSubscriptionModel {
  const model = record(value);
  if (!Array.isArray(model.supportedReasoningEfforts) || !model.supportedReasoningEfforts.length || model.supportedReasoningEfforts.length > maxReasoningEfforts || !Array.isArray(model.inputModalities)) throw new Error(accountFailureMessage);
  const efforts = model.supportedReasoningEfforts.map(value => {
    const item = record(value);
    const reasoningEffort = boundedString(item.reasoningEffort, 32);
    if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(reasoningEffort)) throw new Error(accountFailureMessage);
    return { reasoningEffort, description: boundedString(item.description, 2048, true) };
  });
  const defaultReasoningEffort = boundedString(model.defaultReasoningEffort, 32);
  if (!efforts.some(item => item.reasoningEffort === defaultReasoningEffort) || new Set(efforts.map(item => item.reasoningEffort)).size !== efforts.length) throw new Error(accountFailureMessage);
  const inputModalities = model.inputModalities.map(value => boundedString(value, 32));
  if (!inputModalities.length || inputModalities.length > 8 || inputModalities.some(value => !["text", "image", "audio"].includes(value))) throw new Error(accountFailureMessage);
  return { id: boundedString(model.id, 256), model: boundedString(model.model, 256), displayName: boundedString(model.displayName, 256), supportedReasoningEfforts: efforts, defaultReasoningEffort, inputModalities };
}

/** Discovery is bounded and validated; a listed model can still be denied by the server at execution. */
export async function readNativeSubscriptionCatalog(connection: CodexConnection): Promise<CodexSubscriptionModel[]> {
  const models: CodexSubscriptionModel[] = [];
  const identifiers = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < maxCatalogPages; page++) {
    const response = record(await connection.request("model/list", { includeHidden: false, limit: 100, ...(cursor ? { cursor } : {}) }));
    if (!Array.isArray(response.data)) throw new Error(accountFailureMessage);
    for (const value of response.data) {
      if (record(value).hidden === true) continue;
      const model = parseModel(value);
      if (identifiers.has(model.model) || models.length >= maxCatalogModels) throw new Error(accountFailureMessage);
      identifiers.add(model.model); models.push(model);
    }
    if (response.nextCursor === null) return models;
    cursor = boundedString(response.nextCursor, 2048);
    if (cursors.has(cursor)) throw new Error(accountFailureMessage);
    cursors.add(cursor);
  }
  throw new Error(accountFailureMessage);
}

export interface NativeCodexAccountOptions {
  codexHome: string;
  binaryPath: string;
  env?: NodeJS.ProcessEnv;
  onCatalog(models: CodexSubscriptionModel[]): Promise<void>;
}

/** One CLI-owned managed account connection; UI only reads safe snapshots and sends commands. */
export class NativeCodexAccountController {
  private connection?: CodexConnection;
  private state: CodexAccountState = { status: "signed-out", models: [] };
  private tail: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private generation = 0;
  private loginTimer?: ReturnType<typeof setTimeout>;
  private loginStarting = false;
  private readonly earlyCompletions = new Map<string, boolean>();

  constructor(private readonly options: NativeCodexAccountOptions) {}

  command(command: CodexAccountCommand): Promise<CodexAccountState> {
    return this.enqueue(async () => {
      // 轮询只观察已知失败；显式 refresh/login 才清除，避免错误提示一闪而过。
      if (command.action === "read" && this.state.status === "error") return;
      const connection = await this.connect();
      if (command.action === "login") {
        if (this.state.status === "logging-in") return;
        this.generation++; this.loginStarting = true;
        const browser = command.loginMethod === "browser";
        let response: Record<string, unknown>;
        try { response = record(await connection.request("account/login/start", { type: browser ? "chatgpt" : "chatgptDeviceCode" })); }
        catch (error) {
          // 本机设备码端点实测可返回 403；安装/发现正常也会失败，保留独立的安全分类。
          if (!browser) throw new DeviceAuthorizationUnavailable();
          throw error;
        }
        this.loginStarting = false;
        if (response.type !== (browser ? "chatgpt" : "chatgptDeviceCode")) throw new Error(accountFailureMessage);
        const loginId = boundedString(response.loginId, 512);
        let login: NonNullable<CodexAccountState["login"]>;
        if (browser) login = { type: "browser", loginId, authorizationUrl: codexBrowserAuthorizationUrlSchema.parse(response.authUrl) };
        else {
          const userCode = boundedString(response.userCode, 64);
          if (!/^[A-Za-z0-9][A-Za-z0-9 -]{3,63}$/u.test(userCode)) throw new Error(accountFailureMessage);
          login = { loginId, verificationUrl: safeVerificationUrl(response.verificationUrl), userCode };
        }
        this.state = { status: "logging-in", models: [], login };
        await this.options.onCatalog([]);
        const generation = this.generation;
        this.loginTimer = setTimeout(() => { void this.enqueue(async () => {
          // 超时工作也要在串行 owner 内核验代次，避免旧 timer 清掉已重开的登录。
          if (generation !== this.generation || this.state.login?.loginId !== loginId) return;
          await connection.request("account/login/cancel", { loginId }); throw new Error(accountFailureMessage);
        }); }, loginTimeoutMs);
        this.loginTimer.unref?.();
        if (this.earlyCompletions.has(loginId)) {
          const success = this.earlyCompletions.get(loginId)!; this.earlyCompletions.clear();
          await this.completeLogin(loginId, success);
        }
      } else if (command.action === "cancel") {
        if (!this.state.login || (command.loginId !== undefined && command.loginId !== this.state.login.loginId)) return;
        const loginId = this.state.login.loginId;
        this.invalidateLogin();
        await connection.request("account/login/cancel", { loginId });
        this.state = { status: "signed-out", models: [] }; await this.options.onCatalog([]);
      } else if (command.action === "logout") {
        const loginId = this.state.login?.loginId;
        this.invalidateLogin();
        if (loginId) await connection.request("account/login/cancel", { loginId });
        await connection.request("account/logout", {});
        this.state = { status: "signed-out", models: [] }; await this.options.onCatalog([]);
      } else if (this.state.status !== "logging-in") await this.readState(command.action === "refresh");
    });
  }

  dispose(): void {
    this.disposed = true; this.invalidateLogin();
    this.connection?.close(); this.connection = undefined;
  }

  private enqueue(operation: () => Promise<void>): Promise<CodexAccountState> {
    const result = this.tail.then(async () => {
      try {
        if (this.disposed) throw new Error(accountFailureMessage);
        await operation();
      } catch (error) {
        // 官方原始认证错误可能含 token/URL；边界只返回固定提示并撤销旧目录。
        this.invalidateLogin(); this.connection?.close(); this.connection = undefined;
        this.state = { status: "error", models: [], error: accountFailureMessage,
          ...(error instanceof DeviceAuthorizationUnavailable ? { errorCode: "device-auth-unavailable" as const } : {}) };
        try { await this.options.onCatalog([]); } catch { /* Catalog publication failure remains a visible account error. */ }
      }
      return structuredClone(this.state);
    });
    this.tail = result;
    return result;
  }

  private invalidateLogin(): void {
    this.generation++; this.loginStarting = false; this.earlyCompletions.clear();
    if (this.loginTimer) clearTimeout(this.loginTimer);
    this.loginTimer = undefined;
  }

  private async connect(): Promise<CodexConnection> {
    if (this.connection) return this.connection;
    await mkdir(this.options.codexHome, { recursive: true, mode: 0o700 });
    if (this.disposed) throw new Error(accountFailureMessage);
    const connection = new CodexConnection({ binaryPath: this.options.binaryPath,
      args: ["app-server", "--stdio", ...nativeSubscriptionArguments()], cwd: this.options.codexHome,
      env: nativeSubscriptionEnvironment(this.options.env ?? process.env, this.options.codexHome),
      onFailure: () => { if (!this.disposed) void this.enqueue(async () => { throw new Error(accountFailureMessage); }); },
      onMessage: message => this.notification(message),
    });
    this.connection = connection;
    await connection.request("initialize", { clientInfo: { name: "zcode_codex_account", title: "ZCode Codex Account", version: "1.0.0" }, capabilities: { experimentalApi: true } });
    connection.send({ method: "initialized", params: {} });
    return connection;
  }

  private notification(message: RpcMessage): void {
    if (this.disposed || message.method !== "account/login/completed") return;
    const params = message.params;
    if (typeof params.loginId !== "string" || typeof params.success !== "boolean") return;
    if (this.loginStarting && this.earlyCompletions.size < 8) this.earlyCompletions.set(params.loginId, params.success);
    const generation = this.generation;
    if (this.state.login?.loginId !== params.loginId) return;
    void this.enqueue(async () => { if (generation === this.generation) await this.completeLogin(params.loginId as string, params.success as boolean); });
  }

  private async completeLogin(loginId: string, success: boolean): Promise<void> {
    if (this.state.login?.loginId !== loginId) return;
    this.invalidateLogin();
    if (!success) throw new Error(accountFailureMessage);
    this.state = { status: "signed-out", models: [] };
    await this.readState(false);
    if (this.state.status !== "signed-in") throw new Error(accountFailureMessage);
  }

  private async readState(refresh: boolean): Promise<void> {
    const connection = await this.connect();
    const response = record(await connection.request("account/read", { refreshToken: refresh }));
    if (response.account === null) { this.state = { status: "signed-out", models: [] }; await this.options.onCatalog([]); return; }
    const account = record(response.account);
    if (account.type !== "chatgpt") throw new Error(accountFailureMessage);
    const email = account.email === null ? "" : boundedString(account.email, 512, true);
    const planType = boundedString(account.planType, 64);
    const oldAccount = this.state.account;
    const models = refresh || this.state.status !== "signed-in" || oldAccount?.email !== email || oldAccount?.planType !== planType ? await readNativeSubscriptionCatalog(connection) : this.state.models;
    await this.options.onCatalog(models);
    this.state = { status: "signed-in", account: { email, planType }, models };
  }
}
