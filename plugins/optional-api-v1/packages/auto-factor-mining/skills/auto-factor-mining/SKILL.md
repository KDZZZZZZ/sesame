---
name: auto-factor-mining
description: 因子挖掘、候选信号与组合的多轮搜索、实测评估和固定选择；按数据形状及评价目标选择 evaluator。
---

适用于产生并比较多个候选、迭代改进因子或组合、经实测复核后选择的研究，可承担策略中的行情状态特征和入场评分搜索阶段。因子解释、单个指标计算和明确轻量/快速的问题可直接处理。明确最大努力、最大功率等要求时，发现匹配的工作流，按需并行准备数据和查找评价实现，再启动适配的实验。

工作流不限制研究的品种数量；evaluator 决定数据形状和评价目标。内置 factor-evaluator 的 dataset.mode 支持 auto、cross-sectional、time-series，auto 可适配单品种时序因子。时序相关性和方向收益诊断不等于逐笔交易胜率或盈亏比；成交验证另选对应回测能力。arguments.diagnostics 按当前问题选取稳健性项目，不默认全跑。某项不适用、样本不足或因环境失败时保留原因，继续其他适用项；按实际测量和本次显式门槛选择候选，不以未测试否定想法，也不把全部未测说成通过。数据缺口与评价实现缺口分别解决，不为迁就现有评估器改变标的范围或要求切换账户。

研究目标是产生可检验的候选、实测评价、失败证据与后续假设。配置由公开 function auto_factor_start 的完整 schema 定义，它以 start:workflow 效果启动原生工作流，仅查 kind=workflow 会漏掉入口。evaluator 使用指定插件的局部 capability ID，research.tools 使用已注册的 pluginId#capabilityId，模型选择来自 auto_factor_models。没有声明的接口不会被自动猜测或补齐。实际受理的 workflow Run 才是启动证据，发现、加载或普通子 Agent 并行均不能替代；新建阶段报告归 Strategy，由该 Run 交付。

config.workflow 可指定各阶段的实际成员；同一 id 可承担多项职责，plan/review/reflection 可为 null。省略 workflow 才使用默认五角色；agentModels 按实际成员 ID 覆盖模型，不使用一次任务的 assignmentId。省略评审不跳过真实 evaluator 评价、资格门槛或固定选择。

本包负责研究协作与证据综合。来源能力提供可得时点明确的事实；方法包负责具体解释或计算；独立 evaluator 负责统一口径的实测评价。research.plugins 同时支持来源、计算和纯知识方法，按当前目标选择互补组合；方法数量与角色票数不是证据强度。选定知识随成员请求传入，plugin_read 只读公开 manifest/knowledge 正文；不授予插件安装、加载或修改。已声明技能只有知识时直接按方法分析，不捏造函数名或执行回执。

共同输入是冻结的开发数据与已有试验。来源调查只补明确缺口，方法说明输入引用、时点与假设，后续角色复用实际回执并解释分歧、相关性及失效条件。实现者把假设交给所选 evaluator 的候选协议，评审者核对其真实数值；两者不各写一套评估算法。阶段结果以真实输出为准，不重新执行已保存成果。

冻结数据、候选格式和门槛由独立 evaluator 决定。研究角色通过 auto_factor_context 获取必要证据，通过 auto_factor_submit 写入结构化断点，因而暂停或重开后无需重复已保存的研究。指标由 evaluator 计算，模型不能手填。可复核反证、否决全部候选和提前停止都能满足研究目标。

受限工作流可组合纯知识方法、公开插件文本读取 plugin_read 与通过 researchDataAccess 输入限定契约核对的原生计算工具，保留隔离留出。例如 factor-research 提供方法，abu-parameter-search 比较传入的开发试验并冻结选型；应按任务主动配合使用，不因工具可调用就放弃隔离或要求 tools:[]。可读外部数据、可启动其他调用或声明未知/冲突的工具使用 development-only，输入止于 validationEnd；空 effects 本身不证明输入限定。分类不等于已经观察到泄露，也不会把原已暴露的数据重新封存。选择冻结后由原生代码完成最终评估和归档，不安排额外模型承担机械步骤。

实时公开活动由 auto_factor_activity 打开宿主原生 Run 界面，auto_factor_runs 提供状态、暂停、取消与显式恢复。失败或被否决试验保留；原有报告被用户移动、修改或删除时不覆盖、不重建。
