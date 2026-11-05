# ZCode-Codex desktop packages

The repository's manual **Desktop packages** GitHub Actions workflow builds the integration branch with Node.js 24.14.0 and pnpm 10.33.2. It uses native Windows x64, macOS Intel x64, macOS Apple Silicon arm64 and Linux x64 runners. Other source-supported architectures are outside this initial automated matrix.

Each job uses the existing `pnpm bundle:desktop` entry, including runtime preparation, desktop/Host/renderer build, packaging and the entry's dependency/size checks. It must not reuse a previously installed desktop archive or copy native assets between operating systems. Production backend configuration and `ZCODE_PREVIEW_IDENTITY=1` produce a Preview application identity that can coexist with the production application. This does not migrate existing user data, rename the application to match the GitHub repository, or isolate it from other Preview installations. Official Codex remains separately installed on the executing computer.

## Standard installer defaults

Public installers preserve the original ZCode user and project paths. A normal launch keeps the operating system user's `HOME` / `USERPROFILE`; existing explicit environment or data-directory overrides keep their existing precedence. ZCode continues to read its MCP configuration under `~/.zcode`, user skills in `~/.zcode/skills` and `~/.agents/skills`, and configuration/skills at the original project paths. Here `~` belongs to the computer executing the session. The package must not include or automatically enable a machine-specific portable launcher that redirects these paths to an independent `Data` directory.

Preview identity changes the installed application identity, Electron profile (`ZCode Preview` rather than `ZCode`) and Preview Helper component directory. It does not redirect the system user home or isolate the global `.zcode` business data. New projects and existing projects without an engine selection default to ZCode; projects created with Codex retain that engine.

Codex uses its own managed home at `<ZCode data base>/.zcode/codex-home`; the user's separate Codex installation keeps its configuration. **Sync MCP with ZCode** and **Sync skills with ZCode** are independent and default off. Users may enable them and select resources under **Settings → Agent capabilities → Codex integration**. Sharing the original ZCode discovery paths does not implicitly synchronize those resources into Codex. Automatic Codex subagent delegation also remains off by default. Resource choices follow the [Codex resource specification](../specs/codex-resources.md).

Release acceptance must inspect the packaged entry and compiled defaults: no bundled home/data-redirection launcher; original user/project discovery paths; a separate Codex managed home; both resource-sync switches and automatic delegation initially off. Verify selected synchronization on a later turn without modifying the original MCP configuration, skill files or separate Codex configuration. These requirements describe the expected package behavior; they are not a claim that a clean-machine installation has passed.

## Build and publication

Windows runners must resolve the native System32 `tar.exe` before Git Bash's GNU tar: GNU tar interprets a cross-drive cache path such as `D:/...` as a remote host and fails while extracting bundled npm. Copy only `tar.exe` into a temporary tools directory and prepend that directory; prepending all of System32 also selects its WSL `bash.exe` and breaks Bash steps. Dependency lifecycle scripts run serially to reduce competing native/postinstall work in the hoisted workspace. The initial Linux dependency installation failed with a pnpm temporary-directory rename error; a successful subsequent run is required before claiming Linux packages exist.

Successful jobs upload installers/archives and a SHA256 manifest as Actions artifacts for 14 days. A missing installer is a failure. Failed targets do not prevent independent targets from completing. The workflow does not publish to upstream/CDN feeds, automatically update installed apps, or create a GitHub Release. Published downloads require a separate release containing actual successful artifacts. The initial builds are unsigned and macOS artifacts are not notarized.

The separate manual **Publish desktop preview** workflow promotes one target from an existing run into the explicitly selected `release_tag` prerelease. The destination must match `v<version>-codex.<number>`, already exist as a prerelease, and resolve to the same commit as the source package run. It downloads only the exact platform-and-commit artifact from this repository, verifies its SHA256 manifest, and uploads installers plus a target-specific manifest. It refuses a non-prerelease destination, a mismatched source commit, and existing asset names. Only this publishing job receives `contents: write`; it does not rebuild, move the release tag, change application update feeds, or install anything. Review the source run before dispatching. This avoids routing large release files through a developer's local network.

