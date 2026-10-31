---
name: quantskills-catalog
description: "按用户指定的方法选择独立 Sesame 插件，只合并同方法的重复来源，并按需查询 QuantSkills 参考目录。"
---

此包声明 Sesame API 2，通过标准 MCP 传输提供目录能力，宿主版本范围以本包 manifest 声明为准；按需安装，不是默认包。服务器使用现有 Python 标准库，不在加载时下载依赖。先核对固定版本与实际工具测试，不能把解析器/参考目录当成行情账户或交易后端。

# quantskills-catalog

本 skill 提供 QuantSkills（https://github.com/quantskills）社区公开资产的目录查询能力。数据来源为 quantskills/quantskills 仓库 README.md 中的表格快照，共 214 项资产、10 个分类。

由 Sesame 维护、在公开插件仓库独立发布，按需安装和加载，无单独密钥或到期时间。先用 `plugin_discover` 查已安装状态；未安装则用 `plugin_catalog` 核对实际可用版本和摘要，再按任务安装。随后 `plugin_load` 加载 `sesame/quantskills-catalog`，按宿主工具列表中的能力本地名称调用，例如 `catalog_search`；不要自行拼接 MCP 前缀。来源摘要与维护说明见 [PROVENANCE.md](PROVENANCE.md)。

## 先按需求去重

综合投资研究使用 `catalog_recommend({"need":"investment-research"})`，推荐 Research（`sesame/investment-research`）。因子或策略研究使用 `need:"strategy"`，推荐 Strategy（`sesame/auto-factor-mining`）；研究知识和可选参考脚本已在工作流内提供。再按实际需求选择数据和回测后端。用户只要 ICT，就用 `catalog_recommend({"need":"technical-analysis","method":"ict"})`，只加载 `sesame/ict`。不传 method 时返回选择项和 `selection_required:true`，不能理解成要安装或同时启用全部方法。返回的 ID 是路由建议，`availability: not_checked` 不代表已安装、已发布或原生依赖已准备。必须以当时 `plugin_catalog` 和实际环境检查为准，不安装不存在的包，不把所有 `backend_choices` 都装上。

| 用户需要 | need | 合并方式 |
| --- | --- | --- |
| 看不同市场行情 | `market-data` | 按市场选一个明确来源；多个已绑定来源可以共存 |
| 理解政策、制度、群体行为或市场叙事 | `market-explanation` | 行为金融、制度分析、叙事分析分别选择，方法内比较证据和证伪条件 |
| 波浪、Price Action、ICT 等图解 | `technical-analysis` | 用 method 单独选理论；数据、时点事实和绘图基础可复用，不能强制混用理论 |
| 综合投资研究 | `investment-research` | Research：根据问题与交付结果组织需求、获取、分析和报告；不固定分析方法 |
| 因子与策略实验 | `strategy` | Strategy：统一实验入口，保存假设、全部尝试、去冗余、成本和样本外结果；真实交易规则回测独立选择原生引擎 |
| 历史同类情景与概率校准 | `historical-evidence` | 独立计算插件；先近期同品种再扩大样本，分开经验频率、校准拟合与独立评价，保留反例和适用条件 |
| 交易结果诊断 | `trade-results` | 绩效与逐笔审计两个实际能力；消费已有结果，不生成成交或替代原生引擎 |
| 已有参数试验的排名和选择证据 | `parameter-evidence` | input-only 网格、已提供开发指标和所选留出校验；原生 optimizer 另由所选引擎执行 |
| 同期收益相关与方向一致性 | `series-similarity` | 精确收益起止时点对齐；不当作历史情景检索或预测概率 |
| 运行成熟引擎回测 | `native-backtest` | 按原生语言与引擎选择，保留各自撮合假设 |
| 研究报告或策略 tearsheet | `report` | 统一使用 reports，不复制排版插件 |
| 复核未来可验证判断 | `judgment-review` | 判断账本与本轮因子/策略实验分工 |

**同一方法去重，不同方法独立。** 例如多个 ICT Skill 可在一个 ICT 包内取长补短，ICT 与波浪不能因为都能分析行情而合并。同一任务可按需组合多种方法，分别记录输入、参数、支持与反证；安装一种方法不会自动安装或加载另一种。需要更专门的方法时再查上游参考，先读原文、实际代码、许可证与数据要求，保留出处；未审计条目不能直接获得执行授权，也不能把自述当成实测结果。合并时记录保留的长处、冲突和舍弃理由，原作者与许可证不得抹去。

## 工具

检验是了解适用边界的证据。Agent 按任务选择项目和阈值；用户明确指定的要求优先。不能因为某项较弱就自动淘汰因子：有可核验证据支持的条件用途应保留有效环境、失效环境、反例与监控条件。只有用户明确要求的硬性约束才阻止选择。所有选择和阈值应在相应评价前记录，最终留出结果不能回流调参。

- `catalog_search` — 按关键词在名称和描述中搜索
- `catalog_filter` — 按分类、工作流阶段、资产类型、验证程度筛选
- `catalog_list_categories` — 列出所有分类及数量
- `catalog_get_item` — 按精确名称获取单条完整详情
- `catalog_recommend` — 按 need / method 返回独立方法、共享基础插件、可选后端和参考条目

## 使用示例

1. 查看分类总览：`catalog_list_categories({})`
2. 搜索 alpha 因子：`catalog_search({"query": "alpha", "limit": 10})`
3. 筛选因子研发类 skill：`catalog_filter({"category": "02 因子研发工具箱", "asset_type": "skill", "limit": 20})`
4. 获取单项详情：`catalog_get_item({"name": "skill-factor-alpha191-alpha101"})`

## 字段说明

- `category` — 上游 10 大分类（如 "02 因子研发工具箱"）
- `subcategory` — 细分主题（如 "因子生成"）
- `stage` — 研究工作流阶段（data-ingestion, factor-generation, evaluation 等）
- `asset_type` — skill / agent / template / infrastructure
- `verification_level` — published_endpoint / pending_review / unknown
- `data_dependencies` — 已知数据或 API 依赖列表
- `mt5agent_integration` — 历史快照字段，仅表示当时推断的接入方式，不代表当前宿主已实装、安装或授权的能力

## 局限

- 目录仅为元数据快照，未逐个运行或审计仓库代码
- 接口状态以 README 中记录为准，未实际调用验证
- 数据依赖和接入方式按描述文本推断，部分标为「待评估」
- 快照采集于 2026-10-03，通过独立插件版本更新，不自动同步上游；目录收录不表示这 214 个项目已被安装或由 Sesame 官方维护
- 去重路由是 Sesame 原创方法选择指引；不是对所有参考源码的移植、质量认证或收益证明
