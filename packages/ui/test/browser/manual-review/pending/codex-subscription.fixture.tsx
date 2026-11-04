import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { IServiceAccessor } from "@zcode/services";
import type { ProjectTree, ModelSelectionView } from "@zcode/services";
import type { IPlatformService } from "@zcode/shared";
import { ServiceProvider } from "@/hooks/useServices.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { CodexSubscriptionCard } from "@/codex-subscription/index.js";
import { resolveProjectExecutionEngine } from "@/project-sidebar/index.js";
import {
  buildRegistryModelSelectGroups,
  filterModelSelectionForExecutionEngine,
} from "@/lib/modelSelectionGroups.js";
import { ModelConfigSelect } from "@/ModelConfigSelect.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import "@/styles.css";

const params = new URLSearchParams(location.search);
let pathAttempts = 0;
document.documentElement.className =
  params.get("theme") === "light" ? "light theme-zai-light" : "dark theme-zai-dark";
const services = {
  zcodeTaskService: {
    codexAccount: async (input: unknown) => {
      const response = await fetch("/account", { method: "POST", body: JSON.stringify(input) });
      if (!response.ok) throw new Error("fixture failure with sensitive raw text");
      return response.json();
    },
  },
  fileService: {
    ensureConversationWorkspace: async () => {
      if (params.has("pathFailure") && pathAttempts++ === 0)
        throw new Error("workspace unavailable");
      return { path: "fixture-conversation" };
    },
  },
} as unknown as IServiceAccessor;
const secondServices = {
  zcodeTaskService: {
    codexAccount: async (input: unknown) => {
      const response = await fetch("/second-account", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return response.json();
    },
  },
  fileService: { ensureConversationWorkspace: async () => ({ path: "second-conversation" }) },
} as unknown as IServiceAccessor;

function Fixture() {
  const [visible, setVisible] = useState(true);
  const [opened, setOpened] = useState("");
  const [switched, setSwitched] = useState(false);
  return (
    <PlatformProvider platform={{ openExternal: setOpened } as unknown as IPlatformService}>
      <main className="min-h-screen bg-background p-4 text-foreground">
        <button data-testid="unmount" onClick={() => setVisible(false)}>
          Unmount
        </button>
        <button data-testid="switch-owner" onClick={() => setSwitched(true)}>
          Switch owner
        </button>
        <ServiceProvider services={switched ? secondServices : services}>
          {visible ? <CodexSubscriptionCard workspacePath="" /> : null}
        </ServiceProvider>
        <output data-testid="opened">{opened}</output>
      </main>
    </PlatformProvider>
  );
}
function EngineFilterFixture() {
  const [selected, setSelected] = useState("");
  const target = params.get("target");
  const tree = {
    projects: [
      { id: "zcode", hostId: "local", executionEngine: "zcode", roots: [{ rootPath: "same-cwd" }] },
      { id: "codex", hostId: "local", executionEngine: "codex", roots: [{ rootPath: "same-cwd" }] },
      {
        id: "codex",
        hostId: "other-host",
        executionEngine: "zcode",
        roots: [{ rootPath: "same-cwd" }],
      },
      { id: "legacy", hostId: "local", roots: [{ rootPath: "same-cwd" }] },
    ],
    tasks: [
      { taskId: "zcode-task", hostId: "local", projectId: "zcode", workspacePath: "same-cwd" },
      { taskId: "codex-task", hostId: "local", projectId: "codex", workspacePath: "same-cwd" },
      {
        taskId: "codex-task",
        hostId: "other-host",
        projectId: "codex",
        workspacePath: "same-cwd",
        workspaceIdentity: "other-identity",
      },
    ],
  } as unknown as ProjectTree;
  const hostId = target === "other-host" ? "other-host" : "local";
  const engine = resolveProjectExecutionEngine(target === "no-owner" ? null : tree, {
    hostId,
    ...(target?.endsWith("-task") || target === "other-host" || target === "unknown-task"
      ? {
          task: {
            taskId: target === "other-host" ? "codex-task" : target,
            workspacePath: "same-cwd",
            ...(target === "other-host" ? { workspaceIdentity: "other-identity" } : {}),
          },
        }
      : { projectId: target }),
  });
  const view = {
    revision: 1,
    preferredSelection: {
      providerId: "chatgpt-subscription",
      modelId: "official-model",
      options: { reasoningLevel: "high" },
    },
    providers: [
      {
        providerId: "chatgpt-subscription",
        providerName: "ChatGPT subscription (Codex)",
        config: {
          access: { type: "codex-chatgpt" },
          api: { type: "openai-responses", baseUrl: "https://example.test" },
        },
        models: [{ modelId: "official-model", config: {} }],
      },
      {
        providerId: "fixture-api",
        providerName: "API provider",
        config: {
          access: { type: "api-key", apiKey: "fixture" },
          api: { type: "openai-responses", baseUrl: "https://example.test" },
        },
        models: [{ modelId: "api-model", config: {} }],
      },
    ],
  } as unknown as ModelSelectionView;
  const filtered = filterModelSelectionForExecutionEngine(view, engine);
  const groups = buildRegistryModelSelectGroups("glm", filtered, {}, engine);
  return (
    <main className="min-h-screen bg-background p-4 text-foreground">
      <output data-testid="engine">{engine ?? "unknown"}</output>
      <output data-testid="preferred">{filtered.preferredSelection?.providerId ?? "none"}</output>
      <output data-testid="groups">{groups.map((group) => group.label).join("|")}</output>
      <output data-testid="selected">{selected}</output>
      <TooltipProvider>
        <ModelConfigSelect
          modelGroups={groups}
          normalizedValue={selected}
          triggerLabel="Choose model"
          showManageModelsAction={false}
          lockReasonMessage=""
          isItemLocked={() => false}
          onValueChange={setSelected}
        />
      </TooltipProvider>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <ServiceProvider services={services}>
    <ZCodeIntlProvider initialLocale={params.get("locale") === "zh-CN" ? "zh-CN" : "en-US"}>
      {params.has("filter") ? <EngineFilterFixture /> : <Fixture />}
    </ZCodeIntlProvider>
  </ServiceProvider>,
);
