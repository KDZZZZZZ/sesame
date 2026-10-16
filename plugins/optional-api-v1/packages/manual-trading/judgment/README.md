# 手工交易判断与复盘

此目录是插件私有的判断证据引擎。通过 capabilities.json 中的 manual_judgment_* 能力调用；activate、afterAgentTurn、dispose 生命周期由同一静态声明绑定。

判断、样本与候选准则保存在 host.context.storageRoot/judgment-state/judgments.sqlite。每次调用先通过 host.data 查询公共 sessions、messages、datasets 数据源，形成完整不可变快照，再执行同步 SQLite 业务事务。时间边界、原始来源和独立样本检验保留。

导出的准则通过 host.resources 发布不可变 ArtifactRef。Agent 使用 host_resources_read，part="content"、entry="CRITERIA.md" 读取；委派任务需显式允许 host.resources.read。插件私有草稿仍不可跨插件读取。

核验证据可以引用宿主已登记 dataset_id，或提交来源能力返回的 source + query。financial_research_query 返回 evidence:{datasetId,source,query}，resolve 使用其 datasetId 作为 dataset_id；review_due 可接收 evidence 数组。也可传 artifact: 发布的数据 ArtifactRef，此时 dataset_id 必须等于 artifact.id。读取完整行、祖先数据和真实发布者后再评分；不读取其他插件私有数据库，不把手工输入、合成数据或模型输出当作外部事实。
