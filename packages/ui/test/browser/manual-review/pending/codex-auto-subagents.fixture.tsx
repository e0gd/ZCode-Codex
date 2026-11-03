import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CodexSubagentsSettings } from "@/settingsPageHelpers.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import "@/styles.css";

const params = new URLSearchParams(location.search);
document.documentElement.className =
  params.get("theme") === "dark" ? "dark theme-zai-dark" : "light theme-zai-light";
function Fixture() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void fetch("/codex-auto-settings")
      .then((response) => response.json())
      .then((settings) => {
        setEnabled(settings.codexAutoSubagentsEnabled === true);
        setLoading(false);
      });
  }, []);
  return (
    <ZCodeIntlProvider initialLocale={params.get("locale") === "en-US" ? "en-US" : "zh-CN"}>
      <TooltipProvider>
        <main className="mx-auto max-w-2xl space-y-4 bg-background p-4 text-foreground">
          <CodexSubagentsSettings
            enabled={enabled}
            loading={loading}
            onChange={async (value) => {
              const response = await fetch("/codex-auto-settings", {
                method: "POST",
                body: JSON.stringify({ codexAutoSubagentsEnabled: value }),
              });
              if (!response.ok) throw Error("Save rejected");
              const settings = await response.json();
              setEnabled(settings.codexAutoSubagentsEnabled === true);
            }}
          />
        </main>
      </TooltipProvider>
    </ZCodeIntlProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
