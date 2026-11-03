# ZCode Native Codex branch

This experimental branch adds a project-level choice between ZCode and the official Codex app-server. New projects default to ZCode; selecting Codex applies to every session created or resumed in that project. ZCode continues to own input admission, session persistence, approvals, cancellation, and desktop/mobile projections. Existing projects and conversations without a project default to ZCode.

The branch starts at upstream `a60ba6a7e5a06742270ca605f5d2cc2766afa7e1` (ZCode 3.17.1), preserving its Git history. The migration contains the existing native executor, provider/model selection, approval and transcript fixes, and context-compaction notification handling. It includes the two compaction metadata/recovery changes that were absent from the external patch manifest. Source archives, local launchers, databases, credentials, installed applications, and machine diagnostics are not part of this branch.

## Build

Use the Node.js and pnpm versions in `mise.toml`:

```sh
pnpm install --frozen-lockfile
pnpm --filter '@zcode/cli...' build
```

Install the official Codex CLI separately, then launch ZCode through its normal development/build entry point. In **Create project**, choose **Execution engine → Codex** and save. The engine is fixed after creation and appears read-only when editing a project. Restoring a deleted project retains its original choice; opening an existing directory and reusing a project also retains its engine. Tasks can move only between projects with the same engine.

Codex uses the API provider and model configured in ZCode; the current integration supports OpenAI Responses with an API key. It locates the official executable when needed and uses separate Codex storage without changing the user's existing Codex configuration or credentials. Missing Codex or an incompatible API configuration produces an explicit error. Normal project selection requires no workspace environment variables. Explicit executable and isolated-home overrides remain available for deployment and tests. On remote projects, installation and execution belong to the owning Host.

See [the project execution-engine specification](docs/specs/project-execution-engine.md) for project ownership and compatibility rules, and [the executor specification](apps/zcode-cli/docs/design/v2/native-codex-executor.md) for permissions, model selection, and recovery details. Keep credentials outside the repository.

## Status and limits

This is a source integration, not an installer or a completed desktop release. The shared desktop/Web project creation UI provides the engine selector; using an older hosted Web frontend does not pick up local desktop UI changes. Old remote servers remain compatible with default ZCode behavior and are not assumed to support Codex. Text and image inputs are supported, including uploaded Web/mobile images. Core resolves and persists attachments, then passes their image data to Codex; unreadable images and unsupported file/video attachments or interactions fail explicitly. A failed native turn does not fall back to the ZCode model loop.

Controlled source-desktop acceptance passed with the official Codex CLI and a local Responses fixture: chat, model/reasoning selection, actual tool approval and execution, cancellation, full restart, and continuation of the same thread. A separate `pnpm dev:desktop:test` run also passed startup, chat, approval, and tool execution without an Electron wrapper. Its default React Scan toolbar overlapped Send; pressing Enter submitted successfully. Live-provider inference, phone/remote disconnection recovery, approval denial, and installation/packaging remain unverified. See [the validation report](docs/testing/native-codex-validation.md) for evidence and scope. The compatibility dispatcher for the separately installed older desktop is a local deployment tool and is not shipped by this branch.

Those completed runs used the earlier workspace-selection setup. The current project flow has now passed controlled source-desktop checks: default ZCode and selected Codex projects at the same cwd, read-only editing, one ZCode conversation, and two Codex conversations. Official rollouts and thread maps contained exactly the two Codex sessions; the ZCode prompt was absent. Both engines used the same ZCode API configuration (`gpt-5.4`, `low`, dummy credentials). Codex storage defaulted to `<Host base>/.zcode/codex-home`, while the original `CODEX_HOME` was unchanged. Host commands rejected engine mutation and cross-engine moves. After restarting the complete desktop/Host/CLI process tree, the original Codex and ZCode sessions both resumed through the real UI. The fixture recovered each original nonce from the actual new request history, with zero errors; the two Codex thread IDs were unchanged, with no extra threads or ZCode rollout. Editing remained read-only and the next new project still defaulted to ZCode.

The current `pnpm dev:desktop:test` build completed, but three isolated startup attempts stalled in the existing ARMS `getPath(userData)` initialization. The checks above used the same build with Vite and a direct `electron.exe . --user-data-dir=<isolated profile>` launch, without a wrapper. Native directory-picker results were substituted through the renderer's React platform context; browse, save, and folder trust still used the real UI/service flow. This does not establish a successful current standard-entry startup or actual operating-system picker behavior. See [the validation report](docs/testing/native-codex-validation.md) for the complete limits.

Current root typecheck, lint, schema, and architecture checks passed. Targeted CLI tests passed 197 cases, and core executor tests passed 46. The full CLI run completed 37 of 45 package tasks successfully; eight test packages failed. Only some adapter failures have upstream comparisons, so the remaining failures are not attributed to upstream or this change. An external ten-scenario runtime check passed migration, legacy task ownership, restore, and move cases. The legacy directory-inference path now considers only ZCode projects, preventing imported old tasks from acquiring a Codex engine by cwd.

The native adapter contract currently carries session/input identity rather than a separate adapter trace context. The architecture policy still classifies the broad CLI module as legacy; a passing architecture gate does not prove every internal CLI boundary.

## Migration verification (2026-11-03)

Validated in a separate checkout with Node.js 24.14.0 and pnpm 10.33.2:

| Check                                                     | Result                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Frozen dependency installation                            | Passed using the existing offline package cache                           |
| `pnpm --filter '@zcode/cli...' build`                     | Passed, 17 selected projects; built CLI reports 0.17.1                    |
| `pnpm typecheck`                                          | Passed                                                                    |
| `pnpm --dir apps/zcode-cli typecheck`                     | Passed, 34/34 tasks                                                       |
| `pnpm lint`                                               | Passed, 0 errors and 83 warnings                                          |
| `pnpm --dir apps/zcode-cli lint`                          | Passed, 0 errors, 73 warnings, 7 pristine upstream line-count diagnostics |
| `pnpm architecture:check --changed`                       | Passed, 0 violations                                                      |
| Adapter `native-codex.test.ts`                            | 64/64 passed                                                              |
| Core `native-turn-executor.test.ts`                       | 46/46 passed                                                              |
| Bootstrap provider-runtime and transcript-hydration tests | 107/107 passed                                                            |
| Staged whitespace and credential-pattern checks           | Passed                                                                    |

The partial clone's architecture checks used Git rename detection disabled to avoid fetching historical blobs; the source snapshot and architecture policy were not changed. Windows CLI typecheck needed the repository's `node_modules/.bin` on PATH to resolve `turbo`.

An initial test invocation incorrectly split a single path into character filters and ran the entire adapters suite. That run reported 2,478 passed, 27 failed, and 67 skipped. The corrected commands selected only the four affected test files and passed all 217 cases. A subsequent upstream/branch comparison found identical results for the original 27 cases: 22 failed and 5 passed in each checkout, with no branch-only reproduction. The five passing cases remain classified as unreproduced, not fixed. See [the baseline investigation and desktop acceptance report](docs/testing/native-codex-validation.md); these results do not establish live-provider or phone acceptance.

## Upstream maintenance

`origin` is the fork, and `upstream` is `https://github.com/zai-org/ZCode.git`. Keep the fork's `main` aligned with upstream and develop the integration on `native-codex`. Merge upstream updates into the feature branch only after reviewing compatibility and rerunning the required checks.
