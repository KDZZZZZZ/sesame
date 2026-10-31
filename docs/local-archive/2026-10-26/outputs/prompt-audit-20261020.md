# 提示词旧口径检查与修正

日期：2026-10-20。检查对象是本地当前实现，包含宿主提示、Agent 工具说明、9 个核心插件、46 个可选插件的当前提示与模型可读技能资料；按要求排除 Kurumi。历史资料和真实兼容接口不做机械替换。

| 范围 | 旧口径或缺项 | 修正后的约定 |
| --- | --- | --- |
| 配置与密钥 | 配置技能仍从环境变量入口开始；遗漏统一字段与能力依赖；部分说明错误地给所有设置要求版本 | 优先读取 integration catalog，按 authority 保存实际字段，检查依赖能力；只有实际返回的版本参与冲突检查，保留原有配置入口 |
| 报告 | 指定路径后仍可能只返回内部数据或聊天摘要 | 显式要求报告或指定报告路径必须真实交付；区分预留位置、草稿、已发布版本与实际渲染验收；子任务输出不匹配时反馈所属 Agent |
| 编排 | 仅说明主动等待，遗漏完成通知和空闲唤醒 | 顶层子任务完成后通知所属主 Agent，空闲时可以继续；嵌套成员通过控制器返回，历史暂停不自动恢复 |
| 插件通讯 | 开发资料未覆盖已实现的消息入站 | 使用现有 events.emit / workspace.agent.message，说明 user、automation、来源、幂等和队列语义 |
| Investment Research | 报告、问答和重跑说明依赖固定角色名 | 以实际成员、synthesis 和 qa_context 为准；报告要求优先，内部研究成果不能冒充报告交付 |
| Trading Decision | 仍称“手工交易计划”、固定经理和执行员、仅执行后归档；runs 输出说明过时 | 区分默认成员与可选复核；说明 execute:false、被复核阻止时的真实结果和报告；list 输出对齐 items/total/nextOffset |
| Auto Factor Mining | 固定五角色图、模型覆盖字段说明不完整 | 区分默认流程和当前成员 ID；保留插件 interrupt_ids，并说明宿主参数为 interruptIds |
| QMT | 描述声称旧 runtime-signed 意图仍可授权交易 | 删除实现已经拒绝的授权路径，按现有宿主调用链执行 |
| Factor / Strategy Research | 因子研究被描述成局部处理函数；登记示例使用旧 execution_id/input_ids/recipe_paths 和 dataset_id 返回 | 明确宏观研究流程指南职责；使用 executionId/inputRefs/inputIds/recipePaths；直接保存登记返回的 ref/evidence，不重复冻结 |
| QuantSkills | API 1、旧宿主版本、完整 MCP 名称和旧示例版本 | 对齐当前 API 2、manifest 最低宿主版本、Agent localId 和真实 MCP 输出 |
| Judgment Evolution | 混用 SDK 资源读取与 Agent 工具参数 | 分开说明两种调用形状，以及标准子 Agent 已有的精确引用读取能力 |
| ABU | ATR 初始化和预热说明笼统，容易误认为各包一致 | 如实说明各包现有行为；exit/sizing 使用首根 high-low、N 根预热，indicators/volatility 首根 null、N+1 根；本次没有改算法 |
| 宿主数据扩展 | data_extensions_read 仍推荐不存在的 host.providers.subscribe | 删除旧端口，订阅专用字段由已配置的可见视图消费 |

保留的有效说明包括 manual_trade_* 组合执行工具、data_read(datasetId)、因子 pause/resume 与 interrupt_ids、MT5 原生工程和 legacy trace。manual-trading 插件重命名的实际兼容缺口仍存在，没有通过提示词宣称它已被解决。

验证：

- 核心配置/报告 8 项、编排/脚手架 6 项、宿主完成通知/消息入站 24 项通过。
- 研究、交易决策、因子流程、QMT 共 88 项通过；新增交付与实际 synthesis 回归先失败、修正后通过。
- 方法、知识及其他可选插件 36 项通过；QuantSkills 五个示例与真实 MCP 返回版本对照通过。
- 声明 JSON 校验、相关静态检查和差异空白检查通过；描述/usage 以外的能力声明没有因本次审计改变。

本次修正位于本地源码。没有推送远端、发布插件目录或重写已安装插件的摘要；下一次正式组装时需要按现有流程重新生成并校验发布锁。
