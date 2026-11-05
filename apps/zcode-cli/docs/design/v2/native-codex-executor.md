# Native Codex executor

Native notification admission is bounded per executor turn, including notifications buffered before turn/start responds and across provider-alias reconnections. At most 1024 pending notifications and 32 MiB of UTF-8 JSON notification data may await serial delivery; the in-flight handler counts until it settles. Exceeding either bound fails the turn with NATIVE_CODEX_EVENT_BACKLOG_LIMIT, closes the native connection and preserves dispatch receipts. It never silently drops events or replays the input. This protects against a confirmed unbounded notification queue; it does not establish that queue growth caused the reported 2026-11-04 heap crash.

This CLI integration selects the execution engine for each session from its owning project's immutable setting, defaulting to ZCode. The official Codex app-server owns its complete model/tool loop for Codex projects. ZCode retains its existing command admission, foreground cancellation, session persistence and desktop/mobile event projection. See the [project engine specification](../../../../../docs/specs/project-execution-engine.md) and [cross-host execution contract](../../../../../docs/runtime-tools/native-codex-executor.md) for ownership, crash reconciliation and acceptance requirements.

## Native process lock recovery (2026-11-04)

Foreground execution and title sampling share one adapter-owned session lock. New locks record a random ownership token, owner PID, recorded Codex child PIDs and an uncertain-spawn flag before each spawn. A later admission may reclaim a lock only when the record is valid, no spawn is uncertain, and both the owner and every child PID are proven absent. Permission-denied probes and PID reuse fail closed. A recovery election inside the existing lock serializes stale reclamation; release validates the ownership token. Legacy empty/corrupt locks still require manual process/thread inspection and are never cleared by age. No task is replayed, provider changed or thread forked by lock recovery; existing input receipts remain authoritative. Desktop continuous and mobile replayable clients use the same admission path.

Regression covers live owners, dead owners with live children, uncertain/legacy locks, known-dead recovery, exclusive competing recovery and release ownership. A dead parent alone is insufficient because official Codex can survive its CLI.

## Project engine selection

The existing Host runtime-materialization preferences response carries the engine resolved from authoritative task/project membership. Bootstrap passes it as a per-session app option; explicit `zcode` disables the native executor even when old environment opt-ins are present. `codex` locates the separately installed official executable and prepares an isolated home without requiring `ZCODE_CODEX_WORKSPACE`. Same-directory projects must remain independent; child session materialization inherits the parent engine. Cold restoration reuses the Host project decision. Missing Codex or incompatible providers fail visibly without falling back. No engine setting is accepted from ordinary sendText payloads and no process-global engine is introduced.

The environment factory below remains a compatibility entry for standalone experiments without a Host-selected engine. It is not the normal project selection path.

## Configuration and precedence

### MCP and skill sources (2026-11-04)

The Host settings owner supplies optional Codex MCP/skill preferences through the existing session-runtime-preferences request. Bootstrap rereads those preferences for every native turn and resolves only resource categories whose ZCode-sync flag is enabled. The adapter receives one immutable snapshot: preferences, permitted effective MCP definitions, and enabled skill source paths. This snapshot never changes the active turn, writes either source configuration, or creates a second session/runtime for mobile clients. See [Codex resources](../../../../../docs/specs/codex-resources.md).

ZCode synchronization rereads configuration and plugin discovery for the executing workspace. MCP filtering reuses `createWorkspaceMcpTrust.allows`, excludes disabled servers, and uses the same merge/provenance owner as ordinary runtime configuration. The shared compatibility classifier excludes incompatible definitions and the Host-owned `codexMcpDisabledServers` exclusions without changing the original MCP configuration or blocking other servers/the native turn. The status-only `mcp/list` catalog returns metadata-only candidates with compatibility, effective enablement and static reasons, without connecting servers. Compatible enabled/trusted definitions default on; manual exclusions survive compatibility changes. The built-in `node_repl` server is a ZCode-internal broker host with a dedicated protocol/permission boundary, so that exact built-in provenance is excluded from portable MCP synchronization. Other same-name user definitions do not inherit broker credentials or built-in authority. Skill discovery reuses the existing user/project/plugin roots and disabled-path rules; only selected `SKILL.md` paths cross the adapter boundary. Host-created resource snapshots must not be treated as new blanket workspace trust. An unavailable configuration or source mismatch fails visibly; it cannot retain an older turn's projection or fall back to the other source.

### Managed ChatGPT subscription (2026-11-04)

The protected `chatgpt-subscription` provider uses `codex-chatgpt` access and resolves to the native port's `authMode: "chatgpt"` branch. Manage Models calls `codex/account` through the existing Host management carrier. One account controller owns each CLI process's login connection, pending device authorization, cancellation and safe account/catalog projection. Credentials stay in the existing isolated Codex home; provider config and remote RPC contain metadata only. Use the official built-in `openai` provider, forced ChatGPT authentication and a scrubbed child environment, never an API alias/key or provider-table override (the installed 0.166 binary rejects overriding the reserved `openai` provider).

