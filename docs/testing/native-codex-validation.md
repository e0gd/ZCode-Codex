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

### Image upload follow-up

The native path previously rejected all attachments after Core had already resolved and persisted them. Core now forwards resolved content blocks through the native port; the adapter maps image data URLs to Codex image inputs, and rejects failed resolution or unsupported media before dispatch. Existing admission, file-part persistence and thread ownership are unchanged.

Focused regression results: adapter **78/78**, Core native-turn executor **51/51**. Coverage includes image-only turns, ordered multiple images, uploaded artifact resolution, local-file resolution, persisted user file parts, rejection before spawn and same-thread resume. Root and CLI typecheck passed; root lint reported 0 errors / 83 warnings, CLI lint 0 errors / 73 warnings plus its admitted upstream line-count diagnostics. An additional prompt-attachment suite run exposed two Windows path expectation failures in the unchanged `prompt-attachments.test.ts`; that broader suite is not reported as passing.

Two isolated runtime checks used official Codex 0.166.0 and a loopback Responses fixture with dummy credentials. Direct adapter execution delivered the exact image data in text-plus-image and image-only requests on the same thread. The packaged Windows CLI was then run using its packaged Electron Node runtime and trusted Host preference selecting Codex: `v4/attachment/begin` → `chunk` → `commit` → `sendText` delivered uploaded bytes to the actual Codex Responses request. After stopping and restarting the CLI, another image-only upload completed on the same mapped thread, with a `web-remote-replayable` snapshot showing success. Both captured image payloads matched the original PNG bytes. This validates packaged upload/runtime/replay integration; it does not establish live-provider inference, external relay connectivity or physical phone acceptance.

Local follow-up evidence is retained under `%LOCALAPPDATA%/CodexGitSetup/`: `native-attachment-*.log`, `native-image-runtime.log`, `image-runtime-*/report.json`, `packaged-image-upload.log`, `packaged-image-upload-*/report.json`, `native-image-desktop-build.log` and `native-image-package.log`. Test homes and Codex threads are isolated from the live installation.

### Web project-engine follow-up

The shared production `ProjectEditor` already exposes the engine selector during creation and deliberately keeps it read-only for existing projects. A browser fixture now exercises that component with only the service boundary controlled: 390 px touch and 1200 px mouse, light/dark themes, Chinese/English. All **8/8** cases passed: default ZCode, select Codex, folder confirmation, save request with the Codex engine and chosen root, and read-only Codex when editing. Evidence: `mobile-engine-browser.log` and the ignored `packages/desktop/.e2e-artifacts/project-device-baseline/engine-*.png` screenshots.

The production Web frontend build passed independently. A desktop package cannot replace static assets hosted at the official remote-control website; deployment of the branch frontend and its access URL still require separate verification. These browser tests do not establish which frontend a user's phone is currently loading, nor do they change the immutable project-engine contract.

### Official remote new-task follow-up

The project-navigation service returns `executionEngine` with its prepared directory. The desktop's strict `project-workspace-prepared` response schema omitted that optional field, rejecting valid navigation results before the mobile workspace bridge could open. The red regression reproduced `Unrecognized key: "executionEngine"`. The schema now accepts only the optional `zcode` / `codex` values; legacy responses still parse, unknown values and extra fields still fail, and navigation requests cannot override the project engine.

The existing remote-task browser acceptance now runs actual navigation output through that Host response schema. Both the official `https://zcode.z.ai/remote/v4?app_version=3.17.1` assets and the source frontend passed **4/4** configurations each: Chinese/English and light/dark at 390 px. Project New task and the top New task button entered a draft with an editable composer. The top button retained the current project's Codex engine under the existing inheritance contract. Existing-task open, failed remote bridge without showing stale local history, successful retry, correct workspace identity, and bridge reuse also passed. Browser authentication, relay and service responses were isolated fixtures; no real user session received a message and no model request was sent. This establishes compatibility with official frontend assets, not physical-phone or live-relay acceptance.

Root typecheck passed, root lint reported 0 errors / 83 existing warnings, and the production desktop build passed. Evidence is retained outside Git as `remote-new-task-*.log`, with browser screenshots, navigation traffic and results under the ignored `.tmp/remote-task-open-e2e/{official,source}/` directories.

### Native question-button follow-up

