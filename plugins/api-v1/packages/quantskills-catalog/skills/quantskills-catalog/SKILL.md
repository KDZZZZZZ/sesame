---
name: quantskills-catalog
description: "查询 QuantSkills 社区目录：按关键词搜索、分类筛选、获取单条详情。"
---

# quantskills-catalog

本 skill 提供 QuantSkills（https://github.com/quantskills）社区公开资产的目录查询能力。数据来源为 quantskills/quantskills 仓库 README.md 中的表格快照，共 214 项资产、10 个分类。

由 Sesame 维护并随应用发布，默认按需加载，无单独密钥或到期时间。先用 `plugin_load` 加载 `sesame/quantskills-catalog`，实际调用使用工具列表中的完整 MCP 工具名。下文列出的是 MCP 原始工具名。来源摘要与维护说明见 [PROVENANCE.md](PROVENANCE.md)。

## 工具

- `catalog_search` — 按关键词在名称和描述中搜索
- `catalog_filter` — 按分类、工作流阶段、资产类型、验证程度筛选
- `catalog_list_categories` — 列出所有分类及数量
- `catalog_get_item` — 按精确名称获取单条完整详情

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
- `mt5agent_integration` — native / via_data_bridge / file_import / 待评估

## 局限

- 目录仅为元数据快照，未逐个运行或审计仓库代码
- 接口状态以 README 中记录为准，未实际调用验证
- 数据依赖和接入方式按描述文本推断，部分标为「待评估」
- 快照采集于 2026-10-03，随应用版本更新，不自动同步上游；目录收录不表示这 214 个项目已被安装或由 Sesame 官方维护