Publication order: maintainer pushes source → package workflow owns immutable platform/commit artifacts → maintainer creates a draft prerelease tag at that commit → publishing workflow validates destination and checksums → maintainer publishes the release after checking the actual assets. Retrying an upload cannot silently replace an existing asset. A newer release must never reuse an older build as if it contained newer features. Engineering acceptance checks the manual inputs, destination validation, exact artifact selector, and no-overwrite upload; dispatched builds provide the actual packaging evidence.

After verifying the artifact manifest, publishing normalizes package filename spaces to dots before upload and rewrites only manifest filenames, preserving every verified digest. Names must contain only ASCII letters, digits, dots, underscores and hyphens, and normalization must not collide. GitHub normalizes spaces in uploaded asset names; leaving the artifact manifest unchanged would make downloaded checksum files refer to missing local names. Acceptance executes the publication script with spaced filenames and checks both upload arguments and resulting manifest entries. Public manifest entries must match actual Release asset names and server digests.

It may be dispatched while the source run is still active: it waits up to 30 minutes for the chosen artifact, then fails if the run finishes without it or the wait expires. Missing/failed targets are never published as successful. Windows x64 was packaged locally from the previously validated complete desktop; both macOS architectures were built in run `41642627089` and promoted through checksum-verifying jobs. Linux x64 succeeded in retry run `41645155986`; all four formats were published by run `41647422026` after SHA256 verification. Windows/macOS/Linux packages are available in the preview release. Windows hosted-runner failures are not reported as successful CI builds: the published Windows installer comes from the local packaging run. macOS/Linux runtime acceptance on real desktops remains unperformed, and Windows/Linux arm64 packages are not published.

## Run and download

### Preview 4 (2026-11-05, pending publication)

