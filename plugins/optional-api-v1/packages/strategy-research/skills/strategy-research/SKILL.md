---
name: strategy-research
description: 按需组织策略假设、固定数据、试验预算、真实引擎、样本外验证和报告；不强制任何算法。
license: MIT
---

# 从问题到可复查的实验

1. 用 `plugin_read`，`plugin_id:"sesame/strategy-research"`，先读
   `skills/strategy-research/references/execution.md` 和
   `skills/strategy-research/references/evidence.md`。资源路径相对本包根目录。
2. 写明用户问题、可反驳的机制、标的与期间、基准、失效条件和试验预算。选择用户需要的
   方法；不因为研究策略就附带 ICT、Qlib、因果推断、遗传搜索或因子库。
3. 先发现真实 provider/connection，再通过 `market_read` 等固定 DataRef。保留原始来源、
   schema、单位、时钟、coverage、复权、退市与历史成分证据。没有的数据明确 unavailable，
   不通过现有成分股列表或事后复权悄悄回填。财报要用当时首次可得版本，不能用报告期作发布时间。
4. 在看验证/留出结果之前冻结计划、来源摘要、精确代码/参数/成本和引擎版本。使用本包
   `scripts/experiment.mjs` 检查计划与时间样本。特征可得时间不晚于决策，标签末端和
   可得时间不得越过切分/隔离边界。滚动前推每一折各自冻结训练窗口与拟合参数，不能全样本归一化。
5. 因子挖掘另选 `sesame/factor-research`；其它方法沿各自插件。使用核心 strategy-authoring
   写/验证 SVL，或明确保存原生策略源。不能无损表达的规则必须报告 unsupported，不能把
   原生私加逻辑称为全部可视化或等价。通过选定已安装后端执行真实固定数据回测。
6. 每次尝试都登记计划/数据/源码摘要、精确参数、引擎和结果固定引用；失败、取消、未知同样计数。
   不重放未知的原生操作。只在训练/验证上选择参数；先冻结选择，再进行一次声明的样本外评估。
7. 检查基准、成本敏感性、回撤、换手与容量假设、稳定性和全部负结果。DSR/CSCV/PBO不是本包
   已实现的统计工具；需要完整试验矩阵、适当假设及单独验证，不能拿最佳 Sharpe 和一个试验数冒充。
8. 用现有研究登记保存成功执行与冻结输出；reports 读取固定数据/引擎结果，说明哪些是 observed、
   derived 或 demo。报告既给支持证据，也给失败样本、未知约束及停止条件。实盘/账户操作属于后端
   的另一个明确操作范围，研究通过不等于交易授权。

CLI 通过只是结构与声明一致性。脚本不会核实外部历史，也无法侦测被研究者隐藏的试验。
