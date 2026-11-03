import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ConversationBackgroundWorkTrigger } from "@/v4/composer/ConversationBackgroundWorkTrigger.js";
import { ConversationStatusPanel } from "@/v4/ConversationStatusPanel.js";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import "@/styles.css";

const params = new URLSearchParams(location.search);
const data = await fetch("/native-child-data").then(response => response.json()) as {
  snapshot: ConversationSnapshot; children: Record<string, ConversationSnapshot>;
};
document.documentElement.setAttribute("data-theme", params.get("theme") ?? "zai-light");

function Fixture() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>();
  return (
    <ZCodeIntlProvider initialLocale={params.get("locale") === "en-US" ? "en-US" : "zh-CN"}>
      <TooltipProvider>
        <main className="mx-auto w-full max-w-2xl bg-background p-3 text-foreground">
          <ConversationBackgroundWorkTrigger backgroundWorks={data.snapshot.backgroundWorks}
            runningSubagentCount={data.snapshot.subagents.running.length} onOpen={() => setOpen(true)} />
          {open && <ConversationStatusPanel workspacePath="C:/fixture" parentSessionId={data.snapshot.sessionId}
            runningSubagents={data.snapshot.subagents.running} backgroundWorks={data.snapshot.backgroundWorks}
            agentSectionOpen layoutMode="inline" summaryPanelVariantOverride="panel"
            onOpenSubagentSession={request => setSelected(request.childSessionId)} />}
          {selected && <output data-testid="selected-child" data-child-session-id={selected}>
            {data.children[selected].rows.window.filter(row => row.kind === "assistantText").map(row => row.text).join("\n")}
          </output>}
        </main>
      </TooltipProvider>
    </ZCodeIntlProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
