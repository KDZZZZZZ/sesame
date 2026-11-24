久留美回放提供固定历史上的模拟账户、受限角色 Agent、原生行情观战和报告。能力清单逐项声明了调用者、输入、返回证据及恢复条件；公开参考是 skills/kurumi-replay/SKILL.md，不需要从实现文件寻找调用办法。

本插件负责固定历史中的模拟时间、模拟账户与回放决策。investment-research 负责现实研究，trading-decision 负责获授权的真实账户决策，portfolio-execution 负责实盘操作；回放结果只可作为标明样本和时点的研究证据，不能直接接成实盘指令。


主会话控制能力以 kurumi_status 返回的 revision 做版本检查；稳定 command_id 保留同一次意图。status、recording(status)、experiment_history 是当前事实的入口。configure 改决策间隔，start/continue/step 会请求真实角色工作并推进模拟，pause/reconcile/recover 处理已保存的工作；这些动作不能由“显示当前报告”或“调整图表周期”推导出来。运行接受不等于已提交成交，账本、任务状态、恢复记录和归档各自提供证据。

角色只拥有 kurumi_observe 和 kurumi_decide。observe 返回本步 runId、stepId、expectedVersion 与已揭示行情；decide 接受同一步的目标基础币整数数量、止损价格字符串或 null、理由和原创短句。没有有效决定、真实报价、成熟撮合依赖或配置的 openai/gpt-6.1-sol 时暂停，不编造 hold、不替换策略。控制 revision 与角色 expectedVersion 是不同版本。

display/refresh_presentation 用实际宿主图表与指标接口；export/report 返回固定数据和报告 ArtifactRef，host.resources.read 可核对 manifest、rows.json 和 source.json。布局保存、程序计算、报告发布和客户端 rendered 是不同证据。audience/narration/weekly/experience 的状态返回各自待办与边界；只消耗已获授权的模拟步数或报告预算，未知付费结果保留原任务身份。主会话正常聊天承担解说，不创建第二旁白模型或猜测私有 UI 接口。

模拟收益不是券商收益；同历史重放不是独立样本外。原剧情只作观众注释，不进入角色输入或账户。缺数、外汇补充来源、尚未验证的原生界面和环境限制保持在报告证据中。
