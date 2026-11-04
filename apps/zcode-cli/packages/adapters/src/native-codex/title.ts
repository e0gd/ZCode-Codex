import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { NativeCodexModelResolver, NativeTurnExecutor } from "@zcode/contracts";
import { CodexConnection, identifier, record } from "./connection.js";
import {
  nativeSubscriptionArguments,
  nativeSubscriptionEnvironment,
  readNativeSubscriptionCatalog,
} from "./account.js";

export interface NativeCodexTitleOptions {
  workspacePath: string;
  binaryPath: string;
  codexHome: string;
  stateDirectory?: string;
  model?: string;
  resolveModel?: NativeCodexModelResolver;
  provider?: string;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const pathKey = (value: string) =>
  process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
const abortError = () =>
  Object.assign(new Error("Native Codex title sampling was cancelled."), { name: "AbortError" });
const nativeTitleTimeoutMs = 60_000;
const nativeTitleMaximumTextCharacters = 16_000;

export async function generateNativeCodexTitle(
  options: NativeCodexTitleOptions,
  input: Parameters<NonNullable<NativeTurnExecutor["generateTitle"]>>[0],
): Promise<{ text: string | null }> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(nativeTitleTimeoutMs)]);
  signal.throwIfAborted();
  const workspace = await realpath(options.workspacePath);
  if (pathKey(workspace) !== pathKey(options.workspacePath))
    throw new Error("Native Codex workspace must use its exact canonical path.");
  const home = await realpath(options.codexHome);
  const state = await realpath(resolve(options.stateDirectory ?? join(home, "zcode-native")));
  const inside = relative(workspace, state);
  if (!inside || (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside)))
    throw new Error("Native Codex state must be outside the project workspace.");
  const directory = join(state, hash(pathKey(workspace)), hash(input.sessionId));
  signal.throwIfAborted();
  const lock = join(directory, "active.lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("This native session is active; title sampling was skipped.");
    throw error;
  }
  try {
    const saved = record(JSON.parse(await readFile(join(directory, "thread.json"), "utf8")));
    if (
      saved.version !== 1 ||
      saved.workspace !== pathKey(workspace) ||
      saved.sessionId !== input.sessionId ||
      saved.threadId !== input.threadId
    )
      throw new Error("Native Codex title mapping does not match this session.");
    identifier(input.threadId);
    identifier(input.turnId);
    const resolved = input.modelSelection
      ? await options.resolveModel?.(input.modelSelection)
      : undefined;
    if (input.modelSelection && !resolved)
      throw new Error("Native Codex model selection resolver is unavailable.");
    const subscription = resolved?.authMode === "chatgpt";
    if (saved.authMode !== undefined && saved.authMode !== (subscription ? "chatgpt" : "apiKey"))
      throw new Error("Native Codex title authentication source does not match the original turn.");
    const apiModel = resolved?.authMode !== "chatgpt" ? resolved : undefined;
    const model = resolved?.modelId ?? options.model ?? "gpt-6.1-sol";
    const provider = subscription
      ? "openai"
      : resolved
        ? "zcode_api"
        : (options.provider ?? "zcode_api");
    const baseUrl = subscription ? undefined : (apiModel?.baseUrl ?? options.baseUrl);
    if (baseUrl) {
      const url = new URL(baseUrl);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error("Native Codex base URL must not contain credentials or query parameters.");
    }
    if (!/^[A-Za-z0-9_-]+$/.test(provider))
      throw new Error("Invalid native Codex provider identifier.");
    let connection: CodexConnection | undefined;
    const onAbort = () => connection?.close(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    const connect = async (activeProvider: string) => {
      signal.throwIfAborted();
      connection = new CodexConnection({
        binaryPath: options.binaryPath,
        cwd: workspace,
        args: [
          "app-server",
          "--stdio",
          "-c",
          `model=${JSON.stringify(model)}`,
          "-c",
          `model_provider=${JSON.stringify(activeProvider)}`,
          ...(subscription
            ? nativeSubscriptionArguments()
            : [...new Set([provider, activeProvider, "zcode_api", "zcode_selected"])].flatMap(
                (alias) => [
                  ...(baseUrl
                    ? ["-c", `model_providers.${alias}.base_url=${JSON.stringify(baseUrl)}`]
                    : []),
                  ...(apiModel
                    ? [
                        "-c",
                        `model_providers.${alias}.name="ZCode selected provider"`,
                        "-c",
                        `model_providers.${alias}.wire_api="responses"`,
                        "-c",
                        `model_providers.${alias}.requires_openai_auth=false`,
                        "-c",
                        `model_providers.${alias}.supports_websockets=false`,
                      ]
                    : []),
                  "-c",
                  `model_providers.${alias}.env_key="CODEX_ZCODE_API_KEY"`,
                ],
              )),
          "-c",
          'shell_environment_policy.exclude=["CODEX_ZCODE_API_KEY"]',
        ],
        env: subscription
          ? nativeSubscriptionEnvironment(options.env ?? process.env, home)
          : {
              ...(options.env ?? process.env),
              CODEX_HOME: home,
              ...(apiModel ? { CODEX_ZCODE_API_KEY: apiModel.apiKey } : {}),
            },
        onFailure() {},
        onMessage: (message) => {
          // sample 是无工具执行的辅助请求；不把任何服务端请求转交主会话审批或工具链。
          if (message.id !== undefined)
            connection?.close(
              new Error("Native Codex title sampling cannot execute tools or request input."),
            );
        },
      });
      await connection.request("initialize", {
        clientInfo: {
          name: "zcode_native_codex_title",
          title: "ZCode Native Codex Title",
          version: "1.0.0",
        },
        capabilities: { experimentalApi: true },
      });
      connection.send({ method: "initialized", params: {} });
    };
    try {
      await connect(provider);
      let lowEffortSupported = false;
      if (subscription) {
        const account = record(await connection!.request("account/read", { refreshToken: false }));
        if (record(account.account).type !== "chatgpt")
          throw new Error("Sign in to ChatGPT subscription before generating a Codex title.");
        const selected = (await readNativeSubscriptionCatalog(connection!)).find(
          (item) => item.model === model,
        );
        if (
          !selected ||
          (resolved?.reasoningEffort !== undefined &&
            !selected.supportedReasoningEfforts.some(
              (item) => item.reasoningEffort === resolved.reasoningEffort,
            ))
        )
          throw new Error(
            "The original subscription model is unavailable for Codex title generation.",
          );
        lowEffortSupported = selected.supportedReasoningEfforts.some(
          (item) => item.reasoningEffort === "low",
        );
      }
      const thread = record(
        record(
          await connection!.request("thread/read", {
            threadId: input.threadId,
            includeTurns: false,
          }),
        ).thread,
      );
      if (
        thread.id !== input.threadId ||
        thread.cwd !== workspace ||
        typeof thread.modelProvider !== "string" ||
        !/^[A-Za-z0-9_-]+$/.test(thread.modelProvider) ||
        subscription !== (thread.modelProvider === "openai")
      )
        throw new Error("Native Codex title source metadata does not match this session.");
      if (thread.modelProvider !== provider) {
        connection!.close();
        await connect(thread.modelProvider);
      }
      const resumed = record(
        await connection!.request("thread/resume", {
          threadId: input.threadId,
          cwd: workspace,
          model,
          modelProvider: thread.modelProvider,
          excludeTurns: true,
        }),
      );
      if (record(resumed.thread).id !== input.threadId)
        throw new Error("Codex resumed a different title source.");
      signal.throwIfAborted();
      // 已完成源轮的独立采样不会追加用户输入/turn，也不会执行工具；过期源由官方拒绝。
      const sampled = record(
        await connection!.request("thread/sample", {
          threadId: input.threadId,
          expectedTurnId: input.turnId,
          prompt: input.prompt,
          disableMcp: true,
          ...(lowEffortSupported ? { effort: "low" } : {}),
        }),
      );
      signal.throwIfAborted();
      if (
        sampled.sourceTurnId !== input.turnId ||
        (sampled.text !== null &&
          (typeof sampled.text !== "string" ||
            sampled.text.length > nativeTitleMaximumTextCharacters))
      )
        throw new Error("Codex returned an invalid title sample.");
      return { text: sampled.text as string | null };
    } finally {
      signal.removeEventListener("abort", onAbort);
      connection?.close();
    }
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
