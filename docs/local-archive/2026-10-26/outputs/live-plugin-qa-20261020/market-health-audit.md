# QA20261020 行情健康标记只读核对

结论：本轮证据支持 MT5 券商连接已经恢复。未发现“离线历史缓存使图表冒充实时订阅”的已复现问题。本轮成功不能单独证明断连状态下的冷启动首屏场景已经复验通过。

证据来自主 WAL 中本轮消息元数据及 `conv_main` 的 2026-10-20T12:01:57.526Z 以后 JSONL；抽取结果见 `market-health-audit.json`。未调用行情接口、操作界面、访问子数据库或保存账户标识、价格正文。

| 实际读回时间（UTC） | 工具及事实 |
|---|---|
| 12:03:08.625 | `canvas_inspect`：旧黄金绑定 revision `051361e9…`，`SOURCE_CHANGED`、0 根、feed paused。 |
| 12:03:08.626 | `data_providers`：当前 MT5 来源 revision `afdca8d8…`。 |
| 12:04:10.540 | `canvas_binding`：新品种描述 `meta.freshness=live`，`observedAt=12:04:08.077Z`，真实来源墙时 `2026-10-20T15:04:07`，warnings 为空。未推断 UTC 偏移。 |
| 12:06:57.265 | `market_read`：请求区间为来源墙时 10 月 12 日至 17 日，返回 115 根；新 observation 为 12:06:53.472Z，只有 `NATIVE_JSON_PRECISION` 和 `BROKER_WALL_TIME` 警告，没有 `OFFLINE_CACHE`。coverage.complete 仍为 false。 |
| 12:07:47.666 | `data_read`：独立读回上述新 115 根 artifact，观测时间、来源 revision、警告相同。 |
| 12:09:23.812 | `data_read`：原冻结 114 根 artifact 仍有旧来源 revision、`observedAt=2026-10-17T10:48:57.061Z` 和 `OFFLINE_CACHE`。新旧 artifact/ref 不同。 |
| 12:09:49.216 | `canvas_inspect`：黄金 generation 3、新来源 revision；客户端回执时间 12:09:42.576Z，`status=rendered`、`feed_status=live`、346 根，无错误。 |

代码依据：

- `mt5agent/modules/frontend/src/features/canvas/use-chart-data.ts:178`：支持 `bars.subscribe` 的来源由独立 feed 状态决定健康标记；历史查询的 freshness 不把该 feed 改为 live。
- `mt5agent/modules/frontend/src/hooks/live-feed-pool.ts:19–29`：有效订阅快照或顺序事件才发布 live；stream gap 或连接断开发布 stale。
- `sesame/plugins/optional-api-v1/packages/mt5/backend/providers.js:137–142`：`accountInfo()` 检查绑定身份和 `terminal.server_connected === true`。
- 同文件 `:204`、`:239`：品种描述的在线路径先通过 accountInfo，再读取真实 trade server time；离线来源锚点回退会改成 stale，并追加 `CACHED_SOURCE_TIME`。
- 同文件 `:269–286`、`:303–306`：订阅快照和后续轮询都走 `bars(..., true)`，先校验 accountInfo；tail 模式禁止离线缓存回退。普通历史离线回退保留旧 observedAt，并返回 stale / OFFLINE_CACHE。
- `sesame/plugins/optional-api-v1/packages/mt5/backend/market.js:85–92`：上述读取实际调用 terminal MCP。原生历史读取不走旧 typed 历史缓存；缓存只在明确的失败回退分支读取。

证据边界：

- `data_read` 是不可变 artifact 读回，结果没有顶层 `meta.freshness`；其 provenance 保存观测时间、来源和警告，不是一次新的连接探测。`data-access/market-read.js:83–86` 汇总了这些字段。品种描述的 live 元数据和真实订阅回执共同提供了本轮在线依据。
- 未另发 `get_trading_account_info`，所以没有额外独立保存的原始 `server_connected` 返回；连接恢复结论基于已有读回及其必经校验路径。
- 346 是图表当前保留窗口的根数，115 是另一个明确区间查询，114 是之前冻结的 artifact；三个计数不能直接相互判定一致性。未检查或重算价格内容。
- 此结论限定于以上观测时刻，不断言之后持续在线，也不将历史覆盖不完整改写为完整。
