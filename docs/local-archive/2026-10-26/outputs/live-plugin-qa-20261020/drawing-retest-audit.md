# cache-retest 绘图回执审计

审计对象：主消息 `msg_23e6df49-9f61-4b0a-881c-e8449fc9d8d9`。证据截止 `2026-10-20T10:16:53.554Z`。本次只读主工作区数据库中该消息、对应主会话 JSONL 和源码；未读取子任务数据库、调用业务接口或修改业务数据。

## 结论

1. 本次 `chart_drawing` 失败符合当前绑定保护规则，未发现 schema 与实现不一致或绘图保存异常。Agent 试图将旧 BTC 绘图原地改绑到新版 CCXT SourceRef；原绘图与目标 binding 的唯一差异是 `source.revision`，因此被拒绝。
2. 后续 `completed` 并非失败更新重试成功，而是四次新建：黄金水平线、黄金趋势线、新 ID 的 BTC 水平线和趋势线。旧 BTC 两个绘图保留且 `active:false`。
3. 四个新绘图的保存及随后独立回读已成立：源码、几何、binding、ArtifactRef 的 ID/revision/digest 均与写入回执一致。此证据不等于画面验证通过，也不包含本次真实桌面重启验证。

## 失败实际参数与原因

主会话 JSONL 第 1189 行，`2026-10-20T10:12:09.140Z`：

```json
{
  "action": "put",
  "command_id": "QA20261020-retest-btc-horizontal-rebind-01",
  "expected_version": 27,
  "chart_id": "chart_QA20261020_crypto",
  "drawing_id": "QA20261020_btc_reference",
  "expected_revision": "revision_e2b5f911-5278-4ee0-8306-2c7604595eb2",
  "drawing": {
    "schemaVersion": "sesame-drawing/1",
    "kind": "horizontal",
    "title": "QA20261020 BTC 闭柱参考 81428.6 USD",
    "anchors": [{"time": 1792483200, "price": 81428.6}],
    "style": {"color": "#24866e", "width": 2, "lineStyle": "dashed", "fillOpacity": 0}
  }
}
```

实际调用还携带完整当前 binding；上面为脱敏摘录，省略源配置与连接内容。provider 为 `sesame/ccxt#market`，instrument 为 `BTC/USD` / `ccxt:kraken:spot`，timeframe 为 `1h`。对成功回执中保留的旧绘图与新绘图 binding 逐字段比较，唯一变化是：

- 旧 `source.revision`：`sha256:07f5747a62db288e9b3b055ab0c05e0fa5c8c67a4f161a39f53949bd4ffdf633`
- 当前 `source.revision`：`sha256:cc8ad04b57095592653ef039a5b1b5368c638e18af0383ccca0c53a294912d5d`

第 1191 行，`10:12:11.240Z` 返回 `isError:true`，原文为“此绘图属于另一个行情来源”。消息本身未返回结构化错误码；该原文精确对应 [canvas-service.js:301](E:/brief2great/sesame/mt5agent/modules/agent/canvas-service.js:301) 的 `409 / drawing_binding_changed` 分支。当前画布 binding 检查和绘图修订检查位于该分支之前。保护在发布成果前执行，因此这次失败没有生成新的绘图成果；下次新建仍以画布 v27 为起点。

## 随后成功的操作

下表时间均为 UTC，行号来自同一主会话 JSONL：

| 成功回执时间 | 调用 / 回执行 | 新 drawing_id | 画布版本 |
| --- | --- | --- | --- |
| 10:13:00.278 | 1192 / 1193 | `QA20261020_gold_reference` | 28 |
| 10:13:27.030 | 1195 / 1196 | `QA20261020_gold_trend` | 29 |
| 10:14:36.277 | 1197 / 1198 | `QA20261020_btc_reference_v202` | 30 |
| 10:14:53.726 | 1199 / 1200 | `QA20261020_btc_trend_v202` | 31 |

四次新建均使用 `expected_revision:null`。BTC 新绘图使用当前 SourceRef，未覆盖旧 ID。

## 持久化及 Agent 可感知证据

真实 Agent 随后分别调用 `chart_drawing(action:"read")`，回执如下：

