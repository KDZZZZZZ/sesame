# 固定 DataRef 到因子评估的最小修复建议

检查时间：2026-10-21（UTC）。本文件保留修复前的只读定位和建议。随后主线程授权在 factor-evaluator 包内实现，当前源码修复及验证结果见 `IMPLEMENTATION.md`；本文件中的原始红测试结果是修复前证据。全程没有访问安装数据、SQLite、Runtime/Store、业务模型或交易接口。

## 结论

**断链仍存在，适合做一项有界插件 bug 修复。** 既有审计的 4 个关键文件与当前内容 SHA-256 完全相同。已有 `auto_factor_start.config.evaluator.arguments` 会原样成为数值评估器的 `options`，因此不必新增宿主 dataset 导入接口，也不必在编排层加入数据注册/格式转换逻辑。

建议内置 `factor-evaluator` 在现有 options 增加 `inputRef`，接受已发布、固定版本的 `kind:data` JSON 数值面板。它与原 `dataset_id` 二选一；固定 Ref 由现有 `host.resources.read` 读取并核验。数据获取和真实面板转换继续归信息/研究能力，评估器只消费合格面板，不把原始 MT5 价格行偷偷变成数值研究数据。

该方案是可追溯数据消费的缺口修复，不是给用户提供任意工作区路径导入、上传 UI 或新的数据集管理功能。若要求这些入口，应另立范围，不能混进本次修复。

## 当前证据和红测试

- `factor-evaluator/evaluator.js:83` 在读取任何数据前强制 `dataset_id`，`options` 白名单也不接受 Ref。
- `auto-factor-mining/runtime.js:96–100` 已将可选 dataset_id 及 evaluator.arguments 传给 prepare；同一协议明确允许评估实现自行定义 options，通用工作流无需知道具体数据源。
- `data-access/research-tools.js` 已能物化 DataRef，`research_register` 可发布经过真实执行记录约束的固定 DataRef，但它不登记宿主 dataset。这不是应当靠改 ID 绕过的错误。
- `host.resources.read(ref,{part:'manifest'})` 返回固定 manifest，读取 content 时必须明确 `entry:manifest.content.path`，分页最多 256 KiB。宿主精确匹配 id/revision/digest/kind/schemaVersion 并核验 blob，插件无需另造读取后门。
- `auto-factor-mining/archive.js:26` 的最终报告现在把 `dependencies` 和 provenance.references 固定为空。新输入路径应同步把通用 `data.inputRefs` 绑定到报告，避免只在附件 JSON 里写来源却不形成报告依赖关系。

已执行：

```powershell
node --test outputs/live-plugin-qa-r3-20261021/factor-input/current-contract.test.mjs outputs/live-plugin-qa-r3-20261021/factor-input/dataref-input.red.test.mjs
```

结果：**1 通过、1 预期失败**，失败是 `EVALUATION_REJECTED: dataset_id is required`。`current-contract.test.mjs` 是当前限制的行为确认；`dataref-input.red.test.mjs` 是建议的新合同回归草稿，**当前产品没有通过它**。草稿只有纯内存端口；它不使用宿主数据目录预置来掩盖缺口。

## 输入与来源合同

工作流输入示意（`<...>` 必须替换成真实公开回执，示意值不可调用）：

```json
{
  "config": {
    "evaluator": {
      "plugin_id": "sesame/factor-evaluator",
      "tool": "factor_evaluate",
      "arguments": {
        "inputRef": {
          "id": "<returned artifact id>",
          "revision": "<returned exact revision>",
          "digest": "<returned sha256 digest>",
          "kind": "data",
          "schemaVersion": "1.0.0"
        },
        "dataset": {
          "trainEnd": "<explicit timezone timestamp>",
          "validationEnd": "<explicit timezone timestamp>",
          "holdoutEnd": "<explicit timezone timestamp>"
        }
      }
    }
  }
}
```

1. `prepare` 接受一个且仅一个输入：非空 `dataset_id`，或 `options.inputRef`。Ref 必须是完整固定 data ArtifactRef；拒绝只有 id、ResourceRef、SourceRef、路径、HTTP URL、其他 kind 和额外结构字段。不猜 ID、不通过 `data_read` 写工作区中转、不自动 POST /datasets。
2. 固定 manifest 必须是 `json-rows`，内容 entry、rowCount、blob 大小与实际读取相符。按字节累计上限 4 MiB，校验正向分页 cursor，并在每页读取前检查 signal；不静默截断、无上限拼接或自动选最新 revision。
3. 原有 `prepareDataset` 一次负责规范化和数值校验：恰有 time/symbol/availableAt/fields，显式时区、PIT、非重复、有限数值、正 close、最多 20000 行、训练/验证/留出规则。保持 development-only 拒绝 validationEnd 后输入；不足四品种/样本不产生虚假指标。
4. `prepared.data.inputRefs` 原样保留完整 Ref 数组，本实现长度为 1；`data.provenance` 原样保留输入 manifest.content.provenance；可附 `data.dependencies` 原样保留输入 manifest.dependencies。不得把 demo/synthetic 洗成 observed，不省略 execution/evidence 等已有来源信息。继续遵守现有 provenance 12 KiB 上限，超限明确失败，不丢字段后成功。
5. 冻结身份应包含 **完整输入 Ref**，不只 id。建议统一一个输入摘要 helper，用规范化 dataset、sourceId 以及 inputRefs 计算 inputDigest；prepare 与后续 frozen-input 校验必须用同一规则。已登记 dataset 分支可不附 inputRefs；其现有身份/数据计算不变。同 run_id 换 revision/digest 即使行恰好相同也应冲突。不能只改 prepare 后把 candidate 的摘要验证弄坏。
6. 继续使用 evaluator 原 sessions、私有 durable resources、CAS 和幂等会话。只保存已核验的本次字节，不追踪可变 head；同一输入重复调用返回原 prepared/候选/selection/final 回执，原有可信 nested caller、owner 和 holdout 访问边界不变。
7. 报告发布只需通用消费 `run.data.inputRefs ?? []`，作为 report dependencies 和 provenance.references；不在工作流解释 DataRef 数值格式或重读原始面板。报告已有 run.json/factors.json 会携带准备回执和来源详情。DataRef 自身已绑定 evidence，报告绑定它即可保留传递谱系。