Native questions previously had two missing paths: the adapter rejected `item/tool/requestUserInput` and ignored completed `agentMessage.questions`. Codex 0.166.0 also advertises `request_user_input` but rejects it internally in Default mode unless `features.default_mode_request_user_input=true`. An isolated official-binary run reproduced that rejection before the flag and completed after it. The adapter now normalizes both question forms into Core's existing AskUserQuestion broker, with explicit answers returned to the native question IDs. Async message questions continue on the same thread after the preceding native turn completes. Native questions have no automatic-continue timer, including Plan and full-access modes.

Adapter/Core regressions passed **139/139**; broker/projection regressions passed **360/360**. Coverage includes explicit waiting, choice/custom answers, multiple question IDs, cancellation/disconnection, async continuation, duplicated message completions, pending/resolved persistence, and suppression of the ordinary optional-question timer. The real official-binary check used a loopback Responses fixture and dummy credentials, advertised the question tool, received the supplied answer and returned `QUESTION_BUTTON_ANSWER_OK`. This binary check covers the RPC question path; async message questions were verified with controlled app-server notifications.

The checked-in browser acceptance runs real Core, broker and product projection through the production ElicitationDialog and submits its answer back into the broker. All **8/8** browser configurations passed, with **24** choice/custom/free-text flows across 390/1200 px, Chinese/English and light/dark themes. Pending screenshots were inspected. Each flow verifies that showing the card sends no answer, explicit user action returns the expected answer, and both live projection and event replay remove the pending interaction. An intermediate run under concurrent build load hit the browser's initial 30-second navigation limit; the final harness allows 90 seconds for initial Vite loading and passed all cases.

The Windows portable package also passed an isolated runtime check through its actual Electron Node executable, packaged CLI, v4 protocol and official Codex 0.166.0. A full-access session stayed pending until an explicit `resolveInteraction` command. Desktop-continuous and Web-remote-replayable subscriptions exposed the same question identity and choices without an automatic-resolution timer. The answer reached the next actual Responses request, which returned `PACKAGED_QUESTION_OK`; restarting the CLI restored the completed conversation with no stale pending interaction. This complements the browser click test without claiming a live relay or physical-device run. The packaged CLI SHA256 was `64794e960861bee3bfc250d57ec1904f17cf2c719bd66c98814936f83c747113`.

Root and CLI typechecks passed; root lint reported 0 errors / 83 existing warnings, CLI lint 0 errors / 73 warnings plus 7 admitted upstream line-count diagnostics. Architecture check passed with zero violations; the legacy CLI module is outside the managed dependency coverage. The desktop production build passed. These isolated checks do not establish paid-provider inference, external relay connectivity, or physical phone acceptance.

Local evidence: `native-question-focused.log`, `native-question-projection-tests.log`, `native-question-browser-final.log`, `native-question-final-*.log`, `question-runtime-*/report.json`, `native-question-desktop-build.log`, `native-question-package.log`, `packaged-question-runtime.log`, and `packaged-question-6eCzWT/report.json`. Browser screenshots are in the machine's temporary `zcode-native-question-browser` directory. The packaged runtime reuses the previous complete plugin/npm assets, whose source is unchanged, and replaces the CLI with the newly built bundle.

### Free-text question Host validation correction (2026-11-03)

Two failed native turns persisted an AskUserQuestion input with `metadata.source=native-codex` and an empty option list. Core and the existing free-text UI accepted that shape, but the desktop Host's shared reverse-RPC schema required at least one option and returned `Invalid user input request params`. Earlier browser and packaged question checks left that reverse request pending without validating it; their free-text coverage therefore missed the actual Host rejection. The shared transport now accepts an empty option array, while the ordinary AskUserQuestion tool retains its separate choice limits. Broker and browser fixtures now validate the actual Host schema before V4 resolution can win the race.

The existing mixed/free-text broker regression failed before the schema correction; afterward all **120/120** broker cases and **8/8** browser configurations (**24** choice/custom/free-text flows) passed. Root and CLI typechecks passed. Root lint reported 0 errors / 83 existing warnings; CLI lint reported 0 errors / 73 warnings and 7 admitted upstream line-count diagnostics. Architecture check reported zero violations.

