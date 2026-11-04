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

Each turn resolves and snapshots its exact API or subscription configuration. The
subscription process removes inherited API credentials, uses the official OpenAI
provider, checks the managed account and discovered model/effort before dispatch.
Known cross-authentication thread resumes fail before dispatch with a new-task hint;
existing thread mappings and history are preserved, and no input is replayed or forked.

Both desktop continuous and mobile replayable clients use the same account owner and
existing Host/CLI command boundary. No browser credential store is introduced. See
`docs/specs/codex-chatgpt-subscription.md` for product behavior and acceptance.

Native child execution stays in official Codex. The same transport observer accepts
legacy spawn tool items and official `subAgentActivity` started items, whose item ID
anchors the existing Agent row and whose thread ID establishes the child relation.
Only active trusted parent items establish children. Other activity kinds are not
turn outcomes; child turn terminals remain authoritative. Core alone persists child
sessions and emits existing product facts for desktop continuous and mobile replay.
