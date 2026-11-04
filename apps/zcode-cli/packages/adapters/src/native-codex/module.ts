/** Official native process adapter; Core and the existing registry retain business ownership. */
export const nativeCodexModule = {
  id: "native-codex",
  requires: ["shared", "provider", "zcode-cli"],
  provides: ["native-codex"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
