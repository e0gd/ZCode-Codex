# Native Codex execution

An explicitly configured exact local workspace may execute turns through the official Codex app-server. Other workspaces retain their existing engine. This is an execution backend, not a model provider: opted-in turns must never enter ZCode model creation, model loops, title generation or memory-model requests.

The existing ZCode runtime remains the sole owner of accepted inputs, queue admission, foreground execution cancellation, event persistence and v4 projections. The Codex adapter owns its child process, JSON-RPC request correlation and durable mapping from ZCode session ID to Codex thread ID. A resumed session reuses its mapped thread; failures must not silently fork a new thread. Configuration selects an exact canonical workspace path, never a directory basename.

The runtime injects a typed NativeTurnExecutor port. The adapter emits ordered assistant/tool observations through the awaited callback and requests approval through an awaited runtime callback. No adapter may automatically grant approval. Cancellation propagates through AbortSignal to Codex turn interrupt; stale notifications from another thread/turn cannot mutate the active ZCode turn. Thread mappings contain no credentials.

Admission precedes TurnStarted and persisted user input; native events precede TurnComplete or the existing failure/cancellation outcome. Existing inputId = commandId idempotency, Host owner/lease checks, workspaceIdentity binding and stale runtime generation checks remain authoritative. Desktop continuous and mobile replayable delivery both consume the same existing projection. No second mobile Agent or relay state store is created.

Initial scope is text turns, streamed assistant output, explicit approval, cancellation and resume. Unsupported attachments/operations fail explicitly rather than invoking the old model engine. Native guide input must queue until an explicit steer implementation exists.

Acceptance: exact selected workspace uses Codex; similarly named and unrelated workspaces do not; modelFactory is never called for a native turn; two turns reuse one mapped thread; denied approval is denied remotely; cancel interrupts current remote turn; stream and persisted assistant text agree; mobile replay produces one user input and one final assistant result; original engine remains unchanged without an injected executor.

The adapter starts an official app-server per admitted turn and resumes its persisted thread. Its exclusive session lock fails closed after an unreconciled process crash; an operator must inspect the mapped thread before clearing a stale lock. Input receipts prevent automatically replaying uncertain dispatches. Tool user-input requests are not part of the initial port and fail visibly; unsupported interaction must never be treated as permission.

Optional reviewed skills roots are registered at each app-server initialization. Existing ZCode-hosted skills and MCP are not imported wholesale: portable skill discovery and standalone documents MCP handshake have been verified separately, but host-only viewers and workflows require additional integration.

This branch applies the executor directly to the pinned upstream source tree. Its migration and verification status is documented in [NATIVE_CODEX.md](../../NATIVE_CODEX.md); protocol tests do not replace desktop and mobile acceptance.

## Optional reviewed MCP overrides

`ZCODE_CODEX_MCP_OVERRIDES_JSON` optionally supplies a JSON array of alternating `"-c"` and `"mcp_servers.<server>.<setting>=<value>"` strings. Supply only reviewed, independently configured MCP settings; this branch does not ship the external experiment's documents preset helper or discover default plugins. The parsed array maps to `NativeCodexOptions.configOverrides` and is passed directly as app-server arguments with `shell: false`. Neither live Codex configuration nor installed plugins are edited.

Both the environment factory and direct executor validate override shape: complete pairs only, exact `-c` flags, string values, and the `mcp_servers\.[A-Za-z0-9_-]+\.` namespace with an explicit setting assignment. Provider, sandbox, approval-policy, and other top-level settings are rejected before process launch. Omission leaves startup unchanged. Acceptance tests cover documents arguments reaching spawn unchanged, empty/omitted configuration, malformed/non-string pairs, and rejection of provider/sandbox overrides. This transport addition uses local mock/type/lint checks; it does not repeat paid model calls.

## Provider thread compatibility

Thread provider identity is a separate compatibility invariant from the selected model provider. Existing v1 saved thread maps omit provider metadata, and existing Codex threads may have either `zcode_api` or `zcode_selected` identity. Read only the mapped thread's Codex metadata and validate its ID, canonical workspace and safe `modelProvider`; fail closed if any are missing or inconsistent. Codex 0.166 requires the app-server's startup provider to match the resumed thread, so if it differs, close the metadata-only process and initialize one with the exact saved alias before resuming. Each process configures both aliases to the current turn's resolved endpoint and credential. New threads use stable `zcode_api`. The metadata-only restart happens before input receipt or turn dispatch; never fork or replay a turn after an unknown error. RPC failures expose only the method and integer error code, never upstream message/data; malformed responses are distinct.
