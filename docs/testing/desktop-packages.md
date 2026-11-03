# ZCode-Codex desktop packages

The repository's manual **Desktop packages** GitHub Actions workflow builds the integration branch with Node.js 24.14.0 and pnpm 10.33.2. It uses native Windows x64, macOS Intel x64, macOS Apple Silicon arm64 and Linux x64 runners. Other source-supported architectures are outside this initial automated matrix.

Each job uses the existing `pnpm bundle:desktop` entry, including runtime preparation, desktop/Host/renderer build, packaging and the entry's dependency/size checks. It must not reuse a previously installed desktop archive or copy native assets between operating systems. Production backend configuration and `ZCODE_PREVIEW_IDENTITY=1` produce a Preview application identity that can coexist with the production application. This does not migrate existing user data, rename the application to match the GitHub repository, or isolate it from other Preview installations. Official Codex remains separately installed on the executing computer.

Windows runners must resolve the native System32 `tar.exe` before Git Bash's GNU tar: GNU tar interprets a cross-drive cache path such as `D:/...` as a remote host and fails while extracting bundled npm. Copy only `tar.exe` into a temporary tools directory and prepend that directory; prepending all of System32 also selects its WSL `bash.exe` and breaks Bash steps. Dependency lifecycle scripts run serially to reduce competing native/postinstall work in the hoisted workspace. The initial Linux dependency installation failed with a pnpm temporary-directory rename error; a successful subsequent run is required before claiming Linux packages exist.

Successful jobs upload installers/archives and a SHA256 manifest as Actions artifacts for 14 days. A missing installer is a failure. Failed targets do not prevent independent targets from completing. The workflow does not publish to upstream/CDN feeds, automatically update installed apps, or create a GitHub Release. Published downloads require a separate release containing actual successful artifacts. The initial builds are unsigned and macOS artifacts are not notarized.

The separate manual **Publish desktop preview** workflow promotes one target from an existing run into the existing `v3.17.1-codex.1` prerelease. It downloads only matching artifacts from this repository, verifies their SHA256 manifest, and uploads installers plus a target-specific manifest. It refuses a non-prerelease destination and does not overwrite existing assets. Only this publishing job receives `contents: write`; it does not rebuild, move the release tag, change application update feeds, or install anything. Review the source run before dispatching. This avoids routing large release files through a developer's local network.

It may be dispatched while the source run is still active: it waits up to 30 minutes for the chosen artifact, then fails if the run finishes without it or the wait expires. Missing/failed targets are never published as successful. Windows x64 was packaged locally from the previously validated complete desktop; both macOS architectures were built in run `41642627089` and promoted through checksum-verifying jobs. Linux x64 succeeded in retry run `41645155986`; all four formats were published by run `41647422026` after SHA256 verification. Windows/macOS/Linux packages are available in the preview release. Windows hosted-runner failures are not reported as successful CI builds: the published Windows installer comes from the local packaging run. macOS/Linux runtime acceptance on real desktops remains unperformed, and Windows/Linux arm64 packages are not published.

## Run and download

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
