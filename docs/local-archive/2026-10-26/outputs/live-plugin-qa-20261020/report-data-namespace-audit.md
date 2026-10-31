# report_data 三次失败：数据集来源命名空间不匹配

只读结论：本轮是 **MT5 插件数据集被当成宿主登记数据集**，不属于旧 schema、未安装最新插件或已证实的 handler 缺陷。拒绝与当前实现一致；“资源不存在”以及部分说明未明确 `host#datasets` 的范围，容易使 Agent 误判。

范围：主回复 `msg_1360d38e-510f-43d5-99c1-9741c532ddaf`，2026-10-20 12:41:19.583Z 起，取证截止 12:46:00Z。只读主 WAL 元数据、本轮主会话 QA JSONL及源码/安装包。未读取子库、账本正文、账户标识、凭据或思考；没有执行任何数据查询能力或业务操作。

| UTC | 事实 |
| --- | --- |
| 12:44:24.708 | 同批 3 个 `report_data`，分别处理 3 个不同的真实 MT5 `dataset_id`；不是同一数据集重试三次。 |
| 12:44:28.521–.522 | 三个结果均为 `isError:true`，准确错误均为 **`资源不存在`**。 |
| 12:45:32.004 | 三个 `data_snapshot` 显式使用 `source.providerId="sesame/mt5#datasets"`，revision 为当前 MT5 2.1.3 digest，input 为 `{datasetId:…}`。 |
| 12:45:43.208–.209 | 三个结果均为 `isError:false`、`rowCount:1`、发布回执 `status:"published"`；保存的是每个原生命令的一行证据，不是证明原生命令的每个业务目的已实现。 |

失败时准确入参形状：

```js
report_data({
  operation_id: "<独立稳定键>",
  dataset_id: "<MT5 原生回执给出的 data_UUID>",
  provenance_kind: "observed"
})
```

没有传 `source`、`input`、`title` 或 `dependencies`。使用已安装 reports 3.0.3 schema 做纯内存检查，此形状合法；不存在因少了 source/input/title 而拒绝 dataset_id 分支的问题。

前后 ID 在内存中逐字比较完全相同。这里只保留 ID 的 SHA-256 前 12 位：

| dataset ID 摘要 | 原始来源回执 | 后续同 ID 冻结 |
| --- | --- | --- |
| `d8ced6640e4c` | 12:42:43.342，`mt5_trade` / Python `initialize` | 12:45:43.208，MT5 datasets source，published |
| `470f59da5d5e` | 12:43:33.656，`mt5_python` / Python `terminal_info` | 12:45:43.209，MT5 datasets source，published |
| `37f889d96f0d` | 12:42:22.906，`mt5_call` / Terminal `get_trading_account_info` | 12:45:43.209，MT5 datasets source，published |

当前安装 reports 为 3.0.3 / `sha256:090ca3886797bfd4a6a14cc4689225f3268b951c28fa89a01b4921c8568614a5`。安装目录与最新仓库的 `index.js`、`capabilities.json`、`prompt.md` 逐字节相同。

源码证据：

- `sesame/plugins/api-v1/packages/reports/capabilities.json:129`：oneOf 明确接受裸 `dataset_id`，或互斥的 `source+input+title`；该工具 description 已写 **registered host dataset**，但 `dataset_id.description` 仅写 “Existing registered dataset ID”，usage/prompt 也使用较泛的“登记 dataset”。
- `reports/index.js:26–29`：裸 `dataset_id` 固定转为 `source:{providerId:"host#datasets",revision:"host:2"}` 和 `input:{datasetId:args.dataset_id}`；显式 source 则原样传给 `data_snapshot`。这两种调用不搜索或猜测其他数据源。
- `mt5agent/modules/plugins/host-v2/system-data.js:48–56`：host datasets 只查询宿主 Store 的 `dataset` 记录；不存在时 `modules/agent/store.js:164` 抛 404 `not_found` / “资源不存在”。
- `sesame/plugins/optional-api-v1/packages/mt5/backend/sources.js:50–53`：MT5 datasets 查询的是独立的 `service.mt5.storage`。`backend/official.js:262–267` 保存的 native command dataset 位于此插件数据空间。

既有 `report_data` 也支持正确来源，无需新增接口。以下只是通过现有 schema 的说明性形状，**本次没有实际调用**：

```js
report_data({
  operation_id: "<稳定键>",
  source: { providerId: "sesame/mt5#datasets", revision: "<当前目录返回的修订>" },
  input: { datasetId: "<MT5 dataset_id>" },
  title: "<本次证据标题>",
  provenance_kind: "observed"
})
```

纯内存 schema 校验：上述显式来源形状和原裸 ID 形状均为 `true`；校验没有调用 handler、查询数据库行或冻结数据。

最小建议：优先将 `dataset_id` 字段描述、usage 和报告指南明确为 **仅 host#datasets 的宿主登记数据 ID**；MT5 等插件回执给出的 `dataset_id` 必须带其已声明 SourceRef 与 `{datasetId}`，或直接复用既有 DataRef。若后续要改错误提示，只对裸 ID 分支的确定 not_found 补充“这是 host#datasets；插件数据请显式指定 source”，保留原错误类型，不自动跨 provider 查找、猜 ID、注册副本或伪造空行。此轮 Agent 已自行用正确来源成功冻结，不需要重做报告。

本次没有修改产品、提示词、版本、已安装包或业务内容。
