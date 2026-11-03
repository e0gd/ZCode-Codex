# ZCode Native Codex branch

This experimental branch integrates the official Codex app-server as the execution backend for an explicitly selected local workspace. ZCode continues to own input admission, session persistence, approvals, cancellation, and desktop/mobile projections. Other workspaces keep the existing ZCode engine.

The branch starts at upstream `a60ba6a7e5a06742270ca605f5d2cc2766afa7e1` (ZCode 3.17.1), preserving its Git history. The migration contains the existing native executor, provider/model selection, approval and transcript fixes, and context-compaction notification handling. It includes the two compaction metadata/recovery changes that were absent from the external patch manifest. Source archives, local launchers, databases, credentials, installed applications, and machine diagnostics are not part of this branch.

## Build

Use the Node.js and pnpm versions in `mise.toml`:

```sh
pnpm install --frozen-lockfile
pnpm --filter '@zcode/cli...' build
```

Install the official Codex CLI separately. Before launching ZCode through its normal development/build entry point, set `ZCODE_CODEX_WORKSPACE` to the exact absolute workspace path, `ZCODE_CODEX_BINARY` to the official executable, and `CODEX_HOME` to an isolated absolute directory outside the workspace. Keep credentials outside the repository. See [the executor specification](apps/zcode-cli/docs/design/v2/native-codex-executor.md) for all configuration, permission mapping, model selection, recovery, and validation requirements.

## Status and limits

This is a source integration, not an installer or a completed desktop release. There is no project-settings engine selector yet. Text input is supported; unsupported attachments and interactions fail explicitly. A failed native turn does not fall back to the ZCode model loop.

Desktop and phone end-to-end acceptance remains required, including actual approvals, disconnection recovery, cancellation, and old-thread continuation. Earlier isolated protocol tests do not establish that these user-facing scenarios have passed. The compatibility dispatcher for the separately installed older desktop is a local deployment tool and is not shipped by this branch.

The native adapter contract currently carries session/input identity rather than a separate adapter trace context. The architecture policy still classifies the broad CLI module as legacy; a passing architecture gate does not prove every internal CLI boundary.

## Migration verification (2026-11-03)

Validated in a separate checkout with Node.js 24.14.0 and pnpm 10.33.2:

| Check | Result |
| --- | --- |
| Frozen dependency installation | Passed using the existing offline package cache |
| `pnpm --filter '@zcode/cli...' build` | Passed, 17 selected projects; built CLI reports 0.17.1 |
| `pnpm typecheck` | Passed |
| `pnpm --dir apps/zcode-cli typecheck` | Passed, 34/34 tasks |
| `pnpm lint` | Passed, 0 errors and 83 warnings |
| `pnpm --dir apps/zcode-cli lint` | Passed, 0 errors, 73 warnings, 7 pristine upstream line-count diagnostics |
| `pnpm architecture:check --changed` | Passed, 0 violations |
| Adapter `native-codex.test.ts` | 64/64 passed |
| Core `native-turn-executor.test.ts` | 46/46 passed |
| Bootstrap provider-runtime and transcript-hydration tests | 107/107 passed |
| Staged whitespace and credential-pattern checks | Passed |

The partial clone's architecture checks used Git rename detection disabled to avoid fetching historical blobs; the source snapshot and architecture policy were not changed. Windows CLI typecheck needed the repository's `node_modules/.bin` on PATH to resolve `turbo`.

An initial test invocation incorrectly split a single path into character filters and ran the entire adapters suite. That run reported 2,478 passed, 27 failed, and 67 skipped; those failures were not investigated or represented as passing. The corrected commands selected only the four affected test files and passed all 217 cases. These are local regression tests, not new live Codex, desktop, or phone acceptance.

## Upstream maintenance

`origin` is the fork, and `upstream` is `https://github.com/zai-org/ZCode.git`. Keep the fork's `main` aligned with upstream and develop the integration on `native-codex`. Merge upstream updates into the feature branch only after reviewing compatibility and rerunning the required checks.
