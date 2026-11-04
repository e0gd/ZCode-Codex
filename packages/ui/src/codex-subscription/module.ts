export const codexSubscriptionModule = {
  id: "codex-subscription-ui",
  requires: ["shared", "services", "ui"],
  provides: ["codex-subscription-ui"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
