# ZCode-Codex desktop packages

The repository's manual **Desktop packages** GitHub Actions workflow builds the integration branch with Node.js 24.14.0 and pnpm 10.33.2. It uses native Windows x64, macOS Intel x64, macOS Apple Silicon arm64 and Linux x64 runners. Other source-supported architectures are outside this initial automated matrix.

Each job uses the existing `pnpm bundle:desktop` entry, including runtime preparation, desktop/Host/renderer build, packaging and the entry's dependency/size checks. It must not reuse a previously installed desktop archive or copy native assets between operating systems. Production backend configuration and `ZCODE_PREVIEW_IDENTITY=1` produce a Preview application identity that can coexist with the production application. This does not migrate existing user data, rename the application to match the GitHub repository, or isolate it from other Preview installations. Official Codex remains separately installed on the executing computer.

Windows runners must resolve the native System32 `tar.exe` before Git Bash's GNU tar: GNU tar interprets a cross-drive cache path such as `D:/...` as a remote host and fails while extracting bundled npm. Dependency lifecycle scripts run serially to reduce competing native/postinstall work in the hoisted workspace. The initial Linux dependency installation failed with a pnpm temporary-directory rename error; a successful subsequent run is required before claiming Linux packages exist.

Successful jobs upload installers/archives and a SHA256 manifest as Actions artifacts for 14 days. A missing installer is a failure. Failed targets do not prevent independent targets from completing. The workflow does not publish to upstream/CDN feeds, automatically update installed apps, or create a GitHub Release. Published downloads require a separate release containing actual successful artifacts. The initial builds are unsigned and macOS artifacts are not notarized.

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