Before dispatch, validate official `account/read` and the exact `model/list` model/effort. Official reasoning efforts are extensible strings (`max` and `ultra` occur in 0.166), so validate bounded slugs and exact catalog membership rather than a six-value subscription enum. Discovery does not prove entitlement or remaining quota. A saved API thread cannot change to a subscription provider; fail with `NATIVE_CODEX_AUTH_SOURCE_MISMATCH` before input receipt/dispatch and preserve history. Missing subscription login and unavailable model/effort use `NATIVE_CODEX_SUBSCRIPTION_AUTH_REQUIRED` / `NATIVE_CODEX_SUBSCRIPTION_MODEL_UNAVAILABLE`. Core exposes fixed safe messages through the existing error path. No fallback, input replay or implicit thread fork is allowed. The ordinary API engine rejects subscription access before constructing an SDK client.

The account controller alone publishes official metadata through the config owner's dedicated catalog operation. Generic provider/model edits, imports and direct provisioning writes are checked within the personal repository's file lock; they cannot mutate subscription identity or official model definitions. Preserve existing default selection and user enable/order preferences; repeated unchanged publication does not write or broadcast. Full product, legacy Web editing and acceptance contract: [ChatGPT subscription](../../../../../docs/specs/codex-chatgpt-subscription.md).

### Standalone compatibility environment

The isolated launch environment is an explicit deployment opt-in; it does not modify installed application settings or user configuration. Bootstrap calls `createNativeCodexExecutorFromEnv(workingDirectory, options.env ?? process.env)`. A supplied `options.env` is the selected environment, not implicitly merged with the process environment. The adapter factory accepts an explicit environment for tests and embedded callers.

- `ZCODE_CODEX_WORKSPACE`: required opt-in, exact absolute workspace path. Unset or a different normalized path returns no executor and leaves the existing engine in place. Matching uses Windows case normalization on Windows; execution verifies the canonical real path. Basename/prefix matching is forbidden. A matching configuration that fails validation errors visibly; it must not silently fall back to the model loop.
- `ZCODE_CODEX_BINARY`: required absolute official Codex executable path for an opted-in workspace.
- `CODEX_HOME`: required absolute isolated Codex home. Its provider configuration and credentials remain official Codex inputs.
- `ZCODE_CODEX_MODEL` and `ZCODE_CODEX_PROVIDER`: explicit app-server overrides; the current adapter defaults are `gpt-6.1-sol` and `zcode_api`. These identify configured execution targets, not a guarantee of provider availability. The provider identifier permits letters, digits, underscore and hyphen.
- `ZCODE_CODEX_BASE_URL`: optional explicit provider endpoint override. If absent, the configured provider endpoint remains in effect. Only HTTP(S) URLs without embedded credentials, query or fragment are accepted.
- `CODEX_ZCODE_API_KEY`: credential supplied through the child process environment and referenced by the provider's `env_key`; never embedded into arguments, mappings, logs or specs. The app-server overrides shell environment exclusion for this key.
- `ZCODE_CODEX_STATE_DIR`: optional state directory; absent defaults to `CODEX_HOME/zcode-native`. Its resolved real path must be outside the project. Per-workspace and per-session hashes isolate thread mappings and input receipts. A relative override currently resolves against the host cwd; deployment should use an absolute directory.
- `ZCODE_CODEX_SKILL_ROOTS`: optional JSON array of absolute reviewed skills roots. Invalid JSON, non-array values or relative roots fail configuration. It is registered at app-server initialization; it does not automatically import host MCP tools.

Explicit app-server command-line overrides take precedence over Codex home configuration for model/provider, credential env key, sandbox and approval policy. Core snapshots `permission: { mode: CollaborationMode, planEnabled: boolean }` at native execution start. Plan (legacy mode or independent planEnabled) takes precedence and maps to `read-only/never`; yolo maps to `danger-full-access/never`; build, edit and auto retain `workspace-write/on-request`; guarded uses `workspace-write/untrusted` and retains explicit user-once approval for every callback, conservatively preserving its dangerous-command gate. This native bridge does not claim automatic guarded command classification. Apply the snapshot to process startup, thread start/resume, and turn start (sandboxPolicy), overriding any previous thread permission state on every turn. No global yolo environment override exists. Known command/file approval callbacks in yolo return allow without broker or permission events; Plan callbacks return deny without broker or permission events. Other callbacks retain the existing approval bridge and invalid/stale/unsupported requests still fail closed. Mode changes affect the next turn and cannot broaden an in-flight turn. Credentials and home files are not mutated by selecting the executor.

Native turns consume the canonical submission Mode/Plan through the existing Core execution-state owner before capturing native permissions. An explicit `sendText.mode` overrides the prior session mode; explicit `planEnabled` overrides the prior planning state. Omitted values retain the state frozen by the existing V4 admission resolver, or the current state for direct Core callers without an intent. Apply only mode/plan for native execution, never instantiate the ZCode model carried in the submission. Persist `SessionModeChanged` through the existing execution-state path so desktop and mobile snapshots reflect the same accepted selection. Explicit build must still downgrade a prior yolo selection, and enabled planning must retain read-only native execution.

```text
client sendText Mode/Plan -> V4 canonical intent -> Core admission
  -> execution-state persistence + SessionModeChanged -> native permission snapshot
  -> same event sequence -> desktop continuous / mobile replayable
```

Regression: an existing build session submitted with yolo executes and persists yolo; omitted submission mode preserves the selected state; explicit build downgrades yolo; explicit Plan overrides permissions; native modelFactory remains unused in every case.

