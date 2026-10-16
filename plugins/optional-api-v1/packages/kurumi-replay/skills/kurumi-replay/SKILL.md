---
name: kurumi-replay
description: 固定历史模拟、受限角色任务、原生观战与报告的公开能力和证据契约。
---

目标是保留可核对的模拟账本、角色决定与显示证据。用户给出的步数、实验与报告预算决定工作边界；能力描述中的前置条件来自实际状态机，不要求每个任务经过相同操作序列。

| 需要的结果 | 能力与输入来源 | 完成证据 |
| --- | --- | --- |
| 当前事实 | kurumi_status、kurumi_experiment_history、kurumi_recording(action=status) | revision、runId、账本数量、任务/恢复/归档状态；只读不推进 |
| 固定输入与环境 | kurumi_prepare(action=prepare) | 数据就绪与实际 nativeEnvironment probe；不满足时明确缺项 |
| 调整角色节奏 | kurumi_configure({command_id,expected_version,decision_interval_hours:1或4}) | 最新 status.settings 与 revision；不等于改变图表周期 |
| 有界模拟 | kurumi_start/continue({command_id,expected_version,max_steps}) 或 kurumi_step | 实际角色终态、已提交决定、撮合/成本和账户账本；控制接受只是开始 |
| 停止与恢复 | kurumi_pause/reconcile；kurumi_recover 使用保留的原 decision_id | committed 不重放，not_committed 才能恢复原决定，unknown 保留阻塞 |
| 观战图表 | kurumi_display、kurumi_refresh_presentation({chart_id}) | 精确绑定、指标实例、当前宿主/客户端回执 |
| 固定导出/报告 | kurumi_export/report({operation_id}) | data/source/ref 与实际 receipt；host.resources.read 核对 manifest、rows.json、source.json |
| 新的独立实验 | kurumi_archive_terminal、kurumi_new_experiment；真正空白安装允许 version0 直接创建 | 完整旧档摘要、新 runId、独立300000JPY资金、modelRequested:false |
| 展示与报告待办 | kurumi_audience、kurumi_narration、kurumi_weekly、kurumi_experience 的 action=status | 当前待办、固定截止、主聊天/客户端/周报证据与已用预算 |
| 方法能力组合 | kurumi_method_workflow(action=status) 的声明计划；其他 action 见能力说明 | 实际固定输入/输出与成功调用回执；安装/加载不等于采用 |

控制工具只供主会话使用。expected_version 取自 kurumi_status.revision，command_id 对同一次输入保持不变；冲突时读取状态，判断是否需要新的意图。4H 模式一次角色决定覆盖最多四根可交易 H1，随后保持真实剩余仓位与止损，不重新开仓。章边界、破产、缺数或取消可能提前结束。

角色任务只允许 kurumi_observe 和 kurumi_decide。observe 返回 runId、stepId、expectedVersion、截至 asOf 的报价与账户；decide 输入为 {run_id,step_id,expected_version,target,stop,reason,utterance}。target 是带符号的基础币整数数量字符串，1000倍数、绝对值不超过10000000；0为空仓，原数量为持有。stop 是价格字符串或 null。角色 expectedVersion 是引擎版本，不是主控制 revision；角色不能读未来行情、剧情、文件或其他插件。宿主仅选配置的 openai/gpt-6.1-sol，缺失则暂停。

失败恢复保留实际任务和决定。已保存决定但未提交撮合时，recover 核对原角色终态并仅恢复原决定；它不再次请求模型。reconcile 的 unknown 不能换 ID 当失败重发。repair_checkpoint_text 只修有封存原文证明的 UTF-8 文本损坏，不改资金、价格、仓位或游标。import_fx_supplement/bind_experiment_fx 接受已核验、精确绑定的真实补充报价，60秒最大汇率年龄不变，导入不推进且必须披露来源。

归档位置由 recording 的私有默认或明确 pin 决定，不猜开发者目录。终态封存需要双副本、原始来源与角色证据完整；失败不会重置旧账户。new_experiment 是独立资本的新模拟，不能复活或充值旧账户，也不能把同历史第二轮称为样本外。

原生观看的证据分开解释：布局/实例保存不证明像素；程序计算不证明客户端显示；报告发布不证明打开。audience 使用实际宿主回执，narration claim/ack/reconcile 核对主 Agent 普通聊天中真实可见的新增正文，未知时不重写同段旁白。weekly 只有明确 enable/drain 授权才产生付费任务。experience 的门槛引用真实固定 ArtifactRef，不能以 fixture 结果认定原生界面通过。

来源与财务规则见 RULES.md、DATA.md；历史实现/验收记录保留在 VALIDATION.md 和交接文档。这些旧版本说明不是当前 Agent 的强制步骤，也不能覆盖本能力清单的输入与当前状态。受支持环境、可用行情、真实模型调用和原生客户端验收分别报告；缺一项就保留该项未知。
