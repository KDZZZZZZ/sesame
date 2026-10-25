# Elliott 波浪候选

`sesame/elliott-wave`，Plugin API 2，要求 Sesame `>=0.2.3`，当前包版本以 plugin.json 为准。独立可选、安装后 discoverable；`plugin_load` 只加载本方法。没有执行 capability 或 source；不自动联网、安装依赖或操作账户，也不注入其它方法包。

独立波浪研究：明确结构类型、级别、锚点、标准推动浪约束、替代计数和确认时刻；主观候选与验证分开。

方法入口见 [skill](skills/elliott-wave/SKILL.md)，来源与许可见 [PROVENANCE](PROVENANCE.md)。用户或工作流按要回答的问题选择本方法，输入已有固定证据，输出局部观察、解释、反证和缺口。取数与最终报告由调用者统筹；已有同定义、同参数、同版本的观察可直接复用。案例为原创虚构教学数据。

本包提供具体研究步骤、证据要求和验收示例，不声称完整自动理论分类、经济效力或收益证明。引用外部文献不代表其作者认可本插件，亦不改变外部许可。

## 文件与能力边界

本包属于 `analysis / knowledge`。`index.js` 保持空能力列表，`capabilities.json` 显式声明可读取的知识资源。`skills/elliott-wave/SKILL.md` 说明问题、输入与局部交付，`references/` 保留具体判据、反例及验证边界；`examples/` 提供合成输入和独立预期。解释和标注由选用本方法的 Agent 根据证据完成，不把知识内容冒充已执行算法。

取数、选择方法、安排研究步骤和发布报告由调用方组织。本包交付带原始来源、时间、支持/反证与失效条件的局部判断；多个同源解释不增加独立证据数量。

本包没有需要用户保存的配置、密钥或账户，不声明虚构的 `configurationRequirements`。所选数据源的配置绑定在来源能力上；模型认证沿用宿主设置。
