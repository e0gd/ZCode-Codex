import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ElicitationDialog } from "@/ElicitationDialog.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import type { ZCodeElicitationRequest } from "@zcode/shared";
import "@/styles.css";

const params = new URLSearchParams(location.search);
const { request } = (await fetch("/native-question-data").then((response) => response.json())) as {
  request: ZCodeElicitationRequest;
};
document.documentElement.setAttribute("data-theme", params.get("theme") ?? "zai-light");

function Fixture() {
  const [response, setResponse] = useState<unknown>();
  return (
    <ZCodeIntlProvider initialLocale={params.get("locale") === "en-US" ? "en-US" : "zh-CN"}>
      <TooltipProvider>
        <main className="mx-auto w-full max-w-2xl bg-background p-3 text-foreground">
          {response === undefined ? (
            <ElicitationDialog
              request={request}
              onRespond={async (requestId, action, content) => {
                const result = await fetch("/native-question-answer", {
                  method: "POST",
                  body: JSON.stringify({ requestId, action, content }),
                });
                if (!result.ok) throw new Error("Question response was rejected");
                setResponse({ action, content });
              }}
            />
          ) : (
            <output data-testid="question-response">{JSON.stringify(response)}</output>
          )}
        </main>
      </TooltipProvider>
    </ZCodeIntlProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