## Per-turn provider, model and reasoning selection

Core owns the canonical admitted `ModelSelection` snapshot (`providerId`, `modelId`, `options.reasoningLevel`). Native execution receives that turn's snapshot, falling back only to the session selection when the submission has no explicit selection. A later queued submission cannot change an already admitted turn. Native execution does not create a ZCode Model. Core reuses accepted selection persistence and publishes ModelSelected with the exact provider/model/thought snapshot. Persisted assistant messages carry that turn’s providerId and modelId, including failures and cold replay. Native text streams carry the same frozen provider/model display identity through canonical normalization into assistantText.model; transcript synthesis derives the identical value from the persisted assistant identity, never from a later session selection. Disabled reasoning with an empty option map omits effort rather than rejecting the model. Launcher model/provider/base URL/key values are legacy defaults only when no selection exists; they never override an explicit selection or repair a rejected selection.

Bootstrap injects a server-side `NativeCodexModelResolver` backed by the existing process Provider Registry. It validates the selection through `validateSelection`, reads its exact configured Provider and Model, and returns transient native launch configuration. Submission payloads cannot provide endpoints, credentials, provider configuration, or Codex config overrides. No new Host reverse RPC is introduced. Only configured API-key OpenAI Responses providers with a representable reasoning map are supported; unsupported API/auth/header/option mappings fail visibly before spawning or dispatching, without falling back to another provider/model. The resolver evaluates the existing reasoning option map and requires a single Responses `reasoning.effort` value supported by Codex (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`), or an empty mapping for a model with no reasoning setting. Extra request body mutations cannot silently disappear in the native bridge.

The adapter snapshots the resolved result once per turn. It registers a stable isolated Codex provider alias with that resolved base URL, `wire_api=responses`, and `env_key=CODEX_ZCODE_API_KEY`. It overrides the inherited key with the selected provider's key only in the child environment, excludes that key from shell tools, and never writes credentials to mappings, receipts, arguments, persisted events or diagnostics. Thread start/resume receives model/provider plus `config.model_reasoning_effort`; turn/start receives the selected `model` and `effort`. A resumed thread is explicitly configured again, so switching provider/model/effort between turns cannot retain the earlier turn's settings.

```text
accepted submission ModelSelection -> Core turn snapshot
  -> bootstrap Registry validation + exact configured lookup (server side)
  -> transient native model/base URL/key/effort -> isolated app-server child
  -> thread start/resume overrides -> turn/start model + effort -> Responses request
```

Acceptance covers two configured providers with different dummy keys/endpoints, distinct models, reasoning-level changes on a resumed thread, explicit selection overriding launcher defaults, missing/disabled selections, invalid reasoning levels, incompatible API/auth/header/maps, and credentials absent from command arguments and persisted native state. Fake app-server tests inspect exact RPC parameters; isolated official Codex loopback tests inspect the actual Responses `model`, `reasoning.effort`, endpoint and selected dummy Authorization. No live settings, user databases, installed builds or restarts are part of source validation.

## Execution and projection chain

Native title metadata uses an optional `generateTitle` capability, separate from `execute`. A successful native execution returns its exact official turn ID together with thread ID. Core may sample the first completed turn for a concise session title using that source and the frozen original model selection. The adapter validates the existing trusted mapping, resumes the same thread on a separate short-lived connection, calls experimental `thread/sample` with `expectedTurnId` and `disableMcp: true`, and closes on success/error/abort. No new model turn, input receipt, thread mapping, tool execution, user-input request, or API fallback is allowed. A null sample, unsupported method or source-turn mismatch leaves the first-input title intact. Core alone cleans/persists the title and projects the existing metadata event; see [session title generation](session-title-generation.md).

```text
existing Host owner/lease + workspace/session binding
  -> existing v4 command idempotency and Core admission
  -> TurnStarted + persisted user input
  -> injected NativeTurnExecutor -> official app-server thread/start or thread/resume
  -> awaited native observations -> existing event store and persisted message/tool parts
  -> existing v4 projection -> desktop continuous / mobile replayable
  -> TurnComplete or existing failure/cancellation outcome
```

Core retains the existing trace context when it creates and appends native projection events, including tool and approval events. The native adapter contract currently carries sessionId/inputId rather than a separate trace context; adapter-level structured tracing is not claimed in this scope.

A tool observation is projected as `ToolCallScheduled` before `ToolCallStarted`, then `ToolCallResult`; the persisted tool part transitions pending to completed/error. Assistant segments carry stable message and part identities with text_start/text_delta/text_end. Final text must agree with streamed text; a final-only response emits the missing delta. Partial text and unfinished tool states are persisted on cancellation. Native text parts carry `executionBackend: codex`; assistant metadata must not claim the unrelated ZCode-selected provider/model.

Native chronological segments (2026-11-02): the adapter preserves the Codex text `itemId` through `textStarted`, `textDelta` and `textCompleted`. It owns per-item text reconciliation and idempotent start/completion notifications; Core owns segment parts, their persisted order and projection events. Core opens a text part only on nonempty content, persists it before the following tool or text segment, and emits text_end before tool scheduling. Subsequent content opens a fresh part even if a tool interrupted the same item. A turn remains one assistant message containing ordered text/tool parts. Storage allocates per-message `part.sequence` on first insertion and preserves it on updates, so equal timestamps and later tool completion cannot move parts. Aggregate final text validates the concatenation and completes the turn; it must never overwrite an earlier text part. Missing aggregate suffix is emitted as a new trailing segment. Repeated item lifecycle notifications cannot duplicate text; empty/tool-only turns have no phantom text part or row. Cancellation and errors preserve each observed segment and close unfinished tools.

```text
Codex itemId -> adapter textStarted / textDelta / textCompleted
  -> Core nonempty segment -> persist text + text_end
  -> persist pending tool + scheduled/started -> result updates same tool part
  -> Core next segment -> persist text + text_end -> aggregate validation
  -> same ordered event log / part.sequence
  -> desktop continuous / fresh web snapshot / replay / cold hydration
```

Regression acceptance: textBefore -> multiple tools -> textAfter must retain distinct text part identities and the same order under a frozen clock, final-only items, duplicate starts/completions, tool-only output, failure, cancellation partials and final-text mismatch. Existing approval RPC/tool identities and per-send Mode/Plan capture remain unchanged.

On failure/cancellation, Core persists the active native partial text with `time.start` and no `time.end`, without emitting successful text_end. Existing TurnComplete(cancelled) / TurnError closes the live row as interrupted. Assistant error uses the existing typed `{ name, data }` contract: safe AbortError with `data.turnResult=cancelled` for cancellation, safe Error for failure. Cold hydration leaves only native text parts with an explicit start and missing end open, then the same turn outcome interrupts them. Previously completed segments retain their end and complete state; ordinary non-native text hydration is unchanged. Regression requires BEFORE complete -> successful tool -> AFTER_PARTIAL interrupted and completedInterrupted control across live, fresh snapshots and cold restart.

Approval uses the existing permission broker with user-once/no-always-allow policy. Only an explicit allow result grants Codex approval; deny, modify or escalation does not. Unsupported native interaction requests fail visibly. No adapter-owned accepted queue or second mobile runtime is introduced.

Core owns the native approval lifecycle in the existing persisted session event stream. `NativeTurnApproval.id` remains the adapter's JSON-RPC approval identity; `toolCallId` is the Codex item identity already used by `toolStarted`. Broker correlation is `native-codex:<inputId>:<approvalId>`, while both permission events associate with `toolCallId`. The adapter must await the matching tool start before calling `requestApproval`, including when Codex sends approval before `item/started`; Core rejects an approval without a pending tool. Core registers the broker promise and awaits its optional `registered` barrier before publishing `PermissionRequested`, so a decision made synchronously by an event subscriber cannot be lost. The standard event payload includes input, reason, risk level, empty suggested permission updates, `approvalMode: user-once` and `optionsPolicy: no-always-allow`; the existing V4 permission projection derives a nonempty allow-once/deny option set.

```text
adapter toolStarted -> Core pending tool persistence + scheduled/started events
adapter requestApproval -> broker registration -> PermissionRequested persistence/publication
client decision / turn abort / broker failure -> broker settlement -> PermissionResolved
explicit allow only -> native allow; other decisions -> native deny; abort/failure -> turn failure
same event owner/sequence -> desktop-continuous / web-remote-replayable snapshot + replay
```

A published request has exactly one resolved event, including denial, cancellation and broker failure; cancellation/failure resolves it as deny with a reason before propagating the failure. Per-request cancellation closes pending broker state even when publication fails. Resolution retains the broker's explicit decision/reason/modified input for projection without granting modify/escalate. Existing event-store replay, rather than a second native approval cache, owns reconnect recovery and clearing. Regression cases use the real Core lifecycle with fake native execution and immediate broker decisions during publication, cover asynchronous registration and cancellation while waiting, and verify persisted partial text/tool state without invoking a ZCode model.

Core failure diagnostics emit `native_codex.turn.failed` with session/input/trace/turn identity, captured mode/Plan and safe error metadata. Unsupported interactions and final-text mismatches carry stable `NATIVE_CODEX_UNSUPPORTED_INTERACTION` / `NATIVE_CODEX_FINAL_TEXT_MISMATCH` codes and fixed human messages; unknown causes use a fixed generic diagnostic while preserving the original thrown error. Never log raw provider error messages, prompts, commands, keys, or tool outputs. These diagnostics distinguish known failure categories without claiming to fix unknown runtime stops.

### Response stream failure diagnostics (2026-11-03)

For the active parent thread/turn only, terminal `error` notifications and failed `turn/completed` use the same safe classifier. An exact single-key `codexErrorInfo` object with `responseStreamConnectionFailed`, `responseStreamDisconnected`, or `responseTooManyFailedAttempts` produces `NATIVE_CODEX_RESPONSE_STREAM_FAILED` with the fixed message `Official Codex could not complete the response stream. Check the API provider and network before sending again.` An optional integer HTTP status in 100–599 may be attached as `httpStatusCode` and appended to the message. Malformed/unknown categories retain the existing generic message; arbitrary strings, provider messages and additional details are never surfaced or logged. Core diagnostics allow only the fixed category and validated HTTP status, preserving the original safe error for the existing TurnError projections.

`willRetry: true` remains nonterminal. A stream EOF without `response.completed` must never become success, trigger a second ZCode retry, switch providers or replay an accepted input. Partial text/tool cleanup and the existing desktop-continuous / web-remote-replayable terminal event owner are unchanged. Regression covers all three allowlisted variants, terminal notifications and failed completion, invalid category/status, sensitive fields, retry followed by success, stale thread/turn exclusion and safe Core logging. A successful later smoke test does not retroactively establish recovery of the original failed conversation.

Codex 0.166.0 reports a classified stream error during retry, but may emit only `codexErrorInfo: "other"` when retrying is exhausted. The adapter owns one transient last-retry classification for the active parent turn, storing only the safe Error above. Each active retry replaces it (a nonstream retry clears it); every new turn clears it. Only an exact terminal `"other"` may reuse that latest classification. Missing, unknown or more specific terminal categories do not reuse it, and stale/foreign/child notifications cannot change it. Nothing is persisted as a retry queue or used to resend input.

```text
active parent retry error -> safe allowlist -> replace last-retry classification
  -> official retry (no ZCode dispatch)
  -> terminal "other" -> use last safe classification -> existing Core TurnError
new turn -> clear classification; stale/foreign/child -> no change
```

Initial acceptance covers exact-workspace isolation, no ZCode modelFactory calls, thread reuse, explicit denial, cancellation, event order, cold tool/text persistence, no fallback after errors and consistent live/replay output. Images and structured user questions are supported as specified below; other unsupported media and interactions fail explicitly. Native guide input is not consumed by a ZCode loop. Session forks, rewind and project-memory/model side jobs require separate native capability integration before being represented as supported.

## Native automatic-compaction notifications (2026-11-02)

This is a notification bridge only. Codex retains automatic compaction policy and execution; no manual `/compact` routing, threshold/token-meter changes, summary request, or second model loop is introduced. Official `item/started` and `item/completed` with `item.type=contextCompaction` are accepted only for the active native thread and turn. The typed port forwards `contextCompactionStarted` / `contextCompactionCompleted` with native threadId, turnId and itemId. The adapter does not own compact operation state or dedupe. Deprecated `thread/compacted` has no item identity and is deliberately ignored, including repeated or co-delivered notifications; it never implies successful completion.

Core alone maps the native (threadId, turnId, itemId) tuple to one operationId and persistent compaction part on the same native assistant message. First start closes the active text segment before persisting the marker; subsequent text reopens a new segment. Completion updates that same part and marker. Duplicate starts/completions and a late start after a terminal event have no effects. A completed-only item creates a completed marker without a synthetic started event. Each distinct item in one turn remains a distinct operation.

The existing `CompactStarted`, `CompactCompleted`, and `CompactFailed` events carry the existing `CompactTimelinePayload`: trigger=auto, phase=mid_turn, display=separator, and the original user-turn trace. Token counts, reduction, summaries and coverage boundaries are omitted because the native item does not supply them. Native provenance is stored only in optional compaction-part metadata; the enclosing assistant retains the admitted provider/model, parent and message semantics. Do not invoke the standalone compact timeline writer, which would replace that assistant with a system timeline message.

```text
Codex contextCompaction item + active thread/turn filter -> typed observation
  -> Core tuple identity + monotone lifecycle dedupe -> close preceding text
  -> same assistant ordered compaction part + canonical Compact* event
  -> existing marker row: running -> success / failed / cancelled
  -> desktop continuous / mobile replayable snapshot / cold transcript hydration
```

A non-retrying native turn error, interrupted turn, process/stream failure or local cancellation rejects native execution. Core drains any already accepted compact observation publication before terminal cleanup: a process/stream failure can reject execute independently while Core is still persisting its started event, and that start must never land after its terminal. This barrier covers compact observations only, not permission waits. Core closes only pending compact operations with `CompactFailed` (failed or interrupted), before propagating the original turn outcome. Even a nominally completed turn without the matching item completion closes a pending compact as interrupted, never inferred success. Completed operations are not downgraded by a later turn failure. Cold recovery settles native started/retrying parts directly as interrupted without rewriting assistant metadata or inventing a compact boundary. Markers do not create extra user turns or change the foreground turn outcome; completion removes compact active work while normal generation continues.

Focused acceptance covers observed start/completion, completion-only, repeated/out-of-order lifecycle events, ignored deprecated notifications, stale thread/turn filtering, multiple compact items, text-before/marker/text-after order with frozen timestamps, safe failure/cancellation and missing-completion closure, unchanged permission/model contracts, and matching persisted terminal state on cold restore. Existing hosted compact-marker UI consumes the same wire events without frontend changes.

## Desktop runtime dispatch

The following describes the external experiment's deployment tool, which is not shipped by this source branch. It is not required to build the modified CLI or to use the repository's desktop development entry point.

The native launcher uses a small generated source-discovery root outside every project. Its `apps/zcode-cli/packages/cli/dist/zcode.cjs` entry dispatches in-process, preserving Electron Worker stdin/stdout and the existing storage preparation handshake. It must not alter the installed desktop, Host, user settings, or databases.

Only the exact canonical registered Codex project path selects the native CLI. Ordinary projects, sibling paths, missing opt-in, and unknown startup working directories select the installed CLI. Worker `--prepare-storage --cwd PATH` uses its explicit working directory; normal agents use their actual process cwd. Original routes remove `ZCODE_CODEX_*`, `CODEX_ZCODE_API_KEY`, and `CODEX_HOME` before loading the installed CLI. Credentials are never written into the generated files.

The launcher verifies the inspected installed Host resolver/process-manager checksum and the Codex project's registration using read-only SQLite before staging the discovery root. This deployment currently supports the inspected 3.16.3 per-workspace process contract only. An updated/shared-runtime Host fails closed and requires review; a cwd-only dispatcher cannot safely choose engines for a process shared by arbitrary workspaces.

```text
launcher -> verify installed per-workspace Host + registered project
         -> stage external discovery entry -> installed Host resolver
         -> storage Worker (--cwd) / per-workspace Agent (process cwd)
         -> exact Codex opt-in: native CLI; all other workspaces: installed CLI
         -> unchanged storage readiness and protocol ownership
```

Regression coverage must include exact versus sibling/case-normalized paths, missing opt-in, Worker cwd precedence, original-route environment cleanup, installed contract rejection, and actual isolated storage preparation plus capabilities for both CLI routes. Compare migration ledgers in isolated databases before claiming shared-schema compatibility. Never prepare or migrate the live database as part of these tests. This change fixes overly broad runtime selection; it does not establish a cause for UI unresponsiveness.

## Image attachments

Desktop and Web/mobile submissions share the existing CommandInbox admission and attachment resolver. Core persists the user message and its file parts before native execution, then passes the resolved provider-neutral attachment content blocks to NativeTurnExecutor. It must not pass browser file paths, artifact URIs, or raw upload handles as native localImage paths. Inline, local-file and uploaded artifact images all use the same resolver, including its resize, size limits and recoverable storage.

The native adapter converts resolved image data URLs to Codex `turn/start` image inputs (`type: "image", url: dataUrl`). Text attachments and resource links become explicit text inputs; unsupported file/video media and failed image resolution fail explicitly before spawning Codex or changing a thread. Images never enter logs or get replaced with filename-only placeholders. Existing thread mapping, permission snapshot, cancellation, and continuous versus replayable event delivery stay unchanged. A restored session resumes its original Codex thread, which owns prior multimodal context.

Regression evidence must cover text plus image and image-only turns, several images in order, uploaded artifact and local-image resolution, invalid/unsupported media rejection, persisted user file parts, and image delivery on the resumed native thread. Real runtime acceptance must inspect the Responses image payload through the official Codex binary with a local fixture; no paid inference is necessary.

## Codex automatic subagent preference

The Subagents settings page exposes a global Codex collaboration switch, `codexAutoSubagentsEnabled`, default false. Existing ZCode agent definitions are unchanged. This first implementation provides the global preference; project overrides are not implemented. Off means delegation only when the user or applicable project/skill instructions explicitly request it. On permits proactive delegation for useful independent work, without requiring a child for every turn. This is a behavioral policy, not a permission grant or a hard ban on explicit delegation.

The existing setting service on the executing Host owns the persisted Boolean. UI uses that service's normal update path. Before each native execution, bootstrap requests current Host runtime preferences and snapshots the Boolean for that execution. Desktop and official Web/mobile inputs use that same runtime, so changing the desktop switch affects the next native turn in either client. The official hosted frontend cannot gain the new control from a desktop update. Missing values from older Hosts mean false. Preference lookup failures must fail visibly rather than reuse stale enabled state. An in-flight execution, including async question continuations, retains its original snapshot.

```text
Settings switch -> executing Host setting service (single persisted owner)
  -> next native execute -> session/requestRuntimePreferences (user-execution)
  -> adapter snapshot -> official Codex process + per-turn application context
desktop-continuous / web-remote-replayable -> same admitted runtime and preference
```

The adapter explicitly enables the supported `features.multi_agent` capability in its isolated child. Each `turn/start` supplies the selected policy through application `additionalContext`, keyed by `zcode-codex-subagents`. This preserves configured developer instructions and updates existing threads: Codex 0.166.0 did not refresh the model-visible developer instructions when only `thread/resume.developerInstructions` changed. It does not use deprecated `multiAgentMode`, change reasoning/model/sandbox selection, rewrite Codex home configuration, or alter the user's message. Existing thread ownership, cancellation and no-replay receipts remain authoritative. Regression evidence must cover false-by-default, on/off changes on the same thread, next-execution refresh, instruction preservation, protocol default compatibility, and browser switch persistence/error behavior at mobile and desktop widths.

## Native user questions

Codex `item/tool/requestUserInput` and completed `agentMessage.questions` must project into the existing AskUserQuestion interaction, including clickable options and free-text answers. Plain text is not a substitute for a structured question. Core owns the pending tool, broker registration, PermissionRequested/Resolved events, persistence and continuous/replayable projections. Adapter code only translates native question/answer identities; it cannot infer a choice, auto-approve in full-access mode, or fall back to the ZCode model loop.

Native questions use validated `metadata.source=native-codex` inputs. They may have no options (free text), one or more choices, and multiple distinct questions. Existing ordinary AskUserQuestion limits remain unchanged. Secret questions are explicitly rejected until the UI supports secret entry. Native questions do not use the ordinary optional-question automatic-continue timer. Cancel/decline supplies no invented answers; turn cancellation or connection failure settles and removes pending interactions. Invalid/stale identities and malformed answer payloads fail explicitly.

The shared `interaction/requestUserInput` transport must also accept `questions[].options: []`. Desktop Host validates this reverse request even when V4 supplies the visible question and answer, so acceptance must exercise that Host schema before resolving V4. An empty option list means free-text entry; do not inject a fake choice or infer an answer. Ordinary AskUserQuestion tool limits remain enforced by its separate tool schema. A shared Host contract change requires a rebuilt desktop Host; updating only the CLI while reusing the previous app archive leaves the rejection in place.

The isolated Codex child enables `features.default_mode_request_user_input=true`; without this opt-in Codex 0.166.0 advertises the tool but rejects it internally in Default mode before a client can render a question. This changes question availability only; mode, sandbox and approval snapshots stay unchanged.

```text
Codex structured question -> adapter normalization -> Core persisted AskUserQuestion tool
  -> broker registered -> PermissionRequested -> existing desktop / mobile question buttons
  -> first valid response -> PermissionResolved -> persisted tool answer
  -> matching native RPC response, or turn/steer into the active native turn
  -> if that turn already completed: same-thread continuation within the same Core turn
```

Question waits never occupy the native notification delivery queue. Child activity, text, failures and turn completion continue to project while a question is pending. Core remains the sole broker and persisted interaction owner; the adapter owns only the native delivery tasks for this admitted execution. Both desktop continuous and mobile replayable answers use this same path.

For completed async question messages without a server RPC, explicit answers are delivered immediately with official `turn/steer`, using the current owned thread and required `expectedTurnId`. The adapter validates the acknowledged turn identity. If the native turn has already completed, the answer starts a continuation on that same thread within the admitted Core turn. A steer rejected with the structured invalid-request code may use this continuation only if completion of its exact expected turn has already been observed. Unsupported methods, other rejections, mismatched acknowledgements and uncertain transport failures fail explicitly without resending the answer or replaying the original input. A new native continuation resets the completed state before dispatch.

Pending questions and in-flight answer delivery hold the Core turn, including when the native parent has finished. Already answered async deliveries serialize through their acknowledgements, so a completion-race continuation establishes the owned turn before the next answer chooses its target. Unanswered cards never occupy this delivery chain; blocking native RPC replies are independent. Selecting the default is not submission. Declining sends no async input. Each question and answer settles once; repeated item completions cannot duplicate a card or answer. Cancellation, turn failure and disconnection abort all pending broker waits and await their cleanup. Blocking native questions retain their original RPC response identity and do not create another native turn.

Regression evidence includes option and custom-text submission, multiple question ID mapping, no-option questions, full-access and Plan questions, decline, cancellation, process failure, no response before user action, duplicate/stale native messages, same-thread async continuation, live and replayed interaction state, and actual browser clicks through the existing question UI. The answer-delivery regression additionally covers live notifications while waiting, active-turn steering, exact-turn completion racing a rejected steer, separately answered cards, pending delivery preventing premature completion, and unsupported/mismatched/uncertain acknowledgements without replay. Isolated acceptance with official Codex 0.166.0 and a local synthetic Responses provider verifies a real blocking question reply and an active-turn steer from a controlled Host interaction; the latter reaches the next model request with only one native turn/start. This does not substitute for a new desktop/mobile browser acceptance of these changes.

## Validation

### Native child observation

Native Codex owns child execution. The adapter translates legacy `collabAgentToolCall` spawn identities and official `subAgentActivity` items with `kind: started`, plus child-thread notifications; Core owns durable `subagent_child` session records, transcript parts and standard SubagentSpawned/Message/Stopped facts. The existing V4 projection, composer robot trigger, background directory and read-only child pane consume these facts. No ZCode model loop or second child executor is created. Native spawn tools use the existing `Agent` presentation and exact parentToolCallId pairing.

Official Codex 0.166 with `gpt-6.1-sol` emits the new activity shape for `collaboration.spawn_agent`. Its `id` is the actual spawn call identity, `agentThreadId` establishes the trusted child relation and `agentPath` supplies a display description when no prompt exists. Both item lifecycle notifications share that identity and must not create two children. The completed spawn item stores the same durable launch ACK as the legacy path. Other activity kinds must not create children or generic phantom tool rows. In particular, `kind: completed` is an activity notice without an outcome and may arrive before the child `turn/completed`; only the child turn's authoritative terminal determines success, failure or cancellation. A duplicate started activity cannot reopen a terminal child. Unknown parent/old-turn activity remains excluded.

```text
Codex spawn item -> Core persists child identity -> standard SubagentSpawned
child thread items -> Core child transcript + sequenced child events -> existing child topic
child terminal -> persist final child transcript -> SubagentStopped -> running list updates
desktop continuous / mobile replayable -> same session store and V4 projection
```

Child thread IDs are mapped deterministically within the parent session, with persisted native relations for later follow-up turns. Only children observed through a trusted spawn relation may produce child events; unrelated thread and stale parent-turn notifications are ignored. Per-child native turn/item identity deduplicates notifications. A new child turn reopens the same child session without changing its original spawn tool anchor. Nested children retain their actual parent relation.

### Running child input and tool activity (2026-11-04)

Child task display recognizes the exact `c2a-msg-v1:` UTF-8 Base64 envelope (canonical standard alphabet, with or without padding, at most 1 MiB encoded text). Decode one layer only when publishing the child prompt, each user-message text block, or an Agent card's prompt/description. Malformed Base64, invalid UTF-8, unknown versions and unmarked text remain unchanged. Official execution payloads, rollout reads and persisted native relations keep their original values, so subsequent observations and relation restoration cannot recursively decode a displayed task. Agent launch descriptions prefer the available task prompt over agentPath. Assistant text and tool results are not task envelopes.

The adapter alone produces these display values before Core creates the child title, user part and spawn description. Desktop continuous and mobile replayable delivery consume the same persisted Core facts. This does not rewrite old Core session history. Regression evidence covers the reported `c2a-msg-v1:OTErNzg95aSa5bCR` task, Unicode/multiline input, per-block follow-ups, both spawn shapes, nested cards, relation restoration, malformed envelopes and single-layer decoding across repeated publication.

Verified with the official Windows Codex binary and an isolated local Responses fixture returning the exact encoded spawn message: running parent child label and child input show `91+78=多少`, tool input/results remain live before final text, desktop-continuous and web-remote-replayable snapshots agree, a second tool reaches existing subscriptions, and fresh subscriptions plus cold CLI restart retain readable input without duplicate tools. No paid inference, public relay or physical mobile device was used.

A child must expose its admitted task input and available tool inputs/results while its turn remains in progress, including tool-only work with no assistant prose until the final answer. `turn/started` publishes a running observation; waiting for the first agentMessage is not sufficient. Standard command output deltas update the existing bounded Bash preview through Core ToolCallProgress, without inventing tool completion.

Official Codex 0.166's new `functions.exec` path can omit tool items from live notifications and even from running `thread/read`/`thread/items/list` responses. Its official rollout already contains the executed custom/function calls and results while the child is still running. For these missing facts, the adapter may observe only the rollout path returned by `thread/read` for an already trusted child ID. Resolve and constrain that path to the managed Codex home's sessions directory, read incrementally with bounded buffers, and whitelist actual child user/agent task messages, function/custom calls and their matching results. Do not expose system/developer instructions, hidden reasoning, encrypted content or unrelated thread history. Calls and results keep their official call IDs and are deduplicated with live item facts by the existing child observer. The transport reader owns only its file cursor; Core remains the sole child-session persistence owner.

This is read-only observation of official execution. It must not resume/fork/replay a child, send model input or run a second executor. Periodic reads operate only on current trusted running children, serialize with incoming observations, reject retired turns, and stop on completion, cancellation, failure or disposal. Final available facts are drained before accepting a child terminal. The first persisted child turn should carry its actual available task input; a display path is not a substitute for that input. Missing rollout facts do not manufacture success. Keep the normal agent text path, authoritative child terminals and parent-first completion behavior.

For the new task-message envelope, never assume an `encrypted_content` field is displayable text. Resolve the admitted task from its trusted parent's `collaboration.spawn_agent` call, matching the activity's exact parentToolCallId and reading only its explicit `message` argument. The parent's own official rollout path must satisfy the same ID/path/session-root constraints. Validate rollout identity against `session_meta.id` (the native thread ID); `session_id` can intentionally refer to the root of the whole agent tree. Forked ancestor history cannot supply the current child's task or tool records.

Acceptance must hold a real child in progress after an actual tool result but before any final assistant text, open its V4 topic while running, and verify task input, executed tool input and result are already visible. Verify subsequent tool activity reaches an existing desktop continuous and mobile replayable subscription, refresh/reconnect during work, duplicate-free completion/cold recovery, and cancellation. Browser checks must open actual production child conversation rows rather than a prebuilt text-only output label.

The per-execution native process remains alive until the parent and its observed running children finish. A parent terminal must not kill still-running children. Cancellation interrupts all observed running native turns before closing the connection. Failures and cancellation settle every open child explicitly; no unfinished child is reported as success. Process restart restores persisted child transcripts and ended-directory entries; it does not restart child work. A partial native child without an active parent/child runtime is `lost`, not permanently running. Native child rows expose observation only; do not advertise ZCode's background-task cancel control for an engine it does not own. Child-only approval/questions currently fail closed (decline/no answers); the existing parent question and permission broker remains unchanged.

Regression evidence must cover both official spawn shapes, parallel spawn, real-time child text and tools, child-first and parent-first completion, nested relationships, follow-up reuse, failed spawn, duplicates, foreign-thread exclusion, activity completion before authoritative child completion, cancellation, cold recovery, both V4 client modes, and actual robot-button/directory/detail clicks at desktop and mobile widths. The robot trigger appears while children run and disappears after all finish; persisted spawn rows and ended-directory entries survive completion and reconnection. Real-binary acceptance includes the `collaboration` namespace/model family from the reported failure, an isolated local Responses fixture and no paid inference.

The staged helper execution tests cover stream/final agreement, final-only output, tool persistence, deny/modify decisions and cancellation. Core Vitest regression cases exercise the actual runtime with a modelFactory that throws if called. Missing source packages or dependency declarations must be reported separately from a verified full CLI typecheck. Before release run CLI typecheck/lint, affected Core/adapter tests, architecture checks, and desktop plus mobile replay/approval/cancellation acceptance.
