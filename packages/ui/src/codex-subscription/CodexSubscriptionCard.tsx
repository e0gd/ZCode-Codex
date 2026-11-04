import { useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useCodexAccount } from "./useCodexAccount.js";
import type { CodexSubscriptionCardProps } from "./contract.js";

function safeDeviceUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "auth.openai.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      (url.pathname === "/codex/device" || url.pathname === "/codex/device/")
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function CodexSubscriptionCard({ workspacePath = "" }: CodexSubscriptionCardProps) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const { state, busy, failed, run } = useCodexAccount(workspacePath);
  const [openFailed, setOpenFailed] = useState(false);
  const msg = (key: string) => intl.formatMessage({ id: `settings.codexSubscription.${key}` });
  const authorizationUrl = safeDeviceUrl(state?.login?.verificationUrl);
  const status = state?.status ?? (failed ? "error" : "loading");
  return (
    <section
      data-testid="codex-account-card"
      className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-ui-lg font-semibold text-foreground">{msg("title")}</h2>
          <p role="status" aria-live="polite" className="text-ui-base text-foreground-subtle">
            {msg(`status.${status}`)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="codex-account-refresh"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run("refresh")}
          >
            <RefreshCwIcon className="size-3.5" aria-hidden="true" />
            {msg("refresh")}
          </Button>
          {status === "logging-in" ? (
            <Button
              data-testid="codex-account-cancel"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run("cancel")}
            >
              {msg("cancel")}
            </Button>
          ) : status === "signed-in" ? (
            <Button
              data-testid="codex-account-logout"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run("logout")}
            >
              {msg("logout")}
            </Button>
          ) : (
            <Button
              data-testid="codex-account-login"
              size="sm"
              disabled={busy || status === "loading"}
              onClick={() => void run("login")}
            >
              {msg("login")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-ui-base leading-relaxed text-foreground-subtle">{msg("description")}</p>
      {failed || status === "error" || openFailed ? (
        <p role="alert" className="text-ui-base text-destructive">
          {msg("error")}
        </p>
      ) : null}
      {state?.account ? (
        <p className="break-all text-ui-base text-foreground" data-testid="codex-account-identity">
          {state.account.email}
          <span className="ml-2 text-foreground-subtle">{state.account.planType}</span>
        </p>
      ) : null}
      {state?.status === "logging-in" && state.login ? (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
          <p className="text-ui-base text-foreground-subtle">{msg("deviceInstructions")}</p>
          <code
            data-testid="codex-account-code"
            className="block break-all font-mono text-ui-lg font-semibold text-foreground"
          >
            {state.login.userCode}
          </code>
          <Button
            data-testid="codex-account-open"
            size="sm"
            variant="outline"
            disabled={!authorizationUrl}
            onClick={() => {
              if (!authorizationUrl) return;
              try {
                platform.openExternal(authorizationUrl);
                setOpenFailed(false);
              } catch {
                setOpenFailed(true);
              }
            }}
          >
            {msg("openAuthorization")}
          </Button>
          {!authorizationUrl ? (
            <p role="alert" className="text-ui-base text-destructive">
              {msg("invalidUrl")}
            </p>
          ) : null}
        </div>
      ) : null}
      {state?.status === "signed-in" ? (
        <div className="space-y-2">
          <h3 className="text-ui-base font-medium text-foreground">{msg("models")}</h3>
          <p className="text-ui-sm text-foreground-subtle">{msg("catalogHint")}</p>
          {state.models.length ? (
            <ul
              data-testid="codex-account-catalog"
              className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border bg-surface p-3"
            >
              {state.models.map((model) => (
                <li key={model.id} className="min-w-0 space-y-1">
                  <p className="break-words text-ui-base font-medium text-foreground">
                    {model.displayName}
                  </p>
                  <p className="break-all font-mono text-ui-sm text-foreground-subtle">
                    {model.model}
                  </p>
                  <p className="break-words text-ui-sm text-foreground-subtle">
                    {msg("reasoning")}:{" "}
                    {model.supportedReasoningEfforts
                      .map((effort) => effort.reasoningEffort)
                      .join(" / ") || "—"}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status" className="text-ui-base text-foreground-subtle">
              {msg("emptyCatalog")}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