A complete Windows desktop was rebuilt and packaged, including the Host. Package inspection confirmed that its Host matches the new build after the standard sourcemap-comment cleanup and differs from the previous installed Host. Its CLI SHA256 is `66cbf7a94496f7fb703e3e37c96b8f8dc830ee1af04f6b9f9dfe312510b78ae9`. Two isolated packaged-runtime checks used official Codex 0.166.0, model identifier `gpt-6.1-sol`, dummy credentials and a local Responses fixture: a pure-text question and a choice/text mixture emitted by the actual `request_user_input_async` tool. Both validated the production shared Host schema on reverse RPC, stayed pending until an explicit V4 answer, delivered all answers to the subsequent native model request, exposed matching desktop-continuous and Web-remote-replayable pending identities, and restored completed history without pending interactions after a CLI restart. This harness controls the Host-facing RPC endpoint; it does not launch the full desktop shell or establish live-provider, relay or physical-phone acceptance. Initial fixture attempts using the older `gpt-5.4` blocking tool did not support optionless questions; the final passing fixture matches the reported asynchronous question path and model family.

Evidence outside Git: `free-text-host-before.log`, `free-text-host-broker.log`, `free-text-host-browser.log`, `free-text-host-{types,lint,cli-types,cli-lint,architecture,package}.log`, `free-text-host-package-verification.json`, `free-text-host-runtime{,-mixed}.log`, and the referenced isolated `packaged-question-*/report.json` files. Activation requires a full desktop restart because replacing only the CLI leaves the old Host contract loaded. Previously failed questions are not automatically replayed or answered.

### Codex automatic delegation setting

Settings → Agent capabilities → Subagents now contains **Codex collaboration / Automatically delegate to subagents**. The executing Host's existing setting service owns `codexAutoSubagentsEnabled`, default false. Native executions pull it through `session/requestRuntimePreferences` before every execution, so existing desktop and Web/mobile sessions use the next-turn value without changing their engine or recreating the project. Off retains explicit delegation; on permits useful proactive delegation. This release adds the global preference only. The official hosted frontend does not acquire the new control from the desktop package.

Adapter regressions passed **85/85** and protocol/engine assembly regressions **125/125**. They cover absent-value compatibility, on/off refresh without materializing a second runtime, same-thread start/resume, unchanged user input and permission behavior, and failure before dispatch when Host lookup fails. The browser acceptance passed **8/8** configurations (390/1200 px, Chinese/English, light/dark), using the production control and real setting service in an isolated home. It covers default off, saved on after reload, failed-save feedback retaining the last saved value, successful retry, disk persistence and no horizontal overflow. A local data-state style makes the new Radix switch's checked thumb position visible; the browser checks the actual thumb movement. Narrow layouts use the existing stacked SettingsRow variant.

Official Codex 0.166.0 runtime capture verified **off → on → off on one thread**, preserving configured developer instructions, selected model, reasoning and advertised explicit `spawn_agent` capability. An initial implementation using `thread/resume.developerInstructions` left the original policy in the next model request. The final implementation uses keyed application `additionalContext` at each `turn/start`; real request capture verifies the latest policy in all three turns. This is a model behavior preference, not a deterministic guarantee that every task creates a child.

The packaged CLI/Electron runtime also passed off/on/off through actual v4 commands, trusted Host preference reverse RPCs, desktop-continuous and Web-remote-replayable subscriptions, and a full CLI restart before the final turn. All three turns completed on the same mapped Codex thread with model `gpt-5.4` / reasoning `low`. Package CLI SHA256: `242c9dd0382c9b51cea8a0337aa4fc16efc467db9d55699c4d6d50133b2e1f77`. The Responses fixture used dummy credentials and deterministic replies; it verifies policy delivery and capability availability, not unprompted delegation frequency, paid inference, external relay or phone hardware.

Root/CLI typechecks passed. Root lint reported 0 errors / 83 existing warnings; CLI lint reported 0 errors / 73 warnings plus 7 admitted upstream line-count diagnostics. Architecture check reported zero violations, with legacy CLI dependency coverage unchanged. Desktop production build and Windows portable packaging passed. Local evidence: `auto-subagents-*.log`, `auto-subagents-runtime-n3O6Vw/report.json`, and `packaged-auto-subagents-oeKnyx/report.json`; UI screenshots are in the isolated temporary `zcode-auto-subagents-browser-*` directories. Unchanged complete plugin/npm assets are reused from the prior installed package.

## Native Codex child visibility (2026-11-03)

