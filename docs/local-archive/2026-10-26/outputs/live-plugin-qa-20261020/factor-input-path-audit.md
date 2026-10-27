# 自动因子挖掘：固定 DataRef 到评估输入的公开路径核查

核查日期：2026-10-20。范围是当前工作区源码、声明与既有测试；未连接运行中的桌面或 Agent，未读取任何 SQLite，未调用模型、业务能力或数据导入 API，未登记数据、生成 dataset ID 或修改产品。W1 15:41 暂停以及主数据目录为空是本次任务提供的现场事实，本审计没有重新读取现场确认。

## 结论

**当前内置组合存在可用性/流程接线缺口：已有固定 DataRef 或工作区 JSON 面板，不能通过这三个插件的声明能力直接成为 `factor-evaluator` 所需的宿主登记 dataset。当前前端也没有接入现存 dataset 导入 hook。**

但不能说宿主完全没有导入机制：已实现并有 API 文档的 **`POST /api/v1/datasets`** 可导入原始 JSON/CSV，返回服务生成的 `data_*` ID，写入评估器查询的同一宿主数据目录。这是需要已认证应用客户端调用的原始文件导入 API；不是当前 Agent 声明工具，也不是固定 DataRef 导入接口。它不保留输入 DataRef 的引用关系、原来源或研究执行证据。

因此，W1 对**选定内置评估器**的输入限制判断成立；把它泛化为“所有 `auto_factor_start` 实现都必须 dataset_id”则不准确。工作流允许显式选择其他协议实现，输入要求由所选评估器决定；本轮没有证据表明已有另一个已安装实现能解决该输入缺口，不能默默替换或自行造 ID。

## 实际接口及责任

| 层/入口 | 当前实际行为 | 对本轮输入缺口的意义 |
| --- | --- | --- |
| `sesame/auto-factor-mining#auto_factor_start` | 顶层只有 `request_id/title/goal/dataset_id?/config`，不接受 `ref`、`inputRefs` 或 `path`；只把可选 `dataset_id` 和 `config.evaluator.arguments` 交给所选评估器 `prepare`。 | 编排层不提供数据集、注册器或隐式转换。`dataset_id` 在通用 schema 中可选。 |
| `sesame/factor-evaluator#factor_evaluate`，`action=prepare` | 运行时强制非空 `dataset_id`，发现 `sesame.datasets/1` 后只选择 **`host#datasets`**，以 `{datasetId}` 分页读取，校验返回 metadata.id。 | ArtifactRef.id、插件私有 dataset ID、工作区路径都不能代替该 ID；也不接受外部 SourceRef。 |
| `data_read({ref})` | 读固定 data artifact，把完整行复制到执行目录 `inputs`；返回 `ref/path/rowCount/sample/provenance`。 | 是物化文件，不登记宿主 dataset。 |
| `data_read({})` / `data_read({datasetId})` | 分页列出宿主已登记数据，或物化既有 dataset。 | 只读；空目录不会因为存在 DataRef 自动补齐。 |
| `data_snapshot` / `market_read` | 将真实来源查询冻结为 `kind:data` 的固定 artifact。 | 返回 DataRef，不返回新登记的宿主 dataset ID。 |
| `research_register` | 校验同会话成功执行、冻结输入/输出及配方，发布 DataRef 和 evidence。 | 名称中的 register 指可追溯计算成果发布，**没有写 `dataset` 记录**；不能作为评估器登记入口。 |
| 宿主 `POST /api/v1/datasets` | 参数仅 `{name,content}`；解析 JSON/CSV 后写 `store.put('dataset', …)`，返回服务生成的 ID。需要应用会话认证及 `Idempotency-Key`。 | 文档化低层原始导入路径确实存在；不能声称后端无注册能力。没有 ref/path/provenance/dependencies 输入，来源固定为 `source_kind:user_provided, provider:user_import`。 |
| 前端 `useImportDataset` | 已实现 `File → file.text() → POST /datasets`。 | 全部 `modules/frontend/src` 的引用搜索仅找到定义文件，没有组件导入或调用；当前 UI 没有实际上传入口。 |

主要代码证据：

- [auto-factor-mining/runtime.js:96](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/auto-factor-mining/runtime.js:96)：准备输入在启动调度前完成；[capabilities.json:90](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/auto-factor-mining/capabilities.json:90)声明公开启动参数。
- [factor-evaluator/evaluator.js:19](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/factor-evaluator/evaluator.js:19)：固定选择 `host#datasets`；[第 83 行](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/factor-evaluator/evaluator.js:83)强制 dataset ID；[第 61 行](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/factor-evaluator/evaluator.js:61)的 options 白名单仅包含 `dataset/minRankIC/minCoverage/maxCorrelation`，不能将 `ref` 偷放到 arguments 解决。
- [data-access/research-tools.js:13](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/research-tools.js:13)：只读/物化与计算登记；[capture.js:69](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/capture.js:69)发布的是 artifact。宿主发布落在 [modules/plugins/artifacts.js:65](E:/brief2great/sesame/mt5agent/modules/plugins/artifacts.js:65) 的 `contract_artifact`，不是 `dataset`。
- [server.js:342](E:/brief2great/sesame/mt5agent/modules/agent/server.js:342)：原始导入接口；[tools.js:44](E:/brief2great/sesame/mt5agent/modules/agent/tools.js:44)：导入 provenance 与解析；[system-data.js:48](E:/brief2great/sesame/mt5agent/modules/plugins/host-v2/system-data.js:48)：评估器使用的宿主目录实际读取 `dataset`。
- [datasets.ts:14](E:/brief2great/sesame/mt5agent/modules/frontend/src/lib/api/datasets.ts:14)：未接 UI 的导入 hook；[api-design.md:86](E:/brief2great/sesame/mt5agent/docs/api-design.md:86)：已有 HTTP 导入契约。

