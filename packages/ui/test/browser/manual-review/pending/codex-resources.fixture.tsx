import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CodexResourcesSettings } from "@/settingsPageHelpers.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { SETTINGS_SECTION_GROUPS } from "@/settings/settingsPageConfig.js";
import { resolveSettingsSection } from "@/lib/settingsNavigation.js";
import type { AppSettings } from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import { ServiceProvider } from "@/hooks/useServices.js";
import "@/styles.css";

const params = new URLSearchParams(location.search);
document.documentElement.className =
  params.get("theme") === "dark" ? "dark theme-zai-dark" : "light theme-zai-light";

function Fixture() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [workspace, setWorkspace] = useState("/fixture/one");
  const services = useMemo(
    () =>
      ({
        mcpSyncService: {
          async listCodexMcpSyncCandidates({ workspacePath }: { workspacePath: string }) {
            const response = await fetch(
              `/codex-mcp-candidates?workspace=${encodeURIComponent(workspacePath)}`,
            );
            if (!response.ok) throw Error("Catalog rejected");
            return response.json();
          },
        },
        skillsService: {
          async listCodexSyncCandidates({ workspacePath }: { workspacePath: string }) {
            const response = await fetch(
              `/codex-skill-candidates?workspace=${encodeURIComponent(workspacePath)}`,
            );
            if (!response.ok) throw Error("Skill catalog rejected");
            return response.json();
          },
        },
      }) as unknown as IServiceAccessor,
    [],
  );
  useEffect(() => {
    void fetch("/codex-resource-settings")
      .then((response) => response.json())
      .then(setSettings);
  }, []);
  return (
    <ZCodeIntlProvider initialLocale={params.get("locale") === "en-US" ? "en-US" : "zh-CN"}>
      <TooltipProvider>
        <ServiceProvider services={services}>
          <main
            className="mx-auto max-w-2xl space-y-4 bg-background p-4 text-foreground"
            data-codex-navigation={String(
              SETTINGS_SECTION_GROUPS.find(
                (group) => group.id === "agentCapabilities",
              )?.sections.some((section) => section.id === "codexIntegration") &&
                resolveSettingsSection("codexIntegration") === "codexIntegration",
            )}
          >
            <button
              data-testid="fixture-workspace-switch"
              onClick={() =>
                setWorkspace((value) =>
                  value === "/fixture/one" ? "/fixture/two" : "/fixture/one",
                )
              }
            >
              Switch workspace
            </button>
            <button data-testid="fixture-workspace-clear" onClick={() => setWorkspace("")}>
              Clear workspace
            </button>
            <CodexResourcesSettings
              settings={settings}
              workspacePath={workspace}
              workspaceIdentity={`host:${workspace}`}
              onSave={async (patch) => {
                const response = await fetch("/codex-resource-settings", {
                  method: "POST",
                  body: JSON.stringify(patch),
                });
                if (!response.ok) throw Error("Save rejected");
                setSettings(await response.json());
              }}
            />
          </main>
        </ServiceProvider>
      </TooltipProvider>
    </ZCodeIntlProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
