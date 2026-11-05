# 远程空白与共享 CLI 超时排查（2026-11-05）

## 已确认的故障链

桌面及 Host 进程当时仍存活。北京时间 18:13:32，Host 记录一次
`provider/refreshRegistry` 请求等待 180 秒超时；18:13:35 以
`watchdog_recycle / request-timeout` 回收共享 CLI，并启动新 CLI。随后会话重新订阅。
同一 workspace 的会话和原生子 Agent 共用这个 CLI，因此会同时失去运行连接。
远程网页空白不是本次已确认的独立网页渲染故障。

故障前 CLI 最后一条资源样本的 `heapUsedKb=2403462`、`rssKb=3170492`，
另有 16621 条 event store 记录、15655 条瞬态事件和 9 个 V4 publisher。
本次没有 V8 OOM fatal 的直接记录，不能把 request-timeout 退出写成已证实的 OOM。
当天较早一次退出确有 V8 heap OOM 记录，属于另一事件。
超时方法名只指出等待失败的请求，不足以把根因归给服务商或 provider registry。

```text
shared CLI stops answering → Host request timeout → workspace CLI recycled
                                                 ├─ all running sessions disconnect
                                                 └─ desktop/mobile subscriptions rebuild
```

## 本轮修复及证据范围

只读持久化记录确认部分命令 `aggregatedOutput` 同时存于工具 input 和 output；
最大样本的结果约 1 MiB。共享 native mapper 现从命令 input 去掉该输出字段，完整结果
仍走原路径。回归覆盖原始 item 不变、运行中与完成的子工具及最终结果。

V4 回放日志原来只限 2000 条，没有字节预算。现同时限制为 16 MiB UTF-8 JSON，
淘汰整条事件并推进既有 floor；旧 base 走既有 snapshot，在线订阅继续接收。
回归覆盖两种 profile、重连及 same-sub resync、UTF-8/转义、单条超限、精确记账、
rehydrate 成功/失败及原子 reservation。低频内存日志增加 replayEntries/replayBytes，
用于区分回放缓存和其他堆占用。

以上两个资源问题有源码和回归证据，但尚未证明它们是此次堆增长的唯一或主要来源。
没有改变 180 秒 watchdog、自动重放输入、清除会话锁或在当前运行进程上强制采集 heap dump。
当前进程的低内存状态只能证明暂时恢复，不能证明原问题已消除。

与本轮另一个问题分开验收：提问等待脱离原生通知串行链，已提交答案用官方
`turn/steer` 交给仍在运行的父轮；这个修复不能当作远程空白已修好的证据。

## 验证限制

Native adapter 222 项、Core native executor 91 项通过。Publisher/gateway 回归中
194 项通过，1 项既有 `durable TurnStarted` admission 断言失败；隔离加载修改前
`732298a0` 的 publisher/gateway 源码可复现同一失败。另补充的 publisher 容量汇总及释放
用例通过，诊断组两项均通过。并行运行曾触发大报文用例的
5 秒测试超时，按文件顺序重测通过，未放宽测试超时。
根及 CLI 类型检查通过；Lint 无错误（保留存量告警），架构检查无违规。
当前没有物理手机/公开 relay 的端到端验收，也未安装或重启当前客户端。
