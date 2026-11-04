# ZCode-Codex

This experimental branch integrates the official Codex app-server into ZCode while preserving ZCode's native execution. Users work through the ZCode interface and select the execution method per project. The Codex CLI is installed separately and started by ZCode. New projects default to ZCode; selecting Codex applies to every session created or resumed in that project. ZCode continues to own input admission, session persistence, approvals, cancellation, and desktop/mobile projections. Existing projects and conversations without a project default to ZCode.

For desktop project creation, the exact automatic-delegation setting path, and official Web/mobile limitations, see the step-by-step sections in [中文 README](README.md#创建-codex-项目) or [English README](README.en.md#create-a-codex-project). The current official hosted frontend cannot select Codex when creating a project or change this fork's automatic-delegation setting; create the project and configure the executing desktop first, then continue its sessions from Web/mobile. The source Web UI requires its own deployment to expose the added controls.

The branch starts at upstream `a60ba6a7e5a06742270ca605f5d2cc2766afa7e1` (ZCode 3.17.1), preserving its Git history. The migration contains the existing native executor, provider/model selection, approval and transcript fixes, and context-compaction notification handling. It includes the two compaction metadata/recovery changes that were absent from the external patch manifest. Source archives, local launchers, databases, credentials, installed applications, and machine diagnostics are not part of this branch.

## Preview downloads

The `v3.17.1-codex.2` [release page](https://github.com/e0gd/ZCode-Codex/releases/tag/v3.17.1-codex.2) contains the latest available platform packages and SHA256 manifests. Windows x64 uses a complete `.exe` installer, not a standalone launcher or PowerShell script. macOS uses `.dmg`/`.zip`; Linux x64 uses `.AppImage`, `.deb`, `.rpm` and `.pkg.tar.zst`. Only actual release attachments count as published. Official Codex must still be installed separately. Exit and reopen the updated desktop before using the new code.

This version includes ChatGPT subscription login, modern official child-agent activity, and live child task input/command output in the read-only sub-session pane. The robot button is shown while children run; completed spawn records remain accessible. Tool output previews are bounded and do not expose private reasoning. See the [2026-11-04 validation records](docs/testing/native-codex-validation.md) for the controlled runtime/browser checks and remaining real-account/platform acceptance limits.

## Build from source

Use the Node.js and pnpm versions in `mise.toml`:

```sh
pnpm install --frozen-lockfile
pnpm --filter '@zcode/cli...' build
```

Install the official Codex CLI separately, then launch ZCode through its normal development/build entry point. In **Create project**, choose **Execution engine → Codex** and save. The engine is fixed after creation and appears read-only when editing a project. Restoring a deleted project retains its original choice; opening an existing directory and reusing a project also retains its engine. Tasks can move only between projects with the same engine.

Codex uses an OpenAI Responses API key provider configured in ZCode or the dedicated ChatGPT subscription login in Manage Models. It locates the official executable when needed and uses separate Codex storage without changing the user's pre-existing Codex configuration or credentials. Official Codex owns subscription credentials in that isolated home; they are not copied into API provider configuration. Missing Codex, incompatible configuration or unavailable authentication produces an explicit error without switching sources. Normal project selection requires no workspace environment variables. Explicit executable and isolated-home overrides remain available for deployment and tests. On remote projects, installation and execution belong to the owning Host.

See [the project execution-engine specification](docs/specs/project-execution-engine.md) for project ownership and compatibility rules, and [the executor specification](apps/zcode-cli/docs/design/v2/native-codex-executor.md) for permissions, model selection, and recovery details. Keep credentials outside the repository.

## ChatGPT subscription login

In a client built with this feature, open **Settings → Manage Models → ChatGPT subscription (Codex)** and sign in using the displayed device code on the official authorization page. In a Codex project, choose the **ChatGPT subscription** group and a model. The official Codex catalog supplies model IDs and reasoning efforts; its entries do not guarantee account quota or server permission. Actual execution can still be rejected, and rejection never triggers API fallback.

Official model IDs, capability definitions, authentication and connection settings are read-only. Choosing another subscription model or supported reasoning level takes effect on subsequent inputs, while an executing turn keeps its resolved configuration. Older Web clients cannot rewrite the official definitions or replace subscription authentication; incompatible writes are rejected and the existing configuration is retained.

Official Codex 0.166 does not support resuming an existing thread across API and ChatGPT subscription authentication sources. Create a new task in the same Codex project when switching sources; the original task, thread and history remain intact. The integration never silently forks or replays the original input to make that switch.

The current official hosted website has no subscription login card. Manage login on the modified desktop, then continue an existing subscription task from Web/mobile; model catalog visibility depends on the older frontend's compatibility. The updated source Web UI can manage the same Host's account but requires a separate deployment. A local build or source change does not update published Releases or the hosted website. Real-account browser authorization and subscription inference remain pending acceptance; controlled tests do not establish those results. See [the subscription specification](docs/specs/codex-chatgpt-subscription.md) for ownership and failure behavior.

## Status and limits

The Windows x64 desktop has been rebuilt, packaged as a complete portable directory and installed locally. Public Releases are separate from this local validation; macOS/Linux packages and Windows installer behavior remain unverified. The shared desktop/Web project creation UI provides the engine selector; using an older hosted Web frontend does not pick up local desktop UI changes. Old remote servers remain compatible with default ZCode behavior and are not assumed to support Codex. Text and image inputs are supported, including uploaded Web/mobile images. Core resolves and persists attachments, then passes their image data to Codex; unreadable images and unsupported file/video attachments or interactions fail explicitly. Structured Codex questions use the existing clickable question cards, accept custom text, and wait for an explicit answer in every permission mode. A failed native turn does not fall back to the ZCode model loop.

Controlled source-desktop acceptance passed with the official Codex CLI and a local Responses fixture: chat, model/reasoning selection, actual tool approval and execution, cancellation, full restart, and continuation of the same thread. A separate `pnpm dev:desktop:test` run also passed startup, chat, approval, and tool execution without an Electron wrapper. Its default React Scan toolbar overlapped Send; pressing Enter submitted successfully. These source checks do not establish live-provider inference or physical-phone/relay behavior. Subsequent Windows packaging, image, question and subagent checks are recorded in the validation report. See [the validation report](docs/testing/native-codex-validation.md) for evidence and scope. The compatibility dispatcher for the separately installed older desktop is a local deployment tool and is not shipped by this branch.

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

## Codex delegation preference

Settings → Agent capabilities → Subagents contains a Codex collaboration switch, **Automatically delegate to subagents**. It defaults off: delegation then requires an explicit user, project, or skill instruction. Enabling it permits useful independent work to be delegated proactively. The setting is global to the executing computer and is read again on the next turn, including existing Web/mobile sessions connected to that computer. It does not change the selected model, reasoning level, sandbox or ZCode agent definitions. The official hosted Web frontend does not acquire the new settings control from a desktop update.

## Native child visibility

Codex-spawned agents now use ZCode's existing spawn/status rows, composer robot button, running-agent list and read-only child-session view. Child text and tools are persisted under their own child session, including nested agents and later follow-up turns. Desktop and connected Web/mobile clients consume the same standard protocol state. The bridge keeps the native process alive when the parent finishes before its children; stopping the main turn also stops its observed children.

Ended children remain available after restart. An unfinished child whose executing runtime disappeared is reported as lost. Native child observation does not expose ZCode's individual background-task stop button. Child-only permission requests and questions currently decline or return no answers; parent permission/question support is unchanged.

To try it with automatic delegation off, explicitly ask Codex to spawn two agents for independent tasks, then click the robot button while they run. Fully exit and relaunch the modified desktop after installing an update; connected Web/mobile clients use that executing desktop's updated CLI.

## Upstream maintenance

`origin` is the fork, and `upstream` is `https://github.com/zai-org/ZCode.git`. Keep the fork's `main` aligned with upstream and develop the integration on `native-codex`. Merge upstream updates into the feature branch only after reviewing compatibility and rerunning the required checks.
