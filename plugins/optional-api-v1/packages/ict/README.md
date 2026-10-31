# ICT 价格结构研究

`sesame/ict`，Plugin API 2，要求 Sesame `>=0.2.3`，当前包版本以 plugin.json 为准。独立可选、安装后 discoverable；`plugin_load` 只加载本方法。没有可调用 capability 或 source；可选 Python 观察脚本通过已声明资源读取并在工作区执行。

仅按需 ICT：固定参考范围、三柱价格区间、结构转变候选与失效证据；不从 OHLC 反推机构真实订单。

方法入口见 [skill](skills/ict/SKILL.md)，来源与许可见 [PROVENANCE](PROVENANCE.md)。用户或工作流按要回答的问题选择本方法，输入已有固定证据，输出局部观察、解释、反证和缺口。取数与最终报告由调用者统筹；已有同定义、同参数、同版本的观察可直接复用。案例为原创虚构教学数据。

本包提供具体研究步骤、证据要求和验收示例，不声称完整自动理论分类、经济效力或收益证明。引用外部文献不代表其作者认可本插件，亦不改变外部许可。

## 文件与接口

本包按任务职责归入 analysis（专业能力），implementationKinds 为 knowledge（知识文档）。它对已有证据提供局部结构判断，由调用者组织取数、研究流程与报告。保留现有脚本、资源和知识路径，index.js 只返回空能力列表。

| 文件 | 职责 |
| --- | --- |
| capabilities.json | 显式知识资源、空执行能力和空配置 Schema |
| skills/ict/SKILL.md | 问题、输入、判断边界和交接规则 |
| skills/ict/references/method.md | 三柱区间观察的操作定义与反证 |
| skills/ict/references/validation.md | 确认时点、日历与效力验证边界 |
| skills/ict/references/execution.md | 读取固定输入、真实执行及登记派生结果的接口 |
| scripts/observe.py、scripts/bar_input.py | 保持原路径的可选 Python 标准库计算和输入校验 |
| examples/bars.json、examples/source.json、examples/expected.md | 同一套虚构闭柱输入、来源约束与独立预期 |

教学输入是 examples/bars.json 的完整闭柱数组和 examples/source.json 的来源元数据；后者明确 provenance_kind:demo、ref:null，不能替代真实来源引用。运行原 scripts/observe.py 后，样例产生 5 个区间观察，边界依次为 (14,18)、(16,18)、(14,16)、(10,14)、(11,12)，详见 examples/expected.md。观察保留源柱和确认时点，institutional_orders:not-observed、calendar_continuity:not-established 的限制不会被删除。

本方法本身不需要密钥或账户配置，因此不声明 configurationRequirements。调用者选用的数据源在其所属能力上声明配置依赖；Python 可用性由实际执行环境确认，加载知识不代表运行过脚本。
