# ZCode-Codex

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="ZCode" width="128" height="128" />
</div>
<p align="center">
  <a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=47ag983c-8fcb-4d6d-814b-5395193a712c&amp;qr_code=true">飞书社群</a> ·
  <a href="https://discord.gg/z9aBcQXZQ3">Discord</a>
</p>
<p align="center">
  简体中文 | <a href="README.en.md">English</a>
</p>

ZCode-Codex 是集成 Codex 的 [ZCode](https://github.com/zai-org/ZCode) AI 编程工作台，在保留原生 ZCode 功能的基础上，让用户在 ZCode 界面中使用官方 Codex。Codex CLI 需单独安装，由 ZCode 查找并启动。仓库包含桌面客户端、Web、共享 UI 和 Agent CLI 源码。

默认开发分支为 `native-codex`；`main` 保留上游基线。新建项目默认使用 ZCode，也可选择 Codex；保存后该项目的会话固定经过所选引擎，旧项目默认 ZCode。Codex 使用 ZCode 中配置的 API 服务商和模型，目前支持 OpenAI Responses 与 API Key，无需为项目设置环境变量。

- 支持 Codex 文本与图片输入，上传的图片沿用现有附件入口。
- 结构化提问显示选项按钮或文字输入框，等待用户明确回答。
- Codex 子 Agent 接入已有提示、输入区机器人按钮、后台列表和只读子会话查看。
- 设置 → Agent 能力 → 子智能体 → Codex 协作可控制是否自动派生子 Agent，默认关闭；连接该电脑的 Web 会话在下一轮使用保存的设置。
- 桌面与连接到该桌面的 Web/手机共享执行会话；官网托管前端不会因安装修改版而获得新增控件。

详见 [使用说明与限制](NATIVE_CODEX.md) 和 [验证记录](docs/testing/native-codex-validation.md)。这是社区 Fork，与上游 ZCode 和 OpenAI 官方发行版分开维护。

## 安装与系统支持

先单独安装 [官方 Codex CLI](https://github.com/openai/codex)，再在 ZCode 中配置兼容的 API 服务商与模型，创建项目时选择 **执行引擎 → Codex**。使用 ZCode 引擎的项目无需安装 Codex。

### 创建 Codex 项目

1. 打开本仓库发行的修改版桌面客户端，在 ZCode 中配置 API 服务商、API Key 和模型。Codex 目前需要兼容 OpenAI Responses 的配置。
2. 在桌面客户端进入 **创建项目**，填写项目资料并选择项目目录。
3. 将 **执行引擎** 从默认的 **ZCode** 改为 **Codex**，保存项目。
4. 在该项目内新建任务并发送消息，该项目的会话会经过 Codex；ZCode 会按需查找并启动已单独安装的官方 Codex CLI。

项目保存后执行方式固定，编辑已有项目只能查看，不能把原来的 ZCode 项目直接改成 Codex；需要使用 Codex 时请新建 Codex 项目。更新客户端不会自动转换旧项目。

### 开启 Codex 子 Agent 并行协作

在修改版桌面客户端打开 **设置 → Agent 能力 → 子智能体 → Codex 协作**，开启 **自动派生子 Agent**。

该开关默认关闭。开启后，Codex 可按需派生子 Agent 处理独立工作；它控制自动派生策略，不设置并发数量，也不保证每轮都会创建子 Agent。关闭时仍可明确要求，例如：“请派生两个子 Agent，分别检查前端和后端。”

设置保存后从**下一轮对话**生效，作用于这台电脑执行的 Codex 会话，包括连接该电脑的网页／手机会话。派生后可点击输入区的**机器人按钮**查看后台子 Agent 列表，再进入只读子会话查看进展。

### 官网网页／手机端的限制

当前官网 `zcode.z.ai/remote/v4` 使用官网托管的前端。安装修改版桌面客户端不会更新该网页，网页中已有设置页也不会因此出现本分支新增的控件。

| 操作 | 修改版桌面客户端 | 当前官网网页／手机端 |
| --- | --- | --- |
| 创建项目时选择 Codex | 可以，在“执行引擎”中选择 | 没有本分支的选择器，不能从该入口创建 Codex 项目 |
| 修改已有项目的执行方式 | 不支持，创建后固定 | 不支持 |
| 开启／关闭 Codex 自动派生子 Agent | 可以，在上述“Codex 协作”设置中修改 | 没有该开关，请在执行会话的电脑上设置 |
| 继续已创建的 Codex 项目会话 | 可以 | 连接修改版桌面后可以；在该 Codex 项目内新建任务仍沿用 Codex |
| 使用桌面保存的自动派生设置 | 下一轮生效 | 同样在下一轮生效，无需网页重新设置 |

推荐顺序：**先在桌面创建 Codex 项目并设置自动派生，再从官网网页／手机打开该项目继续对话**。本分支源码中的 Web 界面包含新增控件，但需要另行部署才能使用；它与当前官网网页不同，目前没有提供另行部署的修改版网页地址。

### 各系统安装包

| 系统 | 源码打包架构 | 产物格式 | 本分支验证状态 |
| --- | --- | --- | --- |
| Windows | x64、arm64 | `.exe` 安装程序 | x64 预览安装包已发布；便携目录通过本地运行验证，干净机器安装待验收 |
| macOS | Apple Silicon arm64、Intel x64 | `.dmg`、`.zip` | 两种架构均已构建并发布；真实桌面运行待验收 |
| Linux | x64、arm64 | `.AppImage`、`.deb`、`.rpm`、`.pkg.tar.zst` | x64 四种格式均已构建并发布；arm64 构建与真实桌面运行待验收 |

公开安装包以本仓库 [Releases](https://github.com/e0gd/ZCode-Codex/releases) 实际附件为准；没有附件表示尚未发布，上游安装包不包含修改版功能。各系统的源码构建命令见下方“打包”。Codex 不随安装包内置。自行打包要与原版并排安装时，设置 `ZCODE_ENV=production`、`ZCODE_PREVIEW_IDENTITY=1`。仓库改名不会自动迁移原版数据，也不会改变已有本地修改版的独立数据。

当前预览版：[v3.17.1-codex.1](https://github.com/e0gd/ZCode-Codex/releases/tag/v3.17.1-codex.1)。安装后应用名为 **ZCode Preview**；预览包未签名，macOS 包未公证。各平台附带 SHA256 校验文件，已发布版本和待完成的平台均在发行页注明。

也可在 [Actions → Desktop packages](https://github.com/e0gd/ZCode-Codex/actions/workflows/desktop-packages.yml) 手动构建 Windows x64、macOS arm64/x64 和 Linux x64，成功的任务提供安装包与 SHA256 校验文件。当前是构建入口，实际可下载状态以任务结果为准；[构建与下载说明](docs/testing/desktop-packages.md) 包含限制和操作步骤。

## 更新

- **2026-11-03**：在 ZCode 中集成 Codex，支持按项目选择执行方式、图片输入、交互提问、Codex 自动派生设置与子 Agent 可视化；修复纯文字提问被 Host 拒绝的问题。
- **2026-10-30**：更新至 ZCode v3.17.1 版本。
- 2026-10-19：更新至 ZCode v3.16.2 版本。
- 2026-10-16：更新至 ZCode v3.16.1 版本。
- 2026-10-16：更新至 ZCode v3.15.4 版本。
- 2026-10-10：更新至 ZCode v3.15.1 版本。
- 2026-9-23：更新至 ZCode v3.14.3 版本。

## 初始化

准备 Git、Node.js **24.14.0** 和 pnpm **10.33.2**，版本以 [mise.toml](mise.toml) 为准。以下开发和打包命令均在仓库根目录执行。

```bash
pnpm bootstrap
```

`pnpm bootstrap` 安装 workspace 依赖、准备桌面本地运行资源，再执行 `build:bootstrap`。

Agent CLI 与运行时源码位于 [apps/zcode-cli/](apps/zcode-cli/)，作为普通目录随本仓库一起克隆，无需单独拉取或初始化 Git submodule。

根据需要选择其他初始化或构建入口：

| 命令                           | 用途                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `pnpm install`                 | 安装依赖                                                          |
| `pnpm prepare:desktop-runtime` | 准备桌面运行资源，默认包含远程资源准备                            |
| `pnpm prepare:remote-assets`   | 单独准备远程运行资源                                              |
| `pnpm bootstrap:with-remote`   | 初始化依赖、本地与远程资源，并串行构建相关包；跳过桌面应用 bundle |
| `pnpm build`                   | 递归执行各 workspace 包的构建脚本，包括包内的资源准备步骤         |

默认 `bootstrap` 跳过远程资源准备，适合本地桌面开发。使用远程工作区或验证远程发行资源时，再运行对应准备命令。

## 开发与运行

### 桌面版

```bash
pnpm dev:desktop

# 使用测试环境
pnpm dev:desktop:test
```

`pnpm dev:desktop` 默认等同于 `pnpm dev:desktop:prod`，使用生产服务配置。启动脚本会准备本地运行资源、构建桌面 Agent，再启动 Electron 和源码监听。

需要独立开发数据目录时，可设置 `ZCODE_DATA_BASE_DIR`。例如在 macOS / Linux 中：

```bash
ZCODE_DATA_BASE_DIR="$HOME/.zcode-dev-home" pnpm dev:desktop:test
```

### 远程功能（SSH/WSL）

先执行 `pnpm bootstrap:with-remote` 准备远程资源（mock-cdn），再 `pnpm dev:desktop`；连接远程项目时资源选择「本地下载后上传」。开发态资源取自本地 `packages/desktop/mock-cdn` 和本地构建产物，经 SFTP 上传到远程，不访问 CDN。

### Web 开发

修改 Web 或后端源码时，使用开发模式：

```bash
pnpm dev:web

# 指定后端工作区（macOS / Linux）
ZCODE_SERVER_WORKSPACE=/path/to/project pnpm dev:web
```

该命令同时启动 Web 开发服务器（默认 `http://localhost:5173`）和后端（默认 `http://localhost:3030`）；浏览器访问前者。`/ws` 和一般 `/api` 请求代理到本地后端，`/api/v1/oauth/token` 单独代理到当前配置的产品服务。

Agent 源码修改后，执行 `pnpm --filter @zcode/cli... build` 并重启服务。需要验证完整发行包时，按下方“ZCode 命令行版”打包章节解压运行。

### ZCode 命令行版

命令行发行包包含 TUI、Web 和 Agent，统一使用 `zcode` 启动：无参数进入 TUI；第一个参数为 `--web` 时启动 Web；其他参数交给现有 Agent CLI 处理。两种模式都在本机运行，无需 Electron。

```bash
# 默认进入终端交互界面
zcode

# 启动 Web 界面
zcode --web

# 指定项目和端口，不自动打开浏览器
zcode --web --workspace /path/to/project --port 3030 --no-open

# 查看 CLI 或 Web 参数
zcode --help
zcode --web --help
```

Web 模式默认工作目录为当前目录，监听 `127.0.0.1`，默认不启用访问令牌，自动选择空闲端口并打开浏览器。访问终端输出的地址，按 `Ctrl+C` 停止服务。局域网访问可使用 `--host 0.0.0.0`；监听非本机地址时默认生成访问令牌，使用终端输出的带令牌链接。可通过 `--token` 指定令牌或 `--no-token` 关闭令牌认证。

直接启动通用 Web 服务的 HTTP 入口时，通过 `ZCODE_SERVER_AUTH_TOKEN` 配置 API／WebSocket 认证；通过程序接口创建服务时，使用 `authToken` 选项。

构建方式见下方打包章节。`pnpm build:zcode` 只生成发行包，不会替换 `PATH` 中已有的 `zcode`。如果命令仍指向旧安装或其他源码目录，macOS / Linux 可用 `command -v zcode` 检查，Windows 可用 `where.exe zcode` 检查。

### CLI 源码开发

CLI 的模型配置、非交互调用、工具与扩展、批量评测和轨迹记录见 [CLI 使用指南](apps/zcode-cli/docs/usage/README.md)。

直接开发 TUI 或 Agent 时，运行源码入口：

```bash
pnpm --filter @zcode/cli dev --help
pnpm --filter @zcode/cli dev

# 构建 CLI 及其 workspace 依赖
pnpm --filter @zcode/cli... build
node apps/zcode-cli/packages/cli/dist/zcode.cjs --help
```

这个入口直接运行 Agent CLI，不经过发行包的 `--web` 分流。开发 Web 用 `pnpm dev:web`；验证统一的 `zcode` 命令，用下方解压后的 `bin/zcode.mjs`。

### UI Plugin 开发

参见 [UI Plugin：能力、API 与调试](UI_PLUGIN.md)，从 Excalidraw 的画布协作示例开始，了解插件安装更新、页面 API 和宿主联调入口。

**向 `zcode-plugins` 提交插件 PR 时，必须在 PR 模板中声明是否为 UI Plugin，并填写插件名称。** 判断标准见[提交 PR 时声明插件类型](UI_PLUGIN.md#提交-pr-时声明插件类型)。

## 配置

根目录 [.env.example](.env.example) 提供服务地址与构建配置示例，可按需复制到 `.env`，本地覆盖放入 `.env.local`。Desktop 的开发环境通过 `dev:desktop:test` / `dev:desktop:prod` 选择。

| 配置                                 | 用途                                             |
| ------------------------------------ | ------------------------------------------------ |
| `ZCODE_DATA_BASE_DIR`                | 应用数据基目录，数据写入其下的 `.zcode/`         |
| `ZCODE_SERVER_WORKSPACE`             | Web 后端的工作区路径                             |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | 本地 Provider 配置文件路径；未设置时使用内置配置 |
| `ZCODE_DIST_BASE_URL`                | 命令行安装脚本使用的下载根地址                   |

运行时变量可在启动命令的环境中显式设置。随客户端发布的默认配置见 [config/README.md](config/README.md)。

## 打包

第三方声明生成、发行校验流程及声明在发行物中的位置见 [third-party/README.md](third-party/README.md)。

### 桌面版

```bash
pnpm bundle:desktop

# 指定目标平台与 CPU 架构
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --os mac --arch arm64
pnpm bundle:desktop -- --os mac --arch x64
pnpm bundle:desktop -- --os linux --arch x64
pnpm bundle:desktop -- --os linux --arch arm64

pnpm bundle:desktop -- --help
```

默认目标为 macOS arm64，默认输出目录为 `packages/desktop/dist/`。`--os` 支持 `mac`、`win`、`linux`，`--arch` 支持 `x64`、`arm64`；实际打包与签名需要目标平台对应的工具和配置。

安装：双击打开产物 DMG，将 ZCode 拖入"应用程序"。本地构建未签名，首次打开若被 macOS 拦截，执行：

```bash
sudo xattr -rd com.apple.quarantine /Applications/ZCode.app
```

### ZCode 命令行版

构建入口为 `pnpm build:zcode`。脚本会依次构建 CLI/TUI、后端和 Web，收集 TUI 的原生库、worker 与运行时依赖，再组装发行包；运行发行包仍需要 Node.js，版本以 `mise.toml` 为准。

打包前必须设置下载根地址 `ZCODE_DIST_BASE_URL`（可放在 `.env`、`.env.local` 或环境变量中），也可以通过 `--base-url` 传入。以下地址是占位示例，发布时替换为实际托管地址：

```bash
pnpm build:zcode --base-url https://downloads.example.com/zcode/

# 已配置 ZCODE_DIST_BASE_URL 时
pnpm build:zcode

# 仅重新组包，复用已有的 Agent、后端和 Web 构建产物
pnpm build:zcode --skip-build

# 查看版本、输出目录等可选参数
pnpm build:zcode --help
```

默认版本取根目录 `package.json`，输出目录为 `dist/zcode/`：

- `releases/<version>/zcode-<version>.tar.gz`：运行包。
- `releases/<version>/sha256.txt`：校验摘要。
- `latest.json`、`install.sh`：版本索引和安装脚本。

完整目录可上传到配置的下载根地址。安装脚本从该地址下载运行包，默认安装到 `~/.zcode/runtime`，并在 `~/.local/bin` 创建 `zcode` 命令。安装目录可通过 `ZCODE_DIST_HOME` 修改，命令目录可通过 `ZCODE_DIST_BIN_DIR` 修改。

旧 Lite 用户需要改用上述构建命令、环境变量和新的安装脚本。新安装不会删除旧 Lite 目录，也不会迁移或删除已有会话数据。

本地调试打包产物时，可直接解压运行，无需上传或安装：

```bash
zcode_version=$(node -p "require('./dist/zcode/latest.json').version")
mkdir -p dist/zcode/debug
tar -xzf "dist/zcode/releases/$zcode_version/zcode-$zcode_version.tar.gz" \
  -C dist/zcode/debug
# 默认启动 TUI
node dist/zcode/debug/zcode/bin/zcode.mjs

# 启动 Web
node dist/zcode/debug/zcode/bin/zcode.mjs --web \
  --workspace "$PWD" --port 3030 --no-open
```

浏览器打开 `http://127.0.0.1:3030`，即可验证同一后端服务托管 Web 页面和 Agent 的完整链路。该端口需要空闲；如正在运行 `pnpm dev:web`，可改用其他 `--port`。

## 仓库结构

| 目录                                                 | 职责                                       |
| ---------------------------------------------------- | ------------------------------------------ |
| `packages/desktop`                                   | Electron Main、Host、Renderer 与桌面打包   |
| `packages/web`                                       | Web 客户端                                 |
| `packages/server`                                    | HTTP / WebSocket 服务与远程连接            |
| `packages/zcode-server-cli`                          | 独立 Server 启动与进程管理                 |
| `packages/ui`                                        | 共享 React 组件、hooks 与 Zustand 状态     |
| `packages/services`                                  | 业务服务与持久化                           |
| `packages/shared`、`packages/rpc`、`packages/client` | 共享协议和类型、RPC 框架、Agent 客户端 SDK |
| `packages/provider`、`packages/provider-node`        | Provider 公共能力与 Node 实现              |
| `apps/zcode-cli`                                     | Agent CLI、TUI、运行时与工具               |
| `scripts`、`config`、`third-party`                   | 构建维护脚本、内置配置与第三方声明材料     |

## 项目声明

功能与优惠范围、维护规则、执行与数据风险，以及许可和第三方版权说明，详见 [NOTICE.md](NOTICE.md)。