Codex collaboration items previously appeared only as generic tools; their child-thread notifications were discarded. A real Codex 0.166.0 loopback capture also showed a parent finishing while its child was still generating. Closing the per-turn process at that point terminated background work. The adapter now observes trusted child identities and keeps the process until all observed work finishes. Core persists normal subagent child sessions, streams their own topics, and emits the existing parent lifecycle facts. Parent tool ACKs persist stable child references for cold restoration, including nested children. Tool usage attribution follows the event's child identity.

Before-fix regression logs reproduce the missing child UI events, orphan native children incorrectly staying running after restart, successful native child turns with tools being classified as lost, and child tool usage being attributed to the parent. CLI regression suites passed **88 adapter + 63 Core/usage + 141 bootstrap cases**. They cover parent-first completion, trusted versus foreign notifications, parallel/nested relations, follow-up reuse, old-turn exclusion, failed spawn, cancellation/failure settlement, persisted child tools/text, cold native outcome interpretation, and unchanged standard subagent/query behavior.

The browser acceptance uses real Core child events and the production ProductProjection, robot button and status panel. All **8 configurations** passed (390/1200 px, Chinese/English, light/dark). It clicks the robot and the selected running-child entry and verifies that the callback resolves the matching child topic's output. The fixture renders that output for inspection; it does not instantiate the full Electron side-pane shell. Screenshots are under the isolated temporary `zcode-native-child-browser` directory.

Two real Codex 0.166.0 runs through the bundled CLI and Electron-as-Node passed normal completion and main-turn stop. Each spawned two real native agents with deterministic local Responses streams, verified live child text, parent-first completion, desktop-continuous and Web-remote-replayable snapshots, standard ended-directory statuses and child transcript recovery without duplication after a full CLI restart. Build CLI SHA256: `a1dfa2164b6328efc2092470b3e0ed65a226edb2ad44b68b401cf108022b5a1b`. Evidence: `native-subagent-ui-4bLp0r/report.json`, `native-subagent-ui-NVfOVz/report.json`, and `subagent-ui-*.log` under the external evidence directory. These tests use dummy credentials and do not establish paid-provider, external-relay or physical-phone acceptance.

Child-only permission requests/questions currently decline or return no answers. The native child list offers observation; it does not advertise the ordinary ZCode per-background-task stop control. Stopping the parent stops its observed children. The updated installation reuses the prior desktop renderer/runtime assets because this change only updates the bundled CLI; a full desktop restart activates it without changing user data or restarting the current conversation.

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

## Response stream failure diagnostics (2026-11-03)

An inspected local incident had two consecutive failed turns: Codex received HTTP 200 / `text/event-stream`, but the stream closed before `response.completed`; each turn exhausted five native retries. This establishes an incomplete response stream, not whether the originating fault was the provider, gateway or network. A later minimal direct Responses request and an isolated official Codex 0.166.0 turn using the same configured provider both completed. No original user conversation was replayed; these smoke checks do not prove that conversation has recovered.

The adapter now classifies known structured stream failures without exposing raw provider messages. Real 0.166.0 fixture execution revealed classified `responseStreamDisconnected` retry notifications followed by a terminal `other`; the adapter retains only the active turn's most recent safe retry classification for that exact terminal case. New turns clear it, nonstream retries replace it, and explicit other terminal categories retain their own generic handling. Core logs the stable `NATIVE_CODEX_RESPONSE_STREAM_FAILED` category and optional validated HTTP status. Existing cancellation, partial output, no-replay and no-provider-fallback rules remain in force.

Focused regressions passed: adapter **117/117**, Core native executor **71/71**. Root and CLI typechecks passed. Root lint reported 0 errors / 83 warnings; CLI lint reported 0 errors / 73 warnings plus 7 admitted upstream line-count diagnostics. The real official-binary loopback fixture sent six HTTP requests (initial attempt plus five retries) and returned the safe stream failure category without treating the missing completion as success. Its dummy credential and isolated workspace did not access user conversations. Evidence outside Git: `turn-stream-fixture-IxeKBr/report.json`, `turn-stream-probe-Ztcxfa/report.json`, and `turn-stream-fix-*.log` under the external evidence directory.

The desktop-agent CLI was rebuilt and copied, with a checksum-verified backup, to the existing local modified desktop's `resources/glm/zcode.cjs`. SHA256: `8b5fa22a02e59cdf923b4d2fb17f09197efd5e0ffafe4aa9a75bc1dce22535a8`. Existing running processes and user data were left intact; a full desktop restart is required to load the update. This is a local runtime update, not a replacement of the already published installers or acceptance of the original conversation.