| drawing_id | 回读时间 / JSONL 行 | ArtifactRef ID | revision |
| --- | --- | --- | --- |
| `QA20261020_gold_reference` | 10:16:26.387 / 1204 | `artifact_2ffc2c50-9f22-459c-a06f-852b60a2d675` | `revision_1b7a76fc-f1e2-4aad-ac86-13f6ed337282` |
| `QA20261020_gold_trend` | 10:16:26.387 / 1205 | `artifact_57781f60-c056-4468-ae79-e6073a678ea5` | `revision_acadaf1a-b813-44a9-af0a-156d48198f66` |
| `QA20261020_btc_reference_v202` | 10:16:53.554 / 1211 | `artifact_e4c9e182-b27f-4c04-b5ee-c0434a9dddbd` | `revision_712faf48-b9cc-4ef6-8bc8-ff5f78965993` |
| `QA20261020_btc_trend_v202` | 10:16:53.554 / 1212 | `artifact_8b435c78-5de7-4fe2-894d-5e947d8aeb4a` | `revision_0c3207a0-1b5d-4135-8931-9797b0a4c8ee` |

四条回读均为 `kind:indicator`、`schemaVersion:1.0.0`、`active:true`，包含完整 `source`。逐项比较写入与独立回读结果，source、drawing.revision、ArtifactRef ID/revision/digest、binding、spec 全部一致。源码包含 `export const drawing` 与返回 `drawings:[drawing]` 的 `compute`。第 1210 行 `canvas_inspect` 同时返回全部六条记录及源码，旧 BTC 两条仍为 `active:false`。

实现与这些回执吻合：[canvas-service.js:312](E:/brief2great/sesame/mt5agent/modules/agent/canvas-service.js:312) 发布 `compute.js` indicator 成果并保存 `canvas_script`；[canvas-service.js:280](E:/brief2great/sesame/mt5agent/modules/agent/canvas-service.js:280) 的 read 重新读取记录和成果资源。代码库另有 Store 关闭重开覆盖，见 [canvas-drawings.test.js:77](E:/brief2great/sesame/mt5agent/tests/canvas-drawings.test.js:77)；本次审计没有重跑测试，不将它记为本轮桌面实测。

## 视觉验证边界

第 1210 行的画布 v31 与 render receipt v31 一致，但 BTC 图表仍为 `status:error`、`feed_status:stale`、500 根缓存柱，错误为 `RATE_LIMITED` / `EGeneral:Too many requests`；黄金图表为 `status:error`、`feed_status:stale`、0 根柱，错误为 `SOURCE_UNAVAILABLE` / `MT5 is not connected to broker`。另一旧图表仍报告 source revision changed。

`active:true` 由绘图与图表 binding 相等计算，见 [canvas-service.js:254](E:/brief2great/sesame/mt5agent/modules/agent/canvas-service.js:254)，不是像素渲染成功回执。因此可以确认“已保存、绑定匹配、Agent 能回读可执行代码”，不能确认“两个图表都已正常显示全部绘图”。

## schema / 说明核对及最小建议

当前 [capabilities.json:1458](E:/brief2great/sesame/sesame/plugins/api-v1/packages/canvas-control/capabilities.json:1458)、[prompt.md:31](E:/brief2great/sesame/sesame/plugins/api-v1/packages/canvas-control/prompt.md:31) 与 [market-chart/SKILL.md:38](E:/brief2great/sesame/sesame/plugins/api-v1/packages/canvas-control/skills/market-chart/SKILL.md:38) 均要求完整当前 binding、当前绘图 revision，并说明不同绑定的旧绘图保留而不显示。未发现此次参数需要旧接口兼容或 schema 修补的证据。

如要降低插件更新后的无效尝试，最小改进是补明：“source.revision 也是 binding 身份的一部分；旧绑定绘图不能通过保留 ID 原地迁移。确认需要在新绑定复用几何时，先读取旧 source，再以新 ID、expected_revision:null 新建，保留旧记录。”同时增加仅 source.revision 变化的回归用例：旧对象不活跃、旧 ID 更新被拒绝、新 ID 创建成功、旧成果保持不变。现有 [canvas-drawings.test.js:56](E:/brief2great/sesame/mt5agent/tests/canvas-drawings.test.js:56) 已覆盖 instrument 切换，未在该用例覆盖这次 revision-only 变化。此建议交主任务判断，本次未修改代码或说明；不建议自动忽略 SourceRef revision。

证据来源：`%LOCAL_USER_PROFILE% 中指定主消息；`%LOCAL_USER_PROFILE% 指定行。没有扩大到其他会话或子任务数据库。
