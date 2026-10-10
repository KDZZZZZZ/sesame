---
name: quantskills-catalog
description: "按用户需求选择合并后的 Sesame 方法流程与可选后端，并按需查询 QuantSkills 参考目录。"
---

此包为按需安装的标准 MCP，要求 Sesame >=0.2.0-0；不是默认包。服务器使用现有 Python 标准库，不在加载时下载依赖。先核对固定版本与实际工具测试，不能把解析器/参考目录当成行情账户或交易后端。

# quantskills-catalog

本 skill 提供 QuantSkills（https://github.com/quantskills）社区公开资产的目录查询能力。数据来源为 quantskills/quantskills 仓库 README.md 中的表格快照，共 214 项资产、10 个分类。

由 Sesame 维护、在公开插件仓库独立发布，按需安装和加载，无单独密钥或到期时间。先用 `plugin_discover` 查已安装状态；未安装则用 `plugin_catalog` 核对实际可用版本和摘要，再按任务安装。随后 `plugin_load` 加载 `sesame/quantskills-catalog`，实际调用使用工具列表中的完整 MCP 工具名。下文列出的是 MCP 原始工具名。来源摘要与维护说明见 [PROVENANCE.md](PROVENANCE.md)。

## 先按需求去重

用 `catalog_recommend({"need":"factor-research"})` 获取一个完整方法流程，再决定是否需要数据或回测后端。返回的 ID 是路由建议，`availability: not_checked` 不代表已安装、已发布或原生依赖已准备。必须以当时 `plugin_catalog` 和实际环境检查为准，不安装不存在的包，不把所有 `backend_choices` 都装上。

| 用户需要 | need | 合并方式 |
| --- | --- | --- |
| 看不同市场行情 | `market-data` | 按市场选一个明确来源；多个已绑定来源可以共存 |
| 理解政策、制度、群体行为和市场叙事 | `market-explanation` | 一个解释框架选择多种视角，比较替代解释和证伪条件 |
| 波浪、Price Action、ICT、量价图解 | `technical-analysis` | 共用确认时序、候选标注与绘图流程，不按理论重复安装 |
| 自主研究、开发、验证策略 | `strategy-research` | 共用实验流程；语言操作交 strategy-authoring，原生执行交后端 |
| 挖掘、评估、优化因子 | `factor-research` | 同一研究流程保存假设、全部尝试、去冗余、成本与样本外结果 |
| 运行成熟引擎回测 | `native-backtest` | 按原生语言与引擎选择，保留各自撮合假设 |
| 研究报告或策略 tearsheet | `report` | 统一使用 reports，不复制排版插件 |
| 复核未来可验证判断 | `judgment-review` | 判断账本与本轮因子/策略实验分工 |

需要更专门的方法时再查上游参考。先读所选项目原文、实际代码、许可证与数据要求，保留出处；未审计的目录条目不能直接获得执行授权，也不能把其自述当成实测结果。同需 Skill 合并时记录各来源保留的长处、冲突和舍弃理由，原作者与许可证不得抹去。

## 工具

- `catalog_search` — 按关键词在名称和描述中搜索
- `catalog_filter` — 按分类、工作流阶段、资产类型、验证程度筛选
- `catalog_list_categories` — 列出所有分类及数量
- `catalog_get_item` — 按精确名称获取单条完整详情
- `catalog_recommend` — 按 need 返回去重流程、共享基础插件、可选后端和参考条目

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
- `mt5agent_integration` — 历史快照字段，仅表示当时推断的接入方式，不代表 API 1 实装能力

## 局限

- 目录仅为元数据快照，未逐个运行或审计仓库代码
- 接口状态以 README 中记录为准，未实际调用验证
- 数据依赖和接入方式按描述文本推断，部分标为「待评估」
- 快照采集于 2026-10-03，通过独立插件版本更新，不自动同步上游；目录收录不表示这 214 个项目已被安装或由 Sesame 官方维护
- 去重路由是 Sesame 原创方法选择指引；不是对所有参考源码的移植、质量认证或收益证明
