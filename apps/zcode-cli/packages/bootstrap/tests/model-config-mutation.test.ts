import { describe, expect, it } from "vitest";
import type { ZCodeApp } from "../src/app/types.js";
import { runSessionModelConfigMutation } from "../src/zcode-protocol-v4/model-config-mutation.js";
import {
  ApiKeyAccessConfig,
  CodexChatGPTAccessConfig,
  ModelConfig,
  ModelConfigRules,
  ProviderApiConfig,
  ProviderConfig,
  ProviderConfigMap,
  ProviderConfigService,
  ProviderConfigResolver,
  parseProviderConfig,
  resolveInitialModelSelection,
  serializeRegistryProviderConfig,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
} from "@zcode/provider";
import { NodePersonalProviderConfigRepository } from "@zcode/provider-node";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("session model config mutation coordinator", () => {
  it("serializes registry fallback and explicit model mutations by session App identity", async () => {
    const app = {} as ZCodeApp;
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runSessionModelConfigMutation(app, async () => {
      order.push("fallback:start");
      await firstBlocked;
      order.push("fallback:end");
    });
    const second = runSessionModelConfigMutation(app, async () => {
      order.push("explicit:start");
      order.push("explicit:end");
    });

    await new Promise<void>((resolve) => {
      queueMicrotask(() => queueMicrotask(resolve));
    });
    expect(order).toEqual(["fallback:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["fallback:start", "fallback:end", "explicit:start", "explicit:end"]);
  });

  it("does not poison later model mutations when one operation fails", async () => {
    const app = {} as ZCodeApp;
    const failed = runSessionModelConfigMutation(app, async () => {
      throw new Error("expected failure");
    });
    const recovered = runSessionModelConfigMutation(app, async () => "recovered");

    await expect(failed).rejects.toThrow("expected failure");
    await expect(recovered).resolves.toBe("recovered");
  });
});

describe("protected Codex subscription provider configuration", () => {
  const providerId = "chatgpt-subscription";
  const model = {
    modelId: "official-model",
    supportedReasoningEfforts: ["low", "high"],
    inputModalities: ["text", "image"],
  };
  function setup() {
    let current: ProviderConfigLayerSnapshot = {
      revision: "0",
      providers: ProviderConfigMap.empty(),
      models: ModelConfigRules.empty(),
    };
    const builtin = {
      revision: "builtin",
      providers: ProviderConfigMap.empty(),
      models: ModelConfigRules.empty(),
    };
    const service = new ProviderConfigService({
      zcodeBuiltinSource: { read: async () => builtin, onDidChange: () => () => {} },
      personalRepository: {
        read: async () => current,
        onDidChange: () => () => {},
        update: async (transform) => {
          current = { ...transform(current), revision: String(Number(current.revision) + 1) };
          return current;
        },
      },
    });
    return { service, current: () => current };
  }

  it("roundtrips credential-free authentication and publishes complete official catalog", async () => {
    const { service, current } = setup();
    await service.publishCodexSubscriptionCatalog([model]);
    const provider = current().providers.get(providerId)!;
    expect(provider.access?.type).toBe("codex-chatgpt");
    expect(provider.validateComplete()).toEqual([]);
    expect(parseProviderConfig(provider.toJSON()).access).toBeInstanceOf(CodexChatGPTAccessConfig);
    expect(provider.toJSON().access).toEqual({ type: "codex-chatgpt" });
    const resolved = new ProviderConfigResolver().resolve({
      zcodeBuiltinProviders: ProviderConfigMap.empty(),
      personalProviders: current().providers,
      zcodeBuiltinModelRules: ModelConfigRules.empty(),
      personalModels: current().models,
      accountProviders: ProviderConfigMap.empty(),
    });
    expect(
      resolved.registryProviders[0]?.models[0]?.config.optionSpecs.reasoningLevel.values,
    ).toEqual(["low", "high"]);
    expect(resolved.registryProviders[0]?.config.access.type).toBe("codex-chatgpt");
    expect(serializeRegistryProviderConfig(resolved.registryProviders[0]!.config).access).toEqual({
      type: "codex-chatgpt",
    });
    const registry = { revision: 1, providers: resolved.registryProviders };
    expect(resolveInitialModelSelection({ registry })).toEqual({ source: "none" });
    const selected = { providerId, modelId: model.modelId, options: { reasoningLevel: "high" } };
    expect(resolveInitialModelSelection({ registry, configuredDefault: selected })).toEqual({
      source: "configured-default",
      selection: selected,
    });
    service.dispose();
  });

  it("rejects old Web provider and official model definition edits without mutation", async () => {
    const { service, current } = setup();
    await service.publishCodexSubscriptionCatalog([model]);
    const before = current();
    const calls = [
      () =>
        service.savePersonalProviderOverlay(
          providerId,
          new ProviderConfig({ access: new ApiKeyAccessConfig({ apiKey: "fixture" }) }),
        ),
      () =>
        service.savePersonalProviderOverlay(
          providerId,
          new ProviderConfig({
            api: new ProviderApiConfig({
              type: "openai-responses",
              baseUrl: "https://example.com",
            }),
          }),
        ),
      () => service.addPersonalModel(providerId, "made-up-model", new ModelConfig({})),
      () => service.renamePersonalModel(providerId, model.modelId, "made-up-model"),
      () =>
        service.savePersonalModelDraft(
          providerId,
          model.modelId,
          model.modelId,
          new ModelConfig({}),
          before.revision,
        ),
      () => service.deletePersonalModel(providerId, model.modelId),
      () => service.deletePersonalProvider(providerId),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow("ChatGPT");
    expect(current()).toBe(before);
    service.dispose();
  });

  it("protects subscription identity during import and rejects spoofed providers", async () => {
    const { service, current } = setup();
    await service.publishCodexSubscriptionCatalog([model]);
    const before = current();
    const replacement: ProviderConfigLayerUpdate = {
      providers: ProviderConfigMap.empty(),
      models: ModelConfigRules.empty(),
    };
    await service.replacePersonalConfig(replacement);
    expect(current().providers.get(providerId)?.toJSON()).toEqual(
      before.providers.get(providerId)?.toJSON(),
    );
    expect(current().models.getExact(providerId, model.modelId)?.toJSON()).toEqual(
      before.models.getExact(providerId, model.modelId)?.toJSON(),
    );
    const preserved = current();
    await expect(
      service.replacePersonalConfig({
        ...replacement,
        providers: replacement.providers.set(
          providerId,
          new ProviderConfig({ access: new ApiKeyAccessConfig({ apiKey: "fixture" }) }),
        ),
      }),
    ).rejects.toThrow("ChatGPT");
    await expect(
      service.createPersonalProvider({
        initialConfig: new ProviderConfig({ access: new CodexChatGPTAccessConfig() }),
      }),
    ).rejects.toThrow("ChatGPT");
    expect(current()).toBe(preserved);
    service.dispose();
  });

  it("preserves hidden preferences on refresh and removes stale official models", async () => {
    const { service, current } = setup();
    await service.publishCodexSubscriptionCatalog([model]);
    await service.setPersonalModelEnabled(providerId, model.modelId, false);
    await service.publishCodexSubscriptionCatalog([model]);
    expect(current().models.getExact(providerId, model.modelId)?.enabled).toBe(false);
    await service.publishCodexSubscriptionCatalog([]);
    expect(current().providers.get(providerId)?.personalModelIds).toEqual([]);
    expect(current().models.getExact(providerId, model.modelId)).toBeUndefined();
    expect(current().providers.get(providerId)?.access?.type).toBe("codex-chatgpt");
    service.dispose();
  });

  it("validates catalog identity and reasoning data before publishing", async () => {
    const { service, current } = setup();
    const before = current();
    await expect(
      service.publishCodexSubscriptionCatalog([{ ...model, modelId: "" }]),
    ).rejects.toThrow();
    await expect(
      service.publishCodexSubscriptionCatalog([
        { ...model, supportedReasoningEfforts: ["invalid effort"] },
      ]),
    ).rejects.toThrow();
    await expect(
      service.publishCodexSubscriptionCatalog([
        { ...model, defaultReasoningEffort: "not-in-catalog" },
      ]),
    ).rejects.toThrow();
    await expect(service.publishCodexSubscriptionCatalog([model, model])).rejects.toThrow();
    expect(current()).toBe(before);
    service.dispose();
  });

  it("preserves official extended reasoning efforts including max and ultra", async () => {
    const { service, current } = setup();
    const efforts = ["low", "medium", "high", "xhigh", "max", "ultra"];
    await service.publishCodexSubscriptionCatalog([
      { ...model, supportedReasoningEfforts: efforts, defaultReasoningEffort: "ultra" },
    ]);
    const config = current().models.getExact(providerId, model.modelId)!;
    expect(config.optionSpecs?.reasoningLevel?.values).toEqual(efforts);
    expect(config.validateComplete()).toEqual([]);
    service.dispose();
  });

  it("roundtrips on disk and protects direct provisioning writes while allowing preferences", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-subscription-provider-"));
    const repository = new NodePersonalProviderConfigRepository({
      filePath: join(directory, "providers.json"),
      pollingIntervalMs: false,
    });
    const service = new ProviderConfigService({
      zcodeBuiltinSource: {
        read: async () => ({
          revision: "builtin",
          providers: ProviderConfigMap.empty(),
          models: ModelConfigRules.empty(),
        }),
        onDidChange: () => () => {},
      },
      personalRepository: repository,
    });
    try {
      let publications = 0;
      repository.onDidChange(() => {
        publications++;
      });
      await service.publishCodexSubscriptionCatalog([
        model,
        { ...model, modelId: "second-official" },
      ]);
      const before = await repository.read();
      await service.publishCodexSubscriptionCatalog([
        model,
        { ...model, modelId: "second-official" },
      ]);
      expect(publications).toBe(1);
      expect((await repository.read()).revision).toBe(before.revision);
      await expect(
        repository.update((current) => ({
          ...current,
          providers: current.providers.set(
            providerId,
            new ProviderConfig({ access: new ApiKeyAccessConfig({ apiKey: "fixture" }) }),
          ),
        })),
      ).rejects.toThrow("ChatGPT");
      await expect(
        repository.update((current) => ({
          ...current,
          models: current.models.setExact(
            providerId,
            model.modelId,
            new ModelConfig({ properties: undefined }),
          ),
        })),
      ).rejects.toThrow("ChatGPT");
      expect((await repository.read()).revision).toBe(before.revision);
      await service.reorderPersonalModels(providerId, ["second-official", model.modelId]);
      await service.setPersonalModelEnabled(providerId, model.modelId, false);
      const preferences = await repository.read();
      expect(preferences.providers.get(providerId)?.modelOrder).toEqual([
        "second-official",
        model.modelId,
      ]);
      expect(preferences.models.getExact(providerId, model.modelId)?.enabled).toBe(false);
      await repository.update(() => ({
        providers: ProviderConfigMap.empty(),
        models: ModelConfigRules.empty(),
      }));
      const preserved = await repository.read();
      expect(preserved.providers.get(providerId)?.access?.toJSON()).toEqual({
        type: "codex-chatgpt",
      });
      expect(preserved.models.getExact(providerId, model.modelId)?.enabled).toBe(false);
    } finally {
      service.dispose();
      repository.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
