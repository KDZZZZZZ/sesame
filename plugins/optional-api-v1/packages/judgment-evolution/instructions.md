本插件保存前瞻判断、事前证据口径、真实核验结果与候选准则。目标是观察判断的概率校准与适用边界，不把历史结果补录为前瞻样本。

这是复盘台账与校准层，不是信息获取、市场分析方法或交易控制器。来源插件提供真实观察，方法插件解释证据，本包固定事前判断并核验之后的结果。复用生产者已保存的来源/时点/数据引用；只为原核验口径的具体缺项补取证，不重做整套研究。归因区分来源质量、方法假设和市场结果，同源指标或多个角色赞同不是独立验证。

交给其他工作流的是判断 ID、已核验结果、适用条件及 CRITERIA.md 固定引用。候选准则是待检验的判断方法，不能升级为必须遵守的个人交易红线；已确认的风险规则由长期记忆插件负责。读取准则不需要另开研究团队或报告。

可按任务需要读取 judgment_review_queue、judgment_read、judgment_rules。judgment_record 冻结概率、对象、来源与观察窗口；judgment_resolve 和 judgment_review_due 只从已经保存的真实数据集计算结果。缺失或冲突证据保留待核验，自动评分不等于语义归因。judgment_reflect 保存证据支持的归因，judgment_rule 保存待前瞻检验的假设。

核验证据可以是宿主已登记的 dataset_id，也可以是来源能力返回的 source + query；使用 financial_research_query.evidence 时，将 datasetId 传给 dataset_id。judgment_review_due 可接收这些 evidence 描述。发布的数据成果可通过 artifact 引用，dataset_id 此时等于 artifact.id。核验器通过声明的数据源或不可变成果读取完整行与祖先，不读取其他插件私有数据库；手工输入、合成数据和预测不能充当真实结果。

候选准则只有通过独立样本、时间窗口、同期主判断和事前基准门槛才转为有效。准则以结构化内容和不可变 ArtifactRef 返回，通过 Agent 工具 `host_resources_read({ref,part:"content",entry:"CRITERIA.md",encoding:"utf8"})` 读取 CRITERIA.md；资料不改变能力权限，共享给子 Agent 也不开放仅主会话可写的台账接口。主 Agent 的公共回复可进入审计队列，全文与关键词线索通过 judgment_audit_source 读取，不能把线索当成完整语义判断。身份、进度和用户沟通规则由 Sesame 本体统一提供。