## 合格面板与版本约束

本次检查的是现行工作区内容，包含未提交改动，不把 semver 相同视为安装包逐字一致：

| 插件 | 声明版本 | 宿主/API 要求 |
| --- | --- | --- |
| auto-factor-mining | 1.1.0 | apiVersion 2，Sesame >=0.2.4；显式 evaluator 实现 `sesame.factor-evaluator/v1` |
| factor-evaluator | 1.0.1 | apiVersion 2，Sesame >=0.2.3；数值引擎 `sesame-factor-ast/1.0.0` |
| data-access | 3.0.0 | apiVersion 2，Sesame >=0.2.3；依赖 workspace >=3.0.0 |

内置 evaluator 的合格行必须**恰有** `{time,symbol,availableAt,fields}`；时间是带明确时区的 ISO 字符串，`availableAt <= time`，时间/品种不能重复，`fields` 是 1–64 个有限 JS 数值且必须含正数 `close`，最多 20000 行且 4 MiB。训练与验证区间必须实际有行；restricted 还要求留出区间有行，development-only 拒绝 validationEnd 后的行。横截面指标每期少于四个有效配对品种会记为不足，不是登记成功就保证有评价指标。

JSON 导入解析器保留嵌套对象及数值，因此真实合格面板可以由现存 HTTP API 导入。直接 CSV 解析产生的是字符串值，不能自动形成数值型嵌套 `fields`。`market_read` 的原始行是 SourceTime/精确十进制价格等行情形状，也不能直接当作上述面板；时区、可得时间、精度和特征转换仍需要真实研究证据，不能靠改 ID 或补假字段完成。

此外，`auto_factor_start` 是主会话入口；evaluator 是可信工作流嵌套能力，直接 Agent 调用会拒绝。工作流保存所选 evaluator 和 research 插件的 version/digest，恢复会核验，不能在既有 Run 下静默换评估器。来源：[composition.js:42](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/auto-factor-mining/composition.js:42)、[evaluator.js:13](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/factor-evaluator/evaluator.js:13)、[engine.js:112](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/factor-evaluator/engine.js:112)。

## 既有测试覆盖与遗漏

本次只检查测试源码，没有运行测试或声称本轮通过。

- [auto-factor-mining-host.test.mjs:174](E:/brief2great/sesame/sesame/plugins/optional-api-v1/tests/auto-factor-mining-host.test.mjs:174)通过 `app.store.put('dataset', …)` **预置**虚构面板，再验证实际宿主工作流。它覆盖后续消费，不覆盖用户/Agent 从已有 DataRef 登记输入。
- [auto-factor-mining/tests/host-fixture.js:13](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/auto-factor-mining/tests/host-fixture.js:13)直接预置 dataset Map；[factor-evaluator/tests/protocol.test.js:11](E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages/factor-evaluator/tests/protocol.test.js:11)模拟 `host#datasets` 返回已存在的行。它们不能证明入口链路完整。
- [native-research.test.js:9](E:/brief2great/sesame/mt5agent/tests/native-research.test.js:9)使用真实 `/datasets` 导入 CSV，再执行并 `research_register`；验证原始导入与固定计算证据，但没有继续进入 factor evaluator。
- [core-v2-data.test.js:21](E:/brief2great/sesame/sesame/plugins/api-v1/tests/core-v2-data.test.js:21)覆盖快照分页、精确值、来源和冻结依赖；没有 DataRef → host dataset 的桥接测试。

本轮应记录为：**“内置自动因子研究输入准备/导入未闭环；已有低层原始文件导入 API，但当前 UI 与 Agent 声明能力未接入，固定成果的来源关联也没有转换契约。”** 不归因为 MT5、模型拒绝或数据 ID 猜错；不将预置 fixture 的工作流成功等同于真实用户输入链路已验收。

最小责任建议仅供后续设计，不在本轮实施：明确由信息层负责可追溯输入物化/注册，或让数值评估方法明确接受固定 DataRef；编排层保持只选择、传递并冻结输入。若选择恢复原始文件上传 UI，也应承认它与保留 DataRef 谱系的导入是两个不同合同。未来验收至少包含“真实公开入口准备输入 → 主会话启动内置 evaluator → 输入摘要/来源可核验”，不能继续使用 Store 预置替代入口。

本轮到此停止，无登记、重试或恢复动作。

## 本次源码定位

插件仓库 HEAD：`f19d8220a2d0f17c8bd82d65b55825a17a22a935`；应用仓库 HEAD：`ed7c46d27634dc00bd1a91b62d98ccbb2ccb4a08`。均按当前工作区实际内容读取。

| 文件 | 本次读取的 SHA-256 |
| --- | --- |
| auto-factor-mining/runtime.js | `9764f49e655e9f15a39da383a0210de55bdf025fa78c96b7dfdc8e08b89c6f18` |
| factor-evaluator/evaluator.js | `785c728e8d876cc86dd3d5aec90702b83dc9739f12f0a63a5a0fc1ed1cc56030` |
| data-access/research-tools.js | `22cc5fd209a1229ee622b318ce47e30bc6c16c210891adf5ccebd08b228ca00c` |
| mt5agent/modules/agent/server.js | `9be05d076320cee449c3e468bfe4fa1e57a2ccd1f4d1bb373174f9b7216e98eb` |
