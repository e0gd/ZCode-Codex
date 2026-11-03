# Native Codex validation — 2026-11-03

The upstream failure comparison and earlier controlled source-desktop acceptance below are retained as baseline evidence. The current project-level dual-engine implementation has separate checks and controlled desktop results described first, including recovery of both engine types after a full process restart. These results do not establish release readiness, live-provider inference, or phone behavior.

## Revisions and environment

- Upstream: `a60ba6a7e5a06742270ca605f5d2cc2766afa7e1`.
- Migrated executor baseline: `native-codex`, `50a0510ff360ef946c03809b2cf0952738ca7302`; the project-engine changes validated here are recorded in the subsequent feature commit.
- Windows x64, Node.js 24.14.0, pnpm 10.33.2.
- Desktop: source build, Electron 44.7.0, official Codex CLI 0.166.0.

## Project-level dual-engine validation

The current user flow is **Create project → Execution engine → ZCode / Codex**, with ZCode selected by default. The saved engine is fixed and read-only in the project editor. Existing projects without the field and conversations without project ownership use ZCode. Every session in a Codex project must use official Codex, including cold recovery; project membership, rather than cwd or process environment, determines routing. Same-directory projects may select different engines. Restoring a project preserves its choice, and cross-engine task moves are rejected.

Users install Codex separately. Codex uses the provider/model configured in ZCode, currently OpenAI Responses with an API key. The owning Host locates the executable when needed and uses independent Codex storage. Ordinary use does not require workspace environment variables; explicit executable/home overrides remain available for deployment and isolated tests. Missing Codex and unsupported API configuration must fail explicitly without switching engines.

The new PE01 desktop E2E case in `conversation-session-virtual-project.test.ts` covers the default selector, two engines saved for the same directory, read-only editing, persistence after renderer refresh, and a subsequent new project's ZCode default. It does not by itself prove executor routing or full-process restart recovery.

Current root typecheck, lint, schema, and architecture checks passed. Targeted CLI tests passed 197 cases, and core executor tests passed 46. The full CLI run reported 37 successful package tasks out of 45, with eight test packages failing. Some adapter failures have the upstream comparison recorded below; the other failures have not been attributed to upstream or this change. The full CLI suite is not reported as passing.

An external ten-scenario runtime validation passed migration, old-task ownership, restore, and move cases. Review identified that legacy directory-based ownership could associate an imported ZCode task with a Codex project. The fix restricts those legacy candidates to ZCode projects; current session routing still reads the reserved task's actual project membership. Host commands rejected engine mutation and cross-engine task moves.

The current desktop run used the source renderer, Host/CLI, official Codex, and a local Responses fixture with dummy credentials. It observed:

| Scenario            | Observed result                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Project creation    | Real UI created a default ZCode project and a selected Codex project with the same cwd                                                      |
| Directory selection | Native picker results were substituted through the renderer's React platform context; the real browse/save/folder-trust flow then completed |
| Editing             | Both saved project engines appeared read-only                                                                                               |
| ZCode routing       | A real ZCode conversation completed through the ZCode engine                                                                                |
| Codex routing       | Two separate sessions in the Codex project completed through official Codex                                                                 |
| Routing evidence    | Official rollouts and thread maps contained exactly two Codex sessions, both belonging to the Codex project; the ZCode prompt was absent    |
| API configuration   | Both used the ZCode-selected `gpt-5.4` model, `low` reasoning, and a dummy API key                                                          |
| Storage             | Default Codex home was `<Host base>/.zcode/codex-home`; the original `CODEX_HOME` was unchanged                                             |

The native operating-system picker itself was not exercised. These controlled actions provide evidence for the current flow; they do not mean the checked-in PE01 WebdriverIO case was run end to end.

The standard `pnpm dev:desktop:test` command completed its full build. Three isolated startup attempts then stalled in the existing ARMS `getPath(userData)` initialization. The successful checks above used that same build, Vite, and an actual `electron.exe . --user-data-dir=<isolated profile>` launch without an Electron wrapper. This round therefore does **not** establish successful standard-command startup. The earlier standard-entry smoke result below remains historical evidence for its original revision and setup.

