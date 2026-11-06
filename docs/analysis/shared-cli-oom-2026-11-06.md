# 共享 CLI 内存耗尽排查（2026-11-06）

## 已确认的退出原因

北京时间 18:20:51，共享 CLI 异常退出，退出码 `134`。Host 保存的 stderr 包含
`FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory`。
退出前两次最后尝试的完整垃圾回收，堆占用均约 `3154.9 MB`，没有释放出足够空间。
桌面稳定性日志将此事件识别为 `AgentOutOfMemory / ERR_OUT_OF_MEMORY`。

桌面 Main 和 Local Host 仍然存活；18:20:51.135，Host 自动启动了新的共享 CLI。
同一 workspace 的会话及原生子 Agent 复用此 CLI，因此其协议连接一起失效。
本次没有证据支持将退出归因于服务商断流、MCP 配置不兼容或桌面 Renderer 崩溃。

```text
shared CLI: heap allocation fails → fatal OOM → exit 134
                                             ├─ workspace sessions disconnect
                                             └─ Host restarts shared CLI
```

## 故障发生时的防护安装状态

通过安装元数据、运行中进程命令行和 CLI 文件 SHA-256 交叉核验：

| 项目 | 实际状态 |
| --- | --- |
| 故障时安装版本标识 | `plugin-mcp-warning-249e7d6e` |
| 安装内 CLI SHA-256 | `6b8942ef7ff292996f8a4fb688d6abb553f364e188e99154924e16eff1dc1bfe` |
| 排查时仓库已构建 CLI SHA-256 | `6e34bdc786ccdbaaf4ecda25c95bfa07d5d441d72485f7cf816463c552209521` |
| 安装内 CLI 包含回放字节上限 | 否 |
| 仓库已构建 CLI 包含回放字节上限 | 是 |
| 自动重启所加载的 CLI | 仍为原安装路径中的旧文件 |

`c7990268` 的回放内存限制和工具输入去重，以及 `b0248f7d` 的实时答复投递，
已经在源码和本地构建产物中，但尚未应用到当前客户端。因此不能称为
“当前运行版本已有这些防护，但防护再次失效”。编译完成不等于安装完成。

## 内存增长证据及限制

CLI 的低频资源采样显示：

| 北京时间 | JS heap used | event rows | transient retained |
| --- | ---: | ---: | ---: |
| 18:10:41 | 192.5 MiB | 627 | 251 |
| 18:12:08 | 367.0 MiB | 6783 | 6378 |
| 18:16:08 | 395.4 MiB | 9996 | 9472 |
| 18:18:08 | 368.6 MiB | 1035 | 479 |
| 18:19:41 | 369.7 MiB | 7482 | 6872 |
| 18:20:51 | 约 3154.9 MB（V8 fatal stderr） | 未采到 | 未采到 |

18:19:41 至退出之间没有新的有效共享 CLI 内存样本。最后一分钟左右发生明显突增，
但当前没有该进程的 heap snapshot 或 allocation profile，不能从事件条数和时间相近
直接判定具体的持有对象，也不能宣称上轮两个修复足以根治本次 OOM。

只读数据库检查确认旧版本仍将命令 `aggregatedOutput` 同时保存于工具 input 和
output；本次窗口内最大已保存工具 part 约 144 千字符，主会话累计工具及文本 part
约 36.7 百万字符。它们提供资源开销线索，不证明单个 part 或会话大小造成了此次
约 3 GB 的堆突增。采样时多个原生子 Agent 正在运行，同样不足以归因于派生行为本身。

## 后续验证边界

应先将已经构建并验证的内存防护应用到客户端，并核验新启动进程的实际 CLI 哈希；
之后观察新增的 `v4.replayEntries/replayBytes` 计数，区分回放缓存和其他堆占用。
如新版本仍出现增长，需要在隔离复现进程中采集分配证据，再决定具体修复。

本次排查仅只读访问运行状态和日志，没有杀死当前客户端或共享 CLI，没有删会话锁，
也没有在当前工作进程上强制采集可能引发暂停或二次 OOM 的堆快照。
本次事件与 [前一天的 watchdog 超时](remote-blank-cli-stall-2026-11-05.md) 分开记录。
