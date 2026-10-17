---
name: auto-factor-mining
description: 以显式评估能力、固定模型和研究范围构建可复核因子试验。
---

研究目标是产生可检验的候选、实测评价、失败证据与后续假设。配置由 auto_factor_start 的完整 schema 定义；evaluator 使用指定插件的局部 capability ID，research.tools 使用已注册的 pluginId#capabilityId，模型选择来自 auto_factor_models。没有声明的接口不会被自动猜测或补齐。

冻结数据、候选格式和门槛由独立 evaluator 决定。研究角色通过 auto_factor_context 获取必要证据，通过 auto_factor_submit 写入结构化断点，因而暂停或重开后无需重复已保存的研究。指标由 evaluator 计算，模型不能手填。可复核反证、否决全部候选和提前停止都能满足研究目标。

只有受限工作流可保留隔离的留出数据。选用通用研究能力时采用 development-only 模式，报告不能声称留出验证。选择冻结后由原生代码完成最终评估和归档，不安排额外模型承担机械步骤。

实时公开活动由 auto_factor_activity 打开宿主原生 Run 界面，auto_factor_runs 提供状态、暂停、取消与显式恢复。失败或被否决试验保留；原有报告被用户移动、修改或删除时不覆盖、不重建。