## 最小文件责任

| 文件 | 修复责任 |
| --- | --- |
| `plugins/optional-api-v1/packages/factor-evaluator/evaluator.js` | 唯一数据入口选择；完整 Ref 校验、受限读取；保留来源；统一冻结输入摘要。复用数值引擎及已有资源/会话逻辑。 |
| `factor-evaluator/capabilities.json`、`prompt.md`、`README.md`、`PROTOCOL.md` | options.inputRef 精确声明，二选一输入要求，data.inputRefs 通用输出语义；移除“内置实现只能 registered dataset”的旧口径。 |
| `factor-evaluator/tests/protocol.test.js` 或专用 `input-ref.test.js` | 引入本目录红测试及下列边界矩阵；不新增真实模型依赖。 |
| `auto-factor-mining/archive.js` | 只把 evaluator 返回的通用 inputRefs 绑定成报告依赖；不增加注册器、计算、输入修补或新状态机。 |
| `auto-factor-mining/prompt.md`、`README.md` | 展示现有 evaluator.arguments 的 Ref 用法；解释只有合格面板能评估，不能拿原始行情 Ref 直接顶替。 |
| 工作流报告单元测试/组合测试 | 验证 options 现有透传、报告依赖和没有 host dataset 回退。不得导入创建 Runtime 的现有 fixture 来验证此只读草稿。 |
| 两包 plugin/package 版本及官方 lock/inventory 中对应条目 | 上述包内容变动后的正常摘要/版本维护。不得全量重生覆盖其他未提交改动。 |

不应修改 `mt5agent` 宿主、data-access 私有实现、`auto-factor-mining/runtime.js` 编排、`engine.js` 数值公式、现有历史 Run 或安装数据来“让测试通过”。不要跨包 import data-access 私有 `capture.js`；同一资源端口的小型读取适配应留在 evaluator 边界内。

## 进入真实模型复测前的最小回归

| 情况 | 必须观察到的结果 |
| --- | --- |
| 合格固定 Ref，无 dataset_id；数据源目录不存在 | prepare → candidate → select → finalize 成功；host.data 从未调用；来源和 inputRefs 完整；测试数值与既有合成面板一致。 |
| 合格原 dataset_id | 既有行为及 frozen-input 校验不变。 |
| 两种输入都给/都不给，Ref kind/结构错误 | 在读数据或写 session 前明确失败。 |
| 同 id 不同 revision/digest | 精确读取；同 run 冲突；新 run 的 inputDigest 不同；不得偷偷取 latest。 |
| 大于 4 MiB、超过 20000 行、坏 JSON、非前进 cursor、取消 | 有界失败，不创建成功 prepared/伪造指标或截断后的数据集。 |
| 原始行情行、PIT 错误、非法数值、development-only 含未来行 | 由既有引擎正常拒绝，不能自动编造 availableAt/time/close。 |
| demo 源、证据引用、原 provenance | synthetic 标记、完整来源及报告传递依赖保留。 |
| 同一 prepare 和候选重复、跨 owner/不可信调用 | 沿用现有幂等或拒绝规则，不扩大访问权限。 |

真实模型复测应新开本轮 QA 的工作流，不恢复 14 个历史暂停 Run。由 Sesame Agent 用已有合格 DataRef，或自己通过已授权数据/研究执行能力获得面板，调用新的公开输入合同；验证准备回执、实际数值结果、报告依赖与视觉。根 Agent 不代做业务转换，不用 Store 预置伪造“真实入口已闭环”。当前红测试和现有合成 fixture 不是这一步的替代。

## 源码指纹

| 文件 | 本次 SHA-256（与前次审计一致） |
| --- | --- |
| `auto-factor-mining/runtime.js` | `9764f49e655e9f15a39da383a0210de55bdf025fa78c96b7dfdc8e08b89c6f18` |
| `factor-evaluator/evaluator.js` | `785c728e8d876cc86dd3d5aec90702b83dc9739f12f0a63a5a0fc1ed1cc56030` |
| `data-access/research-tools.js` | `22cc5fd209a1229ee622b318ce47e30bc6c16c210891adf5ccebd08b228ca00c` |
| `mt5agent/modules/agent/server.js` | `9be05d076320cee449c3e468bfe4fa1e57a2ccd1f4d1bb373174f9b7216e98eb` |

补充证据仅为当前源码和上述两项纯函数测试，不包含本轮现场安装包 digest 核验。因此结论针对当前工作区合同，不把 semver 等同于线上包字节一致。
