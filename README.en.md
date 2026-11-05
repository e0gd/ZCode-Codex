# ZCode-Codex

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="ZCode" width="128" height="128" />
</div>
<p align="center">
  <a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=47ag983c-8fcb-4d6d-814b-5395193a712c&amp;qr_code=true">Feishu community</a> ·
  <a href="https://discord.gg/z9aBcQXZQ3">Discord</a>
</p>
<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

ZCode-Codex integrates Codex into the [ZCode](https://github.com/zai-org/ZCode) AI coding workspace, preserving native ZCode features while making official Codex available through the ZCode interface. Install the Codex CLI separately; ZCode locates and starts it. This repository includes the desktop client, Web interface, shared UI and Agent CLI source.

The development branch is `native-codex`; `main` preserves the upstream baseline. New projects default to ZCode; choosing Codex at creation fixes that project's sessions to Codex. Existing projects default to ZCode. Codex supports OpenAI Responses API key providers configured in ZCode and ChatGPT subscription login through Manage Models, without per-project environment variables. Subscription login and live child output are included in `v3.17.1-codex.2`; the subsequent title, encoded-input and browser-login fixes are included in the Windows `v3.17.1-codex.3` package.

## Project strengths

Codex integrates with ZCode's existing projects, sessions and interactions, so users can keep working in the familiar workspace:

- **Choose ZCode or Codex per project**: New projects default to ZCode, with Codex available at creation. Both project types coexist in one client. The execution method is fixed after creation; existing projects keep using ZCode.
- **Manage authentication and models in ZCode**: Codex uses the API provider, model and reasoning level configured in ZCode, or ChatGPT subscription login through a dedicated entry. Official Codex manages subscription credentials separately from API provider configuration. The two sources remain distinct and never switch automatically.
- **Continue the same session on desktop and Web/mobile**: Create a Codex project in the modified desktop, then continue from the official Web/mobile frontend connected to that desktop. New tasks inside that project also use Codex. The official frontend cannot currently create Codex projects or change this fork's new settings; see [Web/mobile limitations](#official-webmobile-limitations).
- **Follow subagent progress**: Codex child agents use the existing status rows, composer robot button, background list and read-only child-session view. The desktop provides an automatic-delegation switch, off by default; saved changes apply on the next turn to both desktop and connected Web/mobile sessions. It controls delegation policy, not concurrency; see [subagent collaboration](#enable-parallel-codex-subagents).
- **Use familiar input and confirmation flows**: Text, images, tool approvals and structured questions appear through ZCode's existing interface. Choice questions show buttons; free-text questions show an input field and wait for an explicit answer.
- **Keep Codex configuration separate**: ZCode locates and starts the separately installed official Codex CLI when needed, using isolated data and configuration without overwriting the user's existing Codex configuration or credentials.

See [usage and limitations](NATIVE_CODEX.md) and [validation evidence](docs/testing/native-codex-validation.md). This community fork is maintained separately from upstream ZCode and official OpenAI releases.

## Installation and platforms

Install the [official Codex CLI](https://github.com/openai/codex) separately, configure a compatible provider and model in ZCode or sign in with ChatGPT, then select **Execution engine → Codex** when creating a project. Projects using ZCode do not require Codex.

### Standard installation paths

Public standard installers preserve the original user and project paths. A normal launch uses the operating system user's `HOME` / `USERPROFILE`, reads the original MCP configuration under `~/.zcode`, user skills in `~/.zcode/skills` and `~/.agents/skills`, and configuration/skills at the original project paths. Here `~` belongs to the computer executing the session; existing explicit environment or data-directory overrides retain their precedence. The installer does not enable a machine-specific portable launcher that redirects these paths to an independent `Data` directory.

The **ZCode Preview** identity allows installation alongside the original and separates Electron profile data and Helper components; it does not isolate global `.zcode` business data. New projects and existing projects without an engine selection default to ZCode; Codex projects retain their chosen engine. Codex uses a separate managed home at `<ZCode data base>/.zcode/codex-home`, preserving the separately installed Codex's configuration. Both Codex **Sync with ZCode** switches default off and can be enabled manually below. Keeping original ZCode paths does not automatically synchronize those resources into Codex.

### Create a Codex project

1. Open this fork's desktop client containing the required feature and configure an OpenAI Responses-compatible API provider, API key and model in ZCode, or sign in with ChatGPT as described below.
2. Open **Create project**, enter the project details and choose its directory.
3. Change **Execution engine** from the default **ZCode** to **Codex**, then save.
4. Create a task in that project and send a message. ZCode locates and starts the separately installed official Codex CLI when needed; that project's sessions execute through Codex.

The execution method is fixed after creation. Existing ZCode projects cannot be converted by editing them; create a Codex project instead. Updating the client does not convert old projects.

### Use a ChatGPT subscription

Open **Settings → Manage Models → ChatGPT subscription (Codex)**. The `v3.17.1-codex.3` desktop offers official browser login by default: click Sign in through browser, then open the authorization page to complete login. A separate device-code option remains available; updated Web uses device codes. A device-code request can fail even when Codex is installed (HTTP 403 was reproduced locally). Older `.2` packages do not include browser login.

After signing in, open a Codex project and select the **ChatGPT subscription** group and a model in the model selector. The catalog comes from official Codex; listing a model does not guarantee account quota or server permission. Rejections remain visible and never trigger a switch to API billing. If the official page returns `unsupported_country_region_territory`, OpenAI has rejected the current access region; a ZCode change cannot remove that restriction. Browser authorization startup, polling, cancellation and retry have been verified; actual account authorization and subscription inference have not been established.

Subscription model IDs, authentication, service addresses and capability definitions are read-only. The computer rejects incompatible edits from an older Web client and preserves the configuration. Choosing another subscription model or supported reasoning level applies to subsequent inputs; an executing response keeps its existing configuration. Official Codex 0.166 cannot resume an existing thread across API and subscription authentication sources. To switch sources, create a new task in the same Codex project; the original task and history remain intact.

The current official website has no new subscription login card. Sign in on the modified desktop first, then continue an existing subscription task from the official website. Whether the older frontend recognizes the new model catalog depends on client compatibility; it cannot edit subscription definitions. The updated source Web UI can manage login through the same Host but requires a separate deployment.

Subscription login and live child-tool output require `v3.17.1-codex.2` or newer; older packages do not gain these changes automatically. Real-account browser authorization and subscription inference still require acceptance testing.

### Enable parallel Codex subagents

In the modified desktop, open **Settings → Agent capabilities → Subagents → Codex collaboration** and enable **Automatically delegate to subagents**.

It defaults off. Enabling it lets Codex delegate independent work when useful; it does not set a concurrency count or guarantee agents on every turn. With it off, explicit instructions can still request delegation, for example: “Spawn two subagents to review the frontend and backend separately.” The saved setting applies on the **next turn** to Codex sessions executing on that computer, including connected Web/mobile sessions. Click the composer's **robot button** to view background agents and open their read-only child-session details.

### Codex MCP and skill sources (Preview 4)

Open **Settings → Agent capabilities → Codex integration**. MCP and skills have independent **Sync with ZCode** switches, both off by default. With sync off, enter an absolute Codex TOML file path for MCP, or absolute skill directories, one per line. Blank values retain native discovery in Codex's managed home; the separate Codex installation is unchanged. Only the TOML file's MCP section is imported.

With MCP sync on, a service list appears. Compatible, enabled and trusted entries default on and can be unchecked; incompatible entries are automatically off with a reason and no longer block the conversation. Skill sync also shows a selectable list with names, sources and paths: enabled skills default on, disabled skills remain off, and same-name skills are controlled independently by path. Turning synchronization off retains selections. Selection affects only Codex, preserving ZCode's MCP and skill enabled state. Internal ZCode host tools are excluded. Custom paths remain saved but are ignored. This projects resources at runtime without copying files or overwriting either configuration. Save changes to apply them on the next turn; in-flight replies retain their snapshot. Paths belong to the executing computer. Compatibility checks configuration support, not connection success; invalid custom paths and real connection failures still report errors. A skill still requires its tools to be available to Codex.

MCP and skill lists start collapsed independently. Click each list heading to expand or collapse it and see its resource count. Expanded lists scroll internally so long catalogs keep **Save changes** reachable. Collapsing preserves selections.

Existing Codex sessions show selected available skills in the skill picker. Packages remain selectable and invocable when their MCP dependencies are incompatible, disabled or unsynchronized, with a description warning naming the unavailable MCP servers. Dependent actions may still be unavailable; selecting a package does not enable its MCP. Disabled packages remain hidden and name conflicts remain unselectable. Standard ZCode sessions keep their existing lists. The executing computer supplies the warning, so official Web/mobile sessions connected to an updated desktop can display it without a separate Web deployment; reopen the picker after saving to refresh. New-task drafts without a session engine identity retain the workspace catalog. These pickers do not enumerate Codex's independently configured resources.

These features are planned for `v3.17.1-codex.4`; **Preview 4 is pending publication**. The published `.3` installer does not contain them. The official hosted website gains no new controls; a separately deployed updated Web UI uses the same Host settings.

### Official Web/mobile limitations

The current `zcode.z.ai/remote/v4` frontend is hosted by the official website. Installing this fork's desktop client does not replace it. Its existing settings page does not gain this fork's new controls.

| Operation                                                  | Modified desktop                                    | Current official Web/mobile frontend                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Select Codex when creating a project                       | Available under Execution engine                    | No branch selector; cannot create a Codex project through that entry                                              |
| Change an existing project's execution method              | Unsupported; fixed at creation                      | Unsupported                                                                                                       |
| Change automatic Codex delegation                          | Available under Codex collaboration                 | No switch; configure it on the executing computer                                                                 |
| Sign in to or out of ChatGPT subscription                  | Dedicated Manage Models entry in the updated client | No new card on the official website; manage it on the computer. Updated Web source requires a separate deployment |
| Edit ChatGPT subscription model definitions or connections | Officially managed; read-only                       | Unsupported; the computer rejects incompatible edits and preserves the configuration                              |
| Continue an existing Codex project's sessions              | Supported                                           | Supported when connected to the modified desktop; new tasks inside that project inherit Codex                     |
| Use the desktop's saved delegation setting                 | Applied next turn                                   | Applied next turn without a separate Web setting                                                                  |

Create the Codex project and save delegation settings **on the desktop first**, then open that project on Web/mobile to continue. The branch's source Web UI includes the new controls, but needs a separate deployment; no hosted modified-Web URL is currently provided.

### Platform packages

**Preview 4 (`v3.17.1-codex.4`) is pending publication**: [planned complete Windows x64 EXE URL](https://github.com/e0gd/ZCode-Codex/releases/download/v3.17.1-codex.4/ZCode-Codex-3.17.1-preview.4-win-x64.exe). This link is unavailable until the actual upload. Installer size and SHA256 will be recorded after the build, upload and verification.

Currently published: [Preview 3 complete Windows x64 EXE](https://github.com/e0gd/ZCode-Codex/releases/download/v3.17.1-codex.3/ZCode-Codex-3.17.1-preview.3-win-x64.exe) · [Preview 3 SHA256 manifest](https://github.com/e0gd/ZCode-Codex/releases/download/v3.17.1-codex.3/SHA256SUMS-win-x64.txt) · [Preview 3 release notes](https://github.com/e0gd/ZCode-Codex/releases/tag/v3.17.1-codex.3) · [Preview 2 macOS/Linux packages](https://github.com/e0gd/ZCode-Codex/releases/tag/v3.17.1-codex.2)

| Platform | Source packaging targets       | Formats                                     | Branch validation                                                                                                          |
| -------- | ------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Windows  | x64, arm64                     | `.exe` installer                            | x64 `.4` pending publication, `.3` published; clean-machine installation awaits acceptance; arm64 unpublished             |
| macOS    | Apple Silicon arm64, Intel x64 | `.dmg`, `.zip`                              | `.2` published for both architectures; `.4` unpublished; actual desktop runtime awaits acceptance                          |
| Linux    | x64, arm64                     | `.AppImage`, `.deb`, `.rpm`, `.pkg.tar.zst` | `.2` published in all four x64 formats; `.4` unpublished; arm64 and actual desktop runtime await acceptance                |

Download the actual attachments in this fork's [Releases](https://github.com/e0gd/ZCode-Codex/releases). No attachments means no published package; upstream installers do not contain this integration. Source commands appear below under Packaging. Codex is not bundled. To build a Preview application alongside the original while using the production backend, set `ZCODE_ENV=production` and `ZCODE_PREVIEW_IDENTITY=1`; standard user/project paths remain as described above. Renaming the repository does not migrate application data.

**Windows x64 downloads are complete `.exe` installers**. Start the installed application from its icon or executable; PowerShell is unnecessary. The installed application is named **ZCode Preview**. Historical preview packages are unsigned and macOS builds are not notarized. Published platforms include SHA256 manifests. Exit and reopen the application after updating to activate new code. Previous `.1`, `.2` and `.3` downloads and verification records remain in their historical Releases. The Preview 3 macOS/Linux build record is [run 41814005983](https://github.com/e0gd/ZCode-Codex/actions/runs/41814005983).

**Preview 4 changes (pending publication)**: per-server/per-skill Codex synchronization with collapsible lists; selectable packages with warnings naming unavailable MCP dependencies; MCP configuration errors naming the server and reason; bounded Codex notification count/memory; and abandoned process-lock recovery only after both the recorded owner and children are confirmed absent. Synchronization remains off by default and standard installation keeps the original ZCode paths.

The Windows `.3` installer comes from `c462acd5`, contains the title, encoded-input and browser-login fixes, and is 198,640,213 bytes. SHA256: `cbd7d82c07a31a800b0cd49df788563ee94378e41db9fa3165107d9ee0edf949`. These fixes are absent from `.2` packages.

Use [Actions → Desktop packages](https://github.com/e0gd/ZCode-Codex/actions/workflows/desktop-packages.yml) to manually build Windows x64, macOS arm64/x64 and Linux x64. Successful jobs provide installers and SHA256 manifests as run artifacts. Availability depends on actual job results; see [build and download instructions](docs/testing/desktop-packages.md).

## Updates

- **2026-11-05 Preview 4 (pending publication)**: Preparing the complete `v3.17.1-codex.4` installer with selectable Codex MCP/skill synchronization, independent collapsible lists, missing-MCP package warnings, named configuration errors, notification memory limits and abandoned-lock recovery after process absence checks. Standard installation keeps the system user/original MCP and skill paths; Codex retains its separate managed home and synchronization defaults off. Publication will be recorded after the build, upload and digest checks.
- **2026-11-04 Preview 3**: Rebuilt and published the complete Windows x64 EXE with summarized Codex session titles (`c40d750a`), decoded `c2a-msg-v1:` child input/labels/cards (`12d30272`), and desktop browser OAuth with clearer device failures (`01a569d0`). macOS/Linux builds were still queued at publication. Official regional restrictions and real-account validation limits still apply. Standard Windows packages use the same seven 16–256 px, 32-bit icon frames as upstream; the low-resolution custom launcher icon affected local portable shortcuts only and was corrected locally, outside Git and Release artifacts.
- **2026-11-04**: Added ChatGPT subscription login and a read-only official model catalog in Manage Models. Fixed official Codex 0.166 child-agent activity, robot-button visibility and background sessions. Child task input and command/tool output now appear while tasks are running. Updated platform downloads and release verification.
- **2026-11-03**: Project engines, images, structured questions, automatic delegation setting and native child-agent visibility; fixed Host rejection of free-text questions.
- **2026-10-30**: Updated to ZCode v3.17.1.
- 2026-10-19: Updated to ZCode v3.16.2.
- 2026-10-16: Updated to ZCode v3.16.1.
- 2026-10-16: Updated to ZCode v3.15.4.
- 2026-10-10: Updated to ZCode v3.15.1.
- 2026-9-23: Updated to ZCode v3.14.3.

## Setup

Install Git, Node.js **24.14.0**, and pnpm **10.33.2**. [mise.toml](mise.toml) is the source of truth for tool versions. Run all development and packaging commands below from the repository root.

```bash
pnpm bootstrap
```

`pnpm bootstrap` installs workspace dependencies, prepares local desktop runtime assets, and runs `build:bootstrap`.

The Agent CLI and runtime source code lives in [apps/zcode-cli/](apps/zcode-cli/) as a regular directory included when you clone this repository. No separate checkout or Git submodule initialization is required.

Additional setup and build commands:

| Command                        | Purpose                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                 | Install dependencies                                                                                                                |
| `pnpm prepare:desktop-runtime` | Prepare desktop runtime assets, including remote assets by default                                                                  |
| `pnpm prepare:remote-assets`   | Prepare remote runtime assets separately                                                                                            |
| `pnpm bootstrap:with-remote`   | Set up dependencies and local and remote assets, then build the relevant packages sequentially; skip the desktop application bundle |
| `pnpm build`                   | Recursively run each workspace package's build script, including its asset preparation steps                                        |

The default `bootstrap` skips remote asset preparation and is suitable for local desktop development. Run the corresponding preparation command when working with remote workspaces or validating remote distribution assets.

## Development and Usage

### Desktop

```bash
pnpm dev:desktop

# Use the test environment
pnpm dev:desktop:test
```

`pnpm dev:desktop` defaults to `pnpm dev:desktop:prod` and uses production service configuration. The startup script prepares local runtime assets, builds the desktop Agent, then starts Electron and source watchers.

Set `ZCODE_DATA_BASE_DIR` to use a separate development data directory. For example, on macOS / Linux:

```bash
ZCODE_DATA_BASE_DIR="$HOME/.zcode-dev-home" pnpm dev:desktop:test
```

### Web Development

Use development mode when editing Web or backend source code:

```bash
pnpm dev:web

# Set the backend workspace (macOS / Linux)
ZCODE_SERVER_WORKSPACE=/path/to/project pnpm dev:web
```

This starts both the Web development server (default: `http://localhost:5173`) and the backend (default: `http://localhost:3030`). Open the Web development server in your browser. `/ws` and general `/api` requests are proxied to the local backend; `/api/v1/oauth/token` is proxied separately to the configured product service.

After changing Agent source code, run `pnpm --filter @zcode/cli... build` and restart the service. To validate the complete distribution, extract and run it as described under Packaging → ZCode CLI distribution below.

### ZCode CLI distribution

The command-line distribution includes the TUI, Web client, and Agent behind one `zcode` command. With no arguments it starts the TUI; a leading `--web` starts Web mode; all other arguments go to the existing Agent CLI. Both modes run locally without Electron.

```bash
# Start the terminal UI by default
zcode

# Start the Web interface
zcode --web

# Set the project and port without opening a browser automatically
zcode --web --workspace /path/to/project --port 3030 --no-open

# Show CLI or Web options
zcode --help
zcode --web --help
```

In Web mode, it uses the current directory as the workspace, listens on `127.0.0.1` without token authentication by default, selects an available port, and opens a browser. Use the URL printed in the terminal and press `Ctrl+C` to stop the service. For LAN access, use `--host 0.0.0.0`; listening on a non-local address generates an access token by default. Use the token-bearing URL printed in the terminal. Set a token with `--token`, or disable token authentication with `--no-token`.

When starting the general Web service's HTTP entry directly, configure API/WebSocket authentication with `ZCODE_SERVER_AUTH_TOKEN`. When creating the service programmatically, use the `authToken` option.

See Packaging below for build instructions. `pnpm build:zcode` only creates the distribution; it does not replace an existing `zcode` on `PATH`. If the command still points to an older installation or another checkout, check it with `command -v zcode` on macOS / Linux or `where.exe zcode` on Windows.

### CLI Source Development

See the [CLI usage guide (Chinese)](apps/zcode-cli/docs/usage/README.md) for model configuration, non-interactive runs, tools and extensions, batch evaluation, and trajectory capture.

Use the source entry when developing the TUI or Agent:

```bash
pnpm --filter @zcode/cli dev --help
pnpm --filter @zcode/cli dev

# Build the CLI and its workspace dependencies
pnpm --filter @zcode/cli... build
node apps/zcode-cli/packages/cli/dist/zcode.cjs --help
```

This entry runs the Agent CLI directly and does not handle the distribution's `--web` switch. Use `pnpm dev:web` for Web development, or the extracted `bin/zcode.mjs` shown below to test the unified command.

### UI Plugin development

See the [UI Plugin guide](UI_PLUGIN.en.md) for the Excalidraw workflow, supported APIs, plugin installation and updates, and host debugging.

**Plugin PRs in `zcode-plugins` must declare whether they affect a UI Plugin and list the plugin names in the PR template.** See the [required plugin-type declaration](UI_PLUGIN.en.md#declare-the-plugin-type-in-pull-requests).

## Configuration

The root [.env.example](.env.example) provides sample service URLs and build configuration. Copy it to `.env` as needed and place local overrides in `.env.local`. Select the Desktop development environment with `dev:desktop:test` or `dev:desktop:prod`.

| Setting                              | Purpose                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `ZCODE_DATA_BASE_DIR`                | Base directory for application data, stored under its `.zcode/` subdirectory            |
| `ZCODE_SERVER_WORKSPACE`             | Workspace path for the Web backend                                                      |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | Path to a local provider configuration file; uses the built-in configuration when unset |
| `ZCODE_DIST_BASE_URL`                | Download base URL used by the CLI distribution installer                                |

Runtime variables can be set explicitly in the environment of the startup command. See [config/README.md](config/README.md) for the default configuration shipped with the client.

## Packaging

See [third-party/README.md](third-party/README.md) for notice generation, distribution checks, and where the notices are included in each distribution.

### Desktop

```bash
pnpm bundle:desktop

# Set the target platform and CPU architecture
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --os mac --arch arm64
pnpm bundle:desktop -- --os mac --arch x64
pnpm bundle:desktop -- --os linux --arch x64
pnpm bundle:desktop -- --os linux --arch arm64

pnpm bundle:desktop -- --help
```

The default target is macOS arm64, and the default output directory is `packages/desktop/dist/`. `--os` accepts `mac`, `win`, or `linux`; `--arch` accepts `x64` or `arm64`. Packaging and signing require the tools and configuration for the target platform.

### ZCode CLI distribution

Run `pnpm build:zcode` to build the CLI/TUI, backend, and Web client, collect the TUI native libraries, workers, and runtime dependencies, then assemble the distribution. Running the distribution still requires Node.js; use the version specified in `mise.toml`.

Before packaging, set the download base URL with `ZCODE_DIST_BASE_URL` in `.env`, `.env.local`, or the process environment, or pass it through `--base-url`. The URL below is a placeholder; replace it with your hosting URL when publishing:

```bash
pnpm build:zcode --base-url https://downloads.example.com/zcode/

# When ZCODE_DIST_BASE_URL is already configured
pnpm build:zcode

# Repackage existing Agent, backend, and Web build outputs
pnpm build:zcode --skip-build

# Show options for the version, output directory, and more
pnpm build:zcode --help
```

The version defaults to the root `package.json` version. Output is written to `dist/zcode/`:

- `releases/<version>/zcode-<version>.tar.gz`: runtime package.
- `releases/<version>/sha256.txt`: checksum file.
- `latest.json` and `install.sh`: version index and installer.

Upload the entire directory to the configured download base URL. The installer downloads the runtime package from that URL, installs it to `~/.zcode/runtime` by default, and creates the `zcode` command in `~/.local/bin`. Override these directories with `ZCODE_DIST_HOME` and `ZCODE_DIST_BIN_DIR`, respectively.

Existing Lite users should switch to the new build command, environment variables, and installer. Installation does not remove old Lite directories or migrate/delete session data.

To test a packaged build locally, extract and run it directly without uploading or installing it:

```bash
zcode_version=$(node -p "require('./dist/zcode/latest.json').version")
mkdir -p dist/zcode/debug
tar -xzf "dist/zcode/releases/$zcode_version/zcode-$zcode_version.tar.gz" \
  -C dist/zcode/debug
# Start the TUI by default
node dist/zcode/debug/zcode/bin/zcode.mjs

# Start Web mode
node dist/zcode/debug/zcode/bin/zcode.mjs --web \
  --workspace "$PWD" --port 3030 --no-open
```

Open `http://127.0.0.1:3030` to validate the complete flow, with one backend serving the Web pages and running the Agent. The port must be available; if `pnpm dev:web` is already running, choose another `--port`.

## Repository Structure

| Directory                                            | Responsibility                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/desktop`                                   | Electron Main, Host, Renderer, and desktop packaging                                    |
| `packages/web`                                       | Web client                                                                              |
| `packages/server`                                    | HTTP / WebSocket services and remote connections                                        |
| `packages/zcode-server-cli`                          | Standalone server startup and process management                                        |
| `packages/ui`                                        | Shared React components, hooks, and Zustand state                                       |
| `packages/services`                                  | Business services and persistence                                                       |
| `packages/shared`, `packages/rpc`, `packages/client` | Shared protocols and types, RPC framework, and Agent client SDK                         |
| `packages/provider`, `packages/provider-node`        | Common provider capabilities and Node implementations                                   |
| `apps/zcode-cli`                                     | Agent CLI, TUI, runtime, and tools                                                      |
| `scripts`, `config`, `third-party`                   | Build and maintenance scripts, built-in configuration, and third-party notice materials |

## Project Notice

See [NOTICE.md](NOTICE.md) for feature and promotion scope, maintenance policy, execution and data risks, licensing, and third-party copyright information.
