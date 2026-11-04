# Codex subscription settings presentation

The Settings Environment's existing `IZCodeTaskService.codexAccount` owns account commands. This module keeps only a disposable UI projection of its safe state and never stores tokens, edits provider configuration, or starts an independent agent. It reads the injected settings service without resolving the currently active project. An absent local cwd is obtained from the injected file service.

`CodexSubscriptionCard` renders official device login, cancel, refresh and logout, safe account labels, and the read-only official catalog. Only the exact HTTPS OpenAI device authorization page can be opened. Official model IDs and supported efforts are displayed without editable connection/metadata fields or entitlement promises.

Read on mount; serialize UI mutations; poll only an existing pending login; stop polling on unmount. Request generation and owner/context checks reject obsolete responses. Desktop and updated Web use the same injected owner contract. Remote transport leases remain enforced by the existing Host route. Failures are fixed localizable copy, never raw RPC errors. Mutations and malformed legacy-client writes remain the Host owner's responsibility.