The planned release is `v3.17.1-codex.4`. Its Windows x64 complete NSIS installer is expected to be named `ZCode-Codex-3.17.1-preview.4-win-x64.exe`. The [planned installer URL](https://github.com/e0gd/ZCode-Codex/releases/download/v3.17.1-codex.4/ZCode-Codex-3.17.1-preview.4-win-x64.exe) is reserved for that release and is not evidence that an asset is available. At this documentation stage, Preview 4 has not been published; no installer size, source commit or SHA256 digest is claimed. Preview 3 Windows and Preview 2 macOS/Linux downloads below remain the published historical packages.

Preview 4 is intended to include the following changes, in addition to Preview 3:

- Preserve the standard installer defaults above, including original ZCode MCP/skill discovery and independent, initially disabled Codex synchronization.
- Select MCP servers and skills independently for Codex, with retained per-resource choices and independently collapsed, internally scrolling lists.
- Keep enabled packages selectable when their MCP dependencies are incompatible, disabled or unsynchronized, while naming unavailable dependencies in a non-blocking warning. Invocation does not enable missing MCP servers.
- Identify rejected MCP configuration by a bounded, escaped server name and a specific reason without exposing configuration values.
- Bound pending Codex notification delivery by count and bytes, failing explicitly on overflow without replaying the input. Recover an abandoned process lock only when both its recorded owner and native children are confirmed absent; an uncertain lock remains blocked.

Publication requires a fresh complete package from the final committed source. Record that immutable source commit, successful bundle gates, exact installer size, local SHA256, matching Release asset digest and matching public manifest filenames after the actual build/upload. Do not reuse the Preview 3 installer or a machine's portable launcher as Preview 4. Record platform build results and runtime acceptance separately; no new macOS/Linux or arm64 package availability is asserted here.

### Preview 3 (2026-11-04)

Preview 3 (`v3.17.1-codex.3`) packages source commit `c462acd52ccafae5418df51c679d212aff80f03e`, including summarized session titles (`c40d750a`), readable encoded child input/labels/cards (`12d30272`) and desktop browser OAuth (`01a569d0`). Later documentation commits do not change the package's source identity.

Windows x64 was rebuilt locally through the complete `pnpm bundle:desktop -- --os win --arch x64` entry into a new `dist-preview3` directory. The entry exited successfully; runtime dependency, platform closure and installer size gates passed. The published complete NSIS installer `ZCode-Codex-3.17.1-preview.3-win-x64.exe` is 198,640,213 bytes, SHA256 `cbd7d82c07a31a800b0cd49df788563ee94378e41db9fa3165107d9ee0edf949`. Its bundled CLI SHA256 is `64bdcfbe2b6aab25aa38ddf9ec7d2698e05293e741d3ba8281a3ec8994869b85`; build metadata identifies `c462acd5`. The compiled CLI and renderer contain all three fixes. The executable's seven 16/24/32/48/64/128/256 px, 32-bit icon frames match the source icon. No installed-user archive or custom portable launcher was used as packaging input.

The [Preview 3 release](https://github.com/e0gd/ZCode-Codex/releases/tag/v3.17.1-codex.3) currently contains the Windows installer and `SHA256SUMS-win-x64.txt`. GitHub's installer digest matches the local checksum; the publicly downloaded manifest names the actual asset and matches that server digest. Root typecheck passed; root lint passed with 83 warnings and no errors. Clean-machine Windows installation, real ChatGPT authorization and subscription inference remain unverified. Packages are unsigned.

The four-platform source build was dispatched as [run 41814005983](https://github.com/e0gd/ZCode-Codex/actions/runs/41814005983), but remained queued without any assigned jobs at publication time. The Windows package is therefore local build evidence, not a successful hosted-runner result. New macOS/Linux packages are not yet published; the older Preview 2 packages below remain available and do not contain the three Preview 3 fixes. Only actual successful artifacts may later be promoted to Preview 3, with the same source-commit and checksum checks. macOS/Linux desktop runtime acceptance remains unperformed.

### Preview 2 history

Preview 2 (`v3.17.1-codex.2`) packages source commit `762d2c119d3a42e4c3bf5f12a1c6f390cafa393e`. Windows x64 was rebuilt locally with the full `pnpm bundle:desktop -- --os win --arch x64` entry and a clean `dist-preview2` output; runtime dependency and size gates passed. Its complete NSIS installer is 198,633,009 bytes, published as `ZCode-Codex-3.17.1-preview.2-win-x64.exe`, SHA256 `c23a1a9708ef58e07c7aadc519153920a8193ce0be0590162623b1a2ab43b362`. GitHub's asset digest matched the local checksum and the public download returned HTTP 200. The bundled CLI SHA256 matches the final live-child-tool validation build (`dadf84970b784d0e080e9e23f3a45defcff03c621cfdf8d17b4e20d6f23263d1`). No installed-user archive or local launcher was used as packaging input. The Windows job in source run `41757143302` failed on GNU tar's cross-drive archive handling despite the PATH workaround; it is not CI build evidence for the published EXE. The other platform jobs and checksum-verifying promotions must be checked separately in that run and the Release's actual attachments.

Both macOS targets and Linux x64 succeeded in run `41757143302`. Publishing runs `41757272363` (macOS arm64), `41757276591` (macOS x64) and `41757280529` (Linux x64) succeeded. Preview 2 now provides all nine expected package files across four targets, plus four platform manifests. The initial macOS/Linux public manifests were corrected to use GitHub's actual dotted filenames; package bytes and SHA256 digests did not change. Public manifest entries were independently compared with Release asset names and server digests. Actual desktop runtime acceptance on macOS/Linux and clean-machine Windows installation remain separate and unperformed.

1. Open this repository's Actions tab and enable Actions for the fork if GitHub requests it.
2. Select **Desktop packages**, then **Run workflow** on `native-codex`.
3. Wait for each target's result. Download `ZCode-Codex-<os>-<arch>-<commit>` artifacts from that run.
4. Check the included SHA256 manifest before installation. A completed package build is not evidence of runtime or live-provider acceptance on that OS.

| Target | Expected files |
| --- | --- |
| Windows x64 | `.exe` |
| macOS arm64 / x64 | `.dmg`, `.zip` |
| Linux x64 | `.AppImage`, `.deb`, `.rpm`, `.pkg.tar.zst` |

Before committing changes to this workflow, parse its YAML and verify runner/OS/architecture agreement, manual-only triggering, read-only repository permissions, the existing bundle entry, upload failure on missing files, and checksum generation. A real dispatched run supplies the build evidence; record failed jobs as failed rather than advertising their packages as available. Runtime acceptance remains a separate step on each system.
