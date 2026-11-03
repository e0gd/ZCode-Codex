# Native Codex executor

This CLI integration selects the execution engine for each session from its owning project's immutable setting, defaulting to ZCode. The official Codex app-server owns its complete model/tool loop for Codex projects. ZCode retains its existing command admission, foreground cancellation, session persistence and desktop/mobile event projection. See the [project engine specification](../../../../../docs/specs/project-execution-engine.md) and [cross-host execution contract](../../../../../docs/runtime-tools/native-codex-executor.md) for ownership, crash reconciliation and acceptance requirements.

## Project engine selection

The existing Host runtime-materialization preferences response carries the engine resolved from authoritative task/project membership. Bootstrap passes it as a per-session app option; explicit `zcode` disables the native executor even when old environment opt-ins are present. `codex` locates the separately installed official executable and prepares an isolated home without requiring `ZCODE_CODEX_WORKSPACE`. Same-directory projects must remain independent; child session materialization inherits the parent engine. Cold restoration reuses the Host project decision. Missing Codex or incompatible providers fail visibly without falling back. No engine setting is accepted from ordinary sendText payloads and no process-global engine is introduced.

The environment factory below remains a compatibility entry for standalone experiments without a Host-selected engine. It is not the normal project selection path.

## Configuration and precedence

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

Initial acceptance covers exact-workspace isolation, no ZCode modelFactory calls, thread reuse, explicit denial, cancellation, event order, cold tool/text persistence, no fallback after errors and consistent live/replay output. Attachments and unsupported interactions are explicitly unsupported. Native guide input is not consumed by a ZCode loop. Session forks, rewind and project-memory/model side jobs require separate native capability integration before being represented as supported.

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

## Validation

The staged helper execution tests cover stream/final agreement, final-only output, tool persistence, deny/modify decisions and cancellation. Core Vitest regression cases exercise the actual runtime with a modelFactory that throws if called. Missing source packages or dependency declarations must be reported separately from a verified full CLI typecheck. Before release run CLI typecheck/lint, affected Core/adapter tests, architecture checks, and desktop plus mobile replay/approval/cancellation acceptance.
