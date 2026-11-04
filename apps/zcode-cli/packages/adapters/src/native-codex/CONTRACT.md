# Native Codex adapter

The public index provides binary discovery, independent ZCode home resolution, the
official-turn executor and a lazy managed ChatGPT account controller. Core owns turn
admission, input identity, permissions and projections. The account controller alone
owns its serial command queue, official process and pending device login. Credentials
are held by the official Codex file credential store in ZCode's independent home.

`command` accepts read, refresh, login, cancel and logout. Returned state contains only
the safe shared account/catalog schema. Repeated read observes pending authorization;
it never begins another login. Catalog publication goes through the injected existing
provider write owner. Protocol failures invalidate the visible catalog and expose a
fixed error. Pending login completion is correlated with login ID/generation; timeout,
cancel and disposal retire stale callbacks. Official device URLs are allowlisted.

Login accepts an explicit browser or device-code method; omission preserves device
authorization. Both use the same official account owner and correlated lifecycle.
Only the shared validated official browser OAuth URL and its local loopback redirect
cross the boundary, without rewriting parameters. Device-code acquisition failure
uses the fixed `device-auth-unavailable` category, never a raw server error. Browser
login does not automatically fall back, open a browser, execute a task or switch auth.

Each turn resolves and snapshots its exact API or subscription configuration. The
subscription process removes inherited API credentials, uses the official OpenAI
provider, checks the managed account and discovered model/effort before dispatch.
Known cross-authentication thread resumes fail before dispatch with a new-task hint;
existing thread mappings and history are preserved, and no input is replayed or forked.

The optional `generateTitle` port samples an exact completed native thread/turn using
the frozen original model selection and authentication source. It accepts a correlated
trace context and abort signal. It validates the trusted mapping, resumes that same
thread and calls official `thread/sample` with MCP disabled; it never creates a new
thread, turn, input receipt, user message or tool execution. Empty or attempted-tool
samples return null. Source mismatch, unsupported sampling, authentication failure,
timeout and cancellation reject safely without provider fallback or input replay.
The sampling connection holds the same session `active.lock` as foreground execution.
A new foreground execute on this executor cancels its pending title and awaits
connection/lock cleanup first; external active locks cause title sampling to skip.
Only one title operation can exist per executor, with a 60-second maximum lifetime.

Both desktop continuous and mobile replayable clients use the same account owner and
existing Host/CLI command boundary. No browser credential store is introduced. See
`docs/specs/codex-chatgpt-subscription.md` for product behavior and acceptance.

Native child execution stays in official Codex. The same transport observer accepts
legacy spawn tool items and official `subAgentActivity` started items, whose item ID
anchors the existing Agent row and whose thread ID establishes the child relation.
Only active trusted parent items establish children. Other activity kinds are not
turn outcomes; child turn terminals remain authoritative. Core alone persists child
sessions and emits existing product facts for desktop continuous and mobile replay.

Child turn start publishes immediately. For official versions that omit custom tool
items from live notifications, the adapter incrementally reads only an already
trusted child's official rollout path, bound through thread/read and constrained
to the managed sessions directory. Explicit parent spawn message arguments provide
the task input; function/custom call IDs pair visible inputs and results. Instructions,
reasoning and encrypted content are excluded. Reads serialize with native messages,
wait for the child's turn identity, drain before its terminal and stop on disposal.
Core's existing child writer persists these facts and exposes bounded running Bash
output through the existing ToolCallProgress contract.

The observer decodes one valid `c2a-msg-v1:` UTF-8 Base64 layer at its display
publication boundary: child prompts, individual user text blocks and Agent card
prompts/descriptions. Invalid, unknown and unmarked text stays unchanged. Original
native relations and execution arguments remain untouched; restoration republishes
through the same boundary without recursive decoding. Core persists the resulting
display values for both desktop continuous and mobile replayable clients. Existing
Core history is not rewritten. See the native executor spec for bounds and evidence.