Full-process restart recovery for the current project routing **passed**. After restarting the complete desktop, Host, and CLI process tree, the real UI opened the original Codex session and original ZCode session and submitted `ACCEPT_RESUME` to each. Both returned `RESUME_OK`. Fixture requests six and seven recovered the respective original nonce from the actual current assistant history; the fixture recorded zero errors. Both original Codex thread-map IDs remained unchanged, with no new threads and no ZCode rollouts. Project editing remained read-only with the saved engine, and a subsequent new-project form still defaulted to ZCode.

Test processes have been cleaned up. All 18 original ZCode/Codex processes remained alive with their original creation times; all three protocol/Explorer registrations matched their pre-run snapshots, and the test listeners on ports 5174 and 9229 were gone. Current desktop missing-executable failure, live-provider behavior, phone/remote recovery, and installation/packaging are not claimed as passed. The earlier completed workspace-selection runs below remain baseline evidence for their original scope.

## Original adapter failures

Both checkouts used the same toolchain, `--maxWorkers=2`, and separate isolated homes and application data directories. The 16 originally failing test files are unchanged by the feature migration.

| Comparison                                   | Upstream                            | Feature branch                      |
| -------------------------------------------- | ----------------------------------- | ----------------------------------- |
| All 448 cases in the 16 files                | 363 passed / 30 failed / 55 skipped | 363 passed / 30 failed / 55 skipped |
| Exact-name rerun of the original 27 failures | 5 passed / 22 failed                | 5 passed / 22 failed                |

The failed case sets matched. There was no branch-only reproduction among the original 27 cases in this environment. This establishes upstream presence of the reproduced failures, not their complete root causes.

Of the original 27 cases, 21 failed in both rounds. A concurrent Node-fallback rename case passed in the broad round and failed with `EPERM` in the exact-case round in both checkouts. The following five original failures passed in both rounds in both checkouts and remain classified as **unreproduced**, not fixed:

- Completion/timeout/abort race.
- Slow command preparation timeout budget.
- Cross-process OAuth incident replay.
- Runtime process telemetry.
- Concurrent session database migration.

Evidence includes POSIX path and permission-bit assumptions on Windows, environment-key casing differences, shell behavior, and SQLite cleanup reporting `EBUSY`. Some shell and symlink cases need further diagnosis before assigning a root cause. The broad round also exposed nine additional OAuth failures identically in both checkouts; their mechanisms were not investigated and they are excluded from the exact-27 conclusion.

The original full-suite invocation used different concurrency and conditions. This comparison does not prove that intermittent failures are resolved or that the entire adapter suite passes.

## Source-desktop acceptance

The actual execution chain was:

```text
source Electron UI → source Host/CLI → official Codex CLI → loopback Responses fixture
```

Playwright operated the real desktop window. The local fixture supplied deterministic responses and tool requests; the official Codex process executed the tool. No live provider credentials or paid inference were used.

| Scenario               | Observed result                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat                   | UI displayed the fixture reply with a random marker; captured HTTP request selected `gpt-5.4` and `low` reasoning                           |
| Model/reasoning switch | Actual UI selector changed the same session to `gpt-5.3-codex` / `high`; HTTP capture confirmed both fields                                 |
| Tool approval          | Official Codex requested approval for a read-only `Get-Content`; desktop showed the approval UI and accepted **Allow once**                 |
| Tool execution         | Official Codex rollout recorded the isolated file marker and exit code 0; the fixture received the matching function output                 |
| Stop                   | Clicking Stop closed the held streaming response before completion; UI showed Stopped and retained partial text                             |
| Full restart           | Desktop and Host were restarted; the original sidebar task restored history and stopped partial text                                        |
| Continue after restart | Same ZCode session and official Codex thread resumed; fixture recovered the original random marker from the new request's assistant history |

The evidence verifier passed all eight assertions. Six HTTP requests used dummy credentials, the fixture recorded no errors, and one official Codex rollout covered the session before and after restart. Chat, approval, stop, and restart screenshots were also visually inspected.

## Initial acceptance isolation

Test homes, Electron storage, ZCode storage, workspace, and `CODEX_HOME` were isolated. A temporary wrapper outside the repository set Electron paths before importing source main, disabled the application's fixed debugging port, and intercepted protocol/context-menu registration. Test provider configuration used the repository's E2E helper with dummy credentials.

