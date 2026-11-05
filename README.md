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

默认开发分支为 `native-codex`；`main` 保留上游基线。新建项目默认使用 ZCode，也可选择 Codex；保存后该项目的会话固定经过所选引擎，旧项目默认 ZCode。Codex 支持 ZCode 中配置的 OpenAI Responses API Key 服务商，以及“管理模型”中的 ChatGPT 订阅登录，无需为项目设置环境变量。订阅登录和子任务实时输出需要 `v3.17.1-codex.2` 或更新版本，旧安装包不会自动获得这些功能。

## 项目优势

围绕 ZCode 已有的项目、会话和交互流程集成 Codex，让用户继续使用熟悉的工作台：

- **按项目使用 ZCode 或 Codex**：新项目默认 ZCode，需要时选择 Codex；两类项目可在同一个客户端中共存。执行方式在创建后固定，旧项目继续使用 ZCode。
- **在 ZCode 中管理认证与模型**：Codex 沿用 ZCode 中配置的 API 服务商、模型和推理档位，也可在专用入口登录 ChatGPT 订阅。订阅凭据由官方 Codex 管理，不写入 API 服务商配置；两种来源明确区分，不自动切换。
- **桌面与网页／手机接续同一会话**：先在修改版桌面创建 Codex 项目，再从连接该桌面的官网网页／手机端继续对话，在该项目内新建任务也沿用 Codex。官网目前无法创建 Codex 项目或调整本分支新增设置，详见[网页／手机限制](#官网网页手机端的限制)。
- **子 Agent 进展可见**：Codex 派生子 Agent 后，沿用现有提示、输入区机器人按钮、后台列表和只读子会话查看进展。桌面设置提供自动派生开关，默认关闭；保存后桌面和连接的网页／手机会话均在下一轮生效。它控制派生策略，不设置并发数量，详见[子 Agent 协作](#开启-codex-子-agent-并行协作)。
- **沿用已有输入与确认流程**：文本、图片、工具审批和结构化提问进入 ZCode 现有界面；选项问题显示按钮，自由文本问题显示输入框，等待用户明确回答。
- **独立的 Codex 运行配置**：按需查找并启动单独安装的官方 Codex CLI，使用隔离的数据与配置目录，不覆盖用户已有的 Codex 配置或凭据。

详见 [使用说明与限制](NATIVE_CODEX.md) 和 [验证记录](docs/testing/native-codex-validation.md)。这是社区 Fork，与上游 ZCode 和 OpenAI 官方发行版分开维护。

## 安装与系统支持

先单独安装 [官方 Codex CLI](https://github.com/openai/codex)，再在 ZCode 中配置兼容的 API 服务商与模型或登录 ChatGPT 订阅，创建项目时选择 **执行引擎 → Codex**。使用 ZCode 引擎的项目无需安装 Codex。

### 标准安装的默认目录

公开标准安装包保留原版的用户与项目路径：正常启动使用系统用户的 `HOME`／`USERPROFILE`，继续读取 `~/.zcode` 下的原版 MCP 配置、`~/.zcode/skills` 和 `~/.agents/skills` 下的用户技能，以及项目原路径中的配置和技能。这里的 `~` 指执行会话的电脑用户目录；已有显式环境变量或数据目录覆盖仍按原有规则生效。安装包不会默认启用将这些路径重定向到独立 `Data` 目录的本机便携启动器。

**ZCode Preview** 身份允许与原版并排安装，并区分 Electron 窗口数据和 Helper 组件；它本身不会隔离全局 `.zcode` 业务数据。新项目默认 ZCode，未指定引擎的旧项目继续使用 ZCode，已选 Codex 的项目保留该引擎。Codex 单独使用 `<ZCode 数据根>/.zcode/codex-home` 作为受管目录，不覆盖另装 Codex 的配置。Codex 的 MCP／技能“与 ZCode 同步”开关均默认关闭，需要在下述设置中手动开启；沿用原版路径不等于自动把资源同步给 Codex。

### 创建 Codex 项目

1. 打开包含所需功能的修改版桌面客户端，在 ZCode 中配置兼容 OpenAI Responses 的 API 服务商、API Key 和模型；也可按下一节登录 ChatGPT 订阅。
2. 在桌面客户端进入 **创建项目**，填写项目资料并选择项目目录。
3. 将 **执行引擎** 从默认的 **ZCode** 改为 **Codex**，保存项目。
4. 在该项目内新建任务并发送消息，该项目的会话会经过 Codex；ZCode 会按需查找并启动已单独安装的官方 Codex CLI。

项目保存后执行方式固定，编辑已有项目只能查看，不能把原来的 ZCode 项目直接改成 Codex；需要使用 Codex 时请新建 Codex 项目。更新客户端不会自动转换旧项目。

### 使用 ChatGPT 订阅

打开 **设置 → 管理模型 → ChatGPT 订阅（Codex）**。`v3.17.1-codex.3` 的桌面入口默认使用官方浏览器登录：点击登录，再打开官方授权页面完成登录；也可选择设备码登录，在授权页面输入界面显示的设备码。新版 Web 保留设备码登录。设备码获取失败并不说明没安装 Codex；本机曾遇到官方设备码端点返回 403，可改用桌面浏览器登录。旧 `.2` 安装包不含浏览器登录修复。

登录完成后，进入 Codex 项目，在模型选择器选择 **ChatGPT 订阅** 分组及模型。模型目录来自官方 Codex，目录出现并不保证账号额度或服务器权限；实际拒绝会明确报错，不自动转为 API 消费。

如果官方登录网页返回 `unsupported_country_region_territory`，表示 OpenAI 拒绝当前访问地区，修改 ZCode 无法解除该限制。已验证浏览器授权的启动、轮询、取消和重试；这不等于完成真实账号登录或验证订阅推理可用。

订阅模型的 ID、认证方式、服务地址和能力定义只读；旧网页尝试修改会被电脑端拒绝，原配置保留。选择其他订阅模型或推理档位从后续输入生效，正在执行的回复不切换配置。官方 Codex 0.166 的已有线程不能跨 API／订阅认证来源恢复，切换来源时请在同一 Codex 项目内新建任务，原任务历史保留。

当前官网网页不会出现新增登录卡；先在修改版电脑端登录，再通过官网继续已有订阅任务。旧网页能否识别新增目录取决于其客户端兼容性，不能在官网编辑订阅定义。源码中的新版 Web 可通过同一 Host 登录管理，需要另外部署。

### 开启 Codex 子 Agent 并行协作

在修改版桌面客户端打开 **设置 → Agent 能力 → 子智能体 → Codex 协作**，开启 **自动派生子 Agent**。

该开关默认关闭。开启后，Codex 可按需派生子 Agent 处理独立工作；它控制自动派生策略，不设置并发数量，也不保证每轮都会创建子 Agent。关闭时仍可明确要求，例如：“请派生两个子 Agent，分别检查前端和后端。”

设置保存后从**下一轮对话**生效，作用于这台电脑执行的 Codex 会话，包括连接该电脑的网页／手机会话。派生后可点击输入区的**机器人按钮**查看后台子 Agent 列表，再进入只读子会话查看任务输入、运行中的命令／工具输出和回复。机器人按钮在子任务运行期间显示，全部结束后隐藏；派生记录仍可打开。工具实时输出显示有长度限制的预览，不展示模型私有推理。

### 配置 Codex 的 MCP 与技能来源（Preview 4）

打开 **设置 → Agent 能力 → Codex 集成**。MCP 和技能各有独立的“与 ZCode 同步”开关，默认关闭：

- **关闭同步**：MCP 可填写 Codex TOML 配置文件的绝对路径，仅读取其中的 MCP 配置；技能可填写多个绝对目录，每行一个。留空保留 Codex 在受管目录中的默认发现方式，不会修改单独安装的 Codex。
- **开启同步**：MCP 开关下会显示当前项目的服务列表。配置兼容且已启用、获信任的服务默认勾选，可手动取消；不兼容项自动关闭并显示原因，不再阻塞对话。技能开关下也有列表，已启用技能默认选中，可按名称、来源和路径逐项选择；停用项保持关闭。同名技能按路径独立控制，关闭同步仍保留选择。此选择只影响 Codex，不会关闭 ZCode 原有的 MCP 或技能。对应自定义路径暂不使用，但仍保留。同步是运行时读取，不复制文件或覆盖两边配置。

MCP 和技能列表默认分别收起，点击列表标题可展开／收起并查看数量。展开后长列表在内部滚动，方便操作下方的 **保存更改**；折叠不会清空勾选。

点击 **保存更改** 后从下一轮 Codex 对话生效，正在运行的回复保持原配置。路径属于执行会话的电脑；手机无需填写自己的目录。兼容性表示支持该配置方式，不保证服务能够连接；无法读取的自定义路径和实际连接问题仍会明确报错。技能是否能完成任务还取决于 Codex 是否具备该技能所需工具。

已有 Codex 会话的技能菜单只展示已选同步的可用技能。功能包的 MCP 不兼容、关闭或未同步时，功能包仍可选择和调用，描述开头会提示具体不可用的 MCP；依赖这些 MCP 的操作仍可能无法完成，选择功能包不会自动启用它们。停用的功能包隐藏，同名冲突仍禁选；普通 ZCode 会话保持原列表。提示由执行电脑返回，连接新版桌面的官网网页／手机会话也能显示，不需要另部署网页；保存后重新打开菜单即可刷新。尚未创建会话的新任务草稿缺少引擎身份，仍使用工作区列表；菜单不枚举 Codex 独立配置的资源。

本节功能计划随 `v3.17.1-codex.4` 发布，**Preview 4 当前待发布**；已发布的 `.3` 不含本节功能。官网网页不会新增控件，另行部署的新版 Web 使用同一 Host 设置。

### 官网网页／手机端的限制

当前官网 `zcode.z.ai/remote/v4` 使用官网托管的前端。安装修改版桌面客户端不会更新该网页，网页中已有设置页也不会因此出现本分支新增的控件。

| 操作                              | 修改版桌面客户端                   | 当前官网网页／手机端                                        |
| --------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| 创建项目时选择 Codex              | 可以，在“执行引擎”中选择           | 没有本分支的选择器，不能从该入口创建 Codex 项目             |
| 修改已有项目的执行方式            | 不支持，创建后固定                 | 不支持                                                      |
| 开启／关闭 Codex 自动派生子 Agent | 可以，在上述“Codex 协作”设置中修改 | 没有该开关，请在执行会话的电脑上设置                        |
| 继续已创建的 Codex 项目会话       | 可以                               | 连接修改版桌面后可以；在该 Codex 项目内新建任务仍沿用 Codex |
| 使用桌面保存的自动派生设置        | 下一轮生效                         | 同样在下一轮生效，无需网页重新设置                          |
| 登录／退出 ChatGPT 订阅           | 新版客户端的管理模型专用入口       | 官网无新增卡，请在电脑端管理；新版 Web 源码需另行部署       |
| 编辑 ChatGPT 订阅模型定义或连接   | 官方管理，只读                     | 不支持；不兼容修改由电脑端拒绝，保留原配置                  |

推荐顺序：**先在桌面创建 Codex 项目并设置自动派生，再从官网网页／手机打开该项目继续对话**。本分支源码中的 Web 界面包含新增控件，但需要另行部署才能使用；它与当前官网网页不同，目前没有提供另行部署的修改版网页地址。

### 各系统安装包

**Preview 4（`v3.17.1-codex.4`）待发布**：[预定 Windows x64 完整 EXE 下载地址](https://github.com/e0gd/ZCode-Codex/releases/download/v3.17.1-codex.4/ZCode-Codex-3.17.1-preview.4-win-x64.exe)。该链接在实际上传前不可用；安装包大小与 SHA256 将在构建、上传并核对后记录。

当前已发布：[Preview 3 Windows x64 完整 EXE](https://github.com/e0gd/ZCode-Codex/releases/download/v3.17.1-codex.3/ZCode-Codex-3.17.1-preview.3-win-x64.exe) · [Preview 3 SHA256 校验文件](https://github.com/e0gd/ZCode-Codex/releases/download/v3.17.1-codex.3/SHA256SUMS-win-x64.txt) · [Preview 3 发行说明](https://github.com/e0gd/ZCode-Codex/releases/tag/v3.17.1-codex.3) · [Preview 2 macOS／Linux 包](https://github.com/e0gd/ZCode-Codex/releases/tag/v3.17.1-codex.2)

| 系统    | 源码打包架构                   | 产物格式                                    | 本分支验证状态                                                            |
| ------- | ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------- |
| Windows | x64、arm64                     | `.exe` 安装程序                             | x64 `.4` 待发布，`.3` 已发布；干净机器安装待验收，arm64 未发布             |
| macOS   | Apple Silicon arm64、Intel x64 | `.dmg`、`.zip`                              | 两种架构的 `.2` 已发布；`.4` 未发布，真实桌面运行待验收                     |
| Linux   | x64、arm64                     | `.AppImage`、`.deb`、`.rpm`、`.pkg.tar.zst` | x64 `.2` 四种格式已发布；`.4` 未发布，arm64 与真实桌面运行待验收           |

公开安装包以本仓库 [Releases](https://github.com/e0gd/ZCode-Codex/releases) 实际附件为准；没有附件表示尚未发布，上游安装包不包含修改版功能。各系统的源码构建命令见下方“打包”。Codex 不随安装包内置。自行打包要与原版并排安装时，设置 `ZCODE_ENV=production`、`ZCODE_PREVIEW_IDENTITY=1`；标准用户／项目路径仍按上文读取，仓库改名不会自动迁移数据。

**Windows x64 使用 `.exe` 完整安装程序**，安装后通过应用图标或 EXE 启动，无需 PowerShell。应用名为 **ZCode Preview**；历史预览包未签名，macOS 包未公证。已发布平台附带 SHA256 校验文件。更新后需退出并重新打开应用才能使用新代码；`.1`、`.2`、`.3` 下载和校验记录保留在历史 Release 中。Preview 3 的 macOS／Linux 构建记录见[该次任务](https://github.com/e0gd/ZCode-Codex/actions/runs/41814005983)。

**Preview 4 更新内容（待发布）**：增加按服务／技能选择的 Codex 同步和可折叠列表；MCP 不可用的功能包仍可选择，并提示具体缺失依赖；MCP 配置错误显示服务名称与原因；为 Codex 通知队列增加数量／内存限额，并仅在确认原进程及子进程均已退出后恢复遗留进程锁。同步默认关闭，标准安装继续读取原版路径。

**Preview 3 历史记录**：Windows `.3` 来自 `c462acd5`，包含会话自动总结标题、子 Agent 输入编码解码和 ChatGPT 浏览器登录修复；旧 `.2` 不含这三项。该 EXE 为 198,640,213 字节，SHA256 为 `cbd7d82c07a31a800b0cd49df788563ee94378e41db9fa3165107d9ee0edf949`。本机便携版快捷方式曾引用 32×32 低色深图标，已在本机改用高清图标；标准 Windows 安装包使用与原版相同的 16–256 像素、32 位色深资源，不经过该本机启动器。这项快捷方式调整不属于源码或 Release 更新。

也可在 [Actions → Desktop packages](https://github.com/e0gd/ZCode-Codex/actions/workflows/desktop-packages.yml) 手动构建 Windows x64、macOS arm64/x64 和 Linux x64，成功的任务提供安装包与 SHA256 校验文件。当前是构建入口，实际可下载状态以任务结果为准；[构建与下载说明](docs/testing/desktop-packages.md) 包含限制和操作步骤。

## 更新

- **2026-11-05 Preview 4（待发布）**：准备 `v3.17.1-codex.4` 完整安装包，包含 Codex MCP／技能选择同步、独立折叠列表、功能包缺失 MCP 提示、带服务名称的配置错误、通知队列内存限额与可验证的遗留进程锁恢复。标准安装保留系统用户／原版 MCP 和技能路径，Codex 受管目录独立，同步默认关闭；构建、上传和摘要核对完成后再标记已发布。
- **2026-11-04 Preview 3**：Windows x64 完整 EXE 已重建发布，包含 Codex 首轮完成后自动总结会话标题（`c40d750a`）、子 Agent 输入／标签／派生卡片的 `c2a-msg-v1:` 解码（`12d30272`）、桌面官方浏览器登录及设备授权失败提示（`01a569d0`）。发布时 macOS／Linux 新版构建尚在排队；官方地区限制及真实订阅验收边界仍适用。
- **2026-11-04**：新增管理模型中的 ChatGPT 订阅登录和只读官方模型目录；修复官方 Codex 0.166 子 Agent 派生记录、机器人按钮及后台子会话显示；子任务输入和命令／工具输出可在运行中查看，无需等到任务结束。更新多系统下载与发布校验流程。
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
