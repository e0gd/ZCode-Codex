import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ConversationBackgroundWorkTrigger } from "@/v4/composer/ConversationBackgroundWorkTrigger.js";
import { ConversationStatusPanel } from "@/v4/ConversationStatusPanel.js";
import { ConversationAgentToolCallRow } from "@/v4/ConversationAgentToolCallRow.js";
import { buildAssistantWorkRenderItems } from "@/v4/conversationAssistantWorkItems.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import "@/styles.css";

const params = new URLSearchParams(location.search);
const data = await fetch("/native-child-data").then(response => response.json()) as {
  running: { snapshot: ConversationSnapshot; children: Record<string, ConversationSnapshot> };
  completed: { snapshot: ConversationSnapshot; children: Record<string, ConversationSnapshot> };
};
document.documentElement.className = params.get("theme") === "zai-dark"
  ? "dark theme-zai-dark" : "light theme-zai-light";

function Fixture() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [stage, setStage] = useState<"running" | "completed">(
    () => sessionStorage.getItem("native-child-stage") === "completed" ? "completed" : "running",
  );
  const current = data[stage];
  const items = buildAssistantWorkRenderItems(
    current.snapshot.rows.window.filter(row => row.kind === "toolCall" || row.kind === "subagent"),
    { messageStreamShowReasoning: true },
  );
  return (
    <ZCodeIntlProvider initialLocale={params.get("locale") === "en-US" ? "en-US" : "zh-CN"}>
      <TooltipProvider>
        <main className="mx-auto min-h-screen w-full max-w-2xl bg-background p-3 text-foreground" data-stage={stage}>
          <button data-testid="complete-native-children" onClick={() => {
            sessionStorage.setItem("native-child-stage", "completed"); setStage("completed"); setSelected(undefined); setOpen(false);
          }}>Complete fixture children</button>
          <section data-testid="native-spawn-records">
            {items.map(item => item.kind === "agentToolCall" ? <ConversationAgentToolCallRow key={item.key} item={item}
              context={{ workspacePath: "C:/fixture", sessionId: current.snapshot.sessionId,
                theme: params.get("theme")?.endsWith("dark") ? "dark" : "light",
                codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
                onOpenSubagentSession: request => setSelected(request.childSessionId) }} /> : null)}
          </section>
          <ConversationBackgroundWorkTrigger backgroundWorks={current.snapshot.backgroundWorks}
            runningSubagentCount={current.snapshot.subagents.running.length} onOpen={() => setOpen(true)} />
          {open && <ConversationStatusPanel workspacePath="C:/fixture" parentSessionId={current.snapshot.sessionId}
            runningSubagents={current.snapshot.subagents.running} backgroundWorks={current.snapshot.backgroundWorks}
            agentSectionOpen layoutMode="inline" summaryPanelVariantOverride="panel"
            onOpenSubagentSession={request => { setSelected(request.childSessionId); setOpen(false); }} />}
          {selected && <output data-testid="selected-child" data-child-session-id={selected}>
            {current.children[selected].rows.window.filter(row => row.kind === "assistantText").map(row => row.text).join("\n")}
          </output>}
        </main>
      </TooltipProvider>
    </ZCodeIntlProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