The first launch temporarily rewrote Explorer folder/drive menu registration before that interception was added. Both menu definitions were restored to the inspected installed ZCode definitions. There was no pre-run snapshot of those menus, so exact original menu preservation cannot be claimed. The `zcode://` association matched its pre-run snapshot, all 16 original ZCode processes remained alive with unchanged creation times, and the test desktop and local fixture were stopped after acceptance.

The wrapper was used for that acceptance. The separate standard-entry run below establishes startup without it. Installation/packaging, approval denial, live-provider behavior, and phone/remote reconnection remain unverified. No test wrapper or machine configuration is shipped in this branch.

## Standard development entry follow-up

A second isolated run invoked the published root command, `pnpm dev:desktop:test`, through the local Node/pnpm toolchain. It used a fresh test home, application storage, workspace, and Codex home, with the same dummy provider fixture. The normal script prepared missing native search tools, built the Agent and plugins, ran tsup and Vite, then launched `electron.exe .` from `packages/desktop`. There was no Electron wrapper, injected module, registration interception, or altered debugging-port behavior. Playwright attached to the existing default debugging port after launch.

The source renderer loaded from `http://localhost:5174/`. After completing the real onboarding Skip controls, the desktop opened the isolated workspace and:

- Sent chat through the real Host/CLI and official Codex, receiving a random fixture marker. HTTP capture confirmed `gpt-5.4` / `low` and dummy authentication.
- Displayed the actual read-only tool approval, accepted **Allow only this time**, and received `TOOL_DONE`.
- Recorded `NATIVE_DESKTOP_TOOL_MARKER` and exit code 0 in the official Codex rollout. The fixture received the corresponding tool output, recorded three requests, and reported no errors.

These startup/chat/tool checks passed, with observations that prevent describing the development UI as issue-free:

- The default React Scan performance toolbar overlapped Send and blocked its mouse click. Pressing Enter in the composer submitted successfully. Vite configuration supports disabling that development tool with `ZCODE_REACT_SCAN=0`; that disabled configuration was not separately launched in this run.
- Built-in provider refresh failed and retained local configuration. The explicitly configured local provider remained usable; live built-in provider behavior was not verified.
- A task-index `meta_json` validation warning appeared. Its root cause and effect on task indexing were not investigated by this startup smoke test.

No product source was changed. After closing the desktop, all test processes and listeners on 5174/9229 were gone. The standard launch temporarily changed the protocol and Explorer menus; all three registrations were restored and matched their exact pre-run snapshots. All 18 pre-existing ZCode/Codex processes remained alive with matching creation times.

## Local evidence

Raw evidence stays outside Git under the validation machine's `%LOCALAPPDATA%/CodexGitSetup/` directory:

- `adapter-baseline-audit/REPORT.md`: case-by-case findings.
- `adapter-baseline-audit/original27-comparison.json`: mapping of each original failure across both revisions and rounds.
- `adapter-baseline-audit/comparison.json`, Vitest JSON reports, and `*-invocation.json`: complete results and exact argument arrays.
- `desktop-acceptance-20261103-123947/acceptance-result.json`: desktop assertions and scope.
- `desktop-acceptance-20261103-123947/preservation-result.json`: process and registration checks.
- The same desktop directory retains screenshots, isolated official Codex rollout, and external orchestration/verifier scripts.
- `desktop-standard-20261103-131453/acceptance-result.json`: standard-entry smoke assertions and observations.
- `desktop-standard-20261103-131453/preservation-result.json`: exact registration restoration and original-process checks.
- The standard-entry directory also retains `launch.json`, development logs, fixture capture, official rollout, UI snapshots, and screenshots.
- `desktop-standard-20261103-135827/`: current project-engine UI/state captures, project/task metadata, `engine-verification-before-restart.json`, `engine-ui-resume.json`, `engine-verification-after-restart.json`, screenshots, startup logs, fixture captures, isolated official rollouts, and thread maps. The after-restart files retain both engines' continuation evidence and stable Codex thread IDs.
- `cli-engine-validation/`: `REPORT.md`, targeted and full-suite logs, `suite-summary.json`, failure cases, and CLI typecheck/lint output. The coordinating agent also retained the external ten-scenario runtime validation evidence outside Git.

These local artifacts are machine-specific and are not a portable test harness. This report records the observed results; reproduction requires rebuilding the isolated fixture and launch setup. Credentials, user databases, and machine diagnostics are excluded from the repository.
