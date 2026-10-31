# Sesame Agent 系统提示词目录与逐篇概要

核对日期：2026-10-26。以下按源码逐篇概括“这段文字要求 Agent 怎样做”，不代表这些要求在每次执行中都已实现。共列 9 项宿主提示、9 篇插件总提示和 13 篇技能入口，另说明条件加入的记忆索引。宿主总提示词未改动，插件指南已按职责整理。

## 1. 宿主始终加入

主 Agent 和子 Agent 的常规模型会话都会包含以下内容；具体角色、语言、路径随会话变化。

| 来源 | 内容概要 |
| --- | --- |
| [host-prompt.js：基础总提示词](E:/brief2great/sesame/mt5agent/modules/agent/host-prompt.js:2) | 把 Sesame 定位为投资助手和探索伙伴，围绕用户想法厘清机制、条件与目标，认真寻找证据和实现路径；遇到矛盾先核对理解，不用知识不足或一次失败轻率否定。要求主动发现并组合知识、数据、工作流和展示能力，自行解决已有授权内的配置与数据前置问题。实质研究按阶段协作，最大努力研究优先启动适配工作流；核验成果、如实汇报并推进有价值的下一步。回复面向投资者，主要讲市场、证据和决策，少讲内部实现；支持用户但不虚构成功或掩盖反证。 |
| [host-prompt.js：角色与语言](E:/brief2great/sesame/mt5agent/modules/agent/host-prompt.js:56) | 主 Agent 负责协调任务、恢复前置条件、核验并综合成果、向用户汇报；子 Agent 完成被分配的阶段后返回，不因主 Agent 有委派要求而递归拆任务。默认回复语言跟随设置，用户明确指定其他语言时遵从。 |
| [network-policy.js](E:/brief2great/sesame/mt5agent/modules/agent/network-policy.js:4) | 告诉 Agent 当前可以访问公网、内网及 HTTP/HTTPS 任意端口，主 Agent、子 Agent 和本地 MCP 均可联网。命令以本机当前用户身份执行，localhost 指本机；优先复用已有软件和配置。连接失败按实际 DNS、TLS、HTTP 或超时原因诊断。 |
| [report-output.js](E:/brief2great/sesame/mt5agent/modules/agent/report-output.js:152) | 规定研究、复杂分析及明确指定报告路径的任务必须有报告交付；普通问答可以没有。阶段任务绑定自己的报告，也可明确贡献到父任务报告，避免重复建文件。预留路径、保存草稿和返回数据引用都不等于交付，必须实际发布并核对路径与状态。已有绑定时补充本任务目的地；绑定为 none 却需要报告时，应向所属 Agent 报告交付不匹配，不能自行冒称已交付。 |
| [resource-policy.js](E:/brief2great/sesame/mt5agent/modules/agent/resource-policy.js:124) | 列出当前工作路径、各资源区域的归属、保存期限和清理规则。主会话文件可跨轮保留，子任务工作区属于临时资源，必要成果要在清理前通过正式能力保存。子目录继承所属区域的规则，宿主管理清理；数据库、密钥和安装信息不能充当临时文件或被用于腾空间。回答中写路径或摘要不能代替保存文件本身。 |
| [SDK 的 cwd 段](E:/brief2great/sesame/mt5agent/node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js:105) | 只附加当前会话实际工作目录，帮助模型解释相对路径。没有额外的人格、研究方法或工作步骤要求。 |

## 2. 主 Agent 默认可用的宿主工具说明

这些段落由对应工具是否可用决定。常规主 Agent 默认包含；子 Agent 按任务授予的工具筛选。

| 来源 | 内容概要 |
| --- | --- |
| [report-library-tools.js](E:/brief2great/sesame/mt5agent/modules/agent/report-library-tools.js:7) | 说明如何管理 Research／Strategy 里的报告源文件：使用目录内相对路径，修改、移动、删除和恢复时携带当前版本；删除进入可恢复回收区。编辑的是草稿，发布的是固定报告修订，两者分开。必须确认实际文件及发布状态后，才能告诉用户去报告栏查看；大文件分段读取。 |
| [data-view-tools.js](E:/brief2great/sesame/mt5agent/modules/agent/data-view-tools.js:6) | 先发现数据源真正声明的扩展字段，再用准确的来源、连接、账户或品种标识读取。配置账户、持仓和图表显示前先检查当前视图与版本，历史读取按预算处理分页。缺失值不能补成零；图表扩展须为数值字段。配置显示不等于产生数据，也不执行交易。 |
| [account-strategy-tools.js](E:/brief2great/sesame/mt5agent/modules/agent/account-strategy-tools.js:4) | 使用真实、固定版本的 SVL 策略源，先检查账户挂载再修改。挂载只保存该账户使用哪个策略修订，不自动开始或停止交易。解释某笔成交的策略来源必须有真实关联证据，不能凭时间、品种或盈亏相似就推断归属。 |

## 3. 默认挂载的插件提示词

当前官方默认集合包含以下 **9 个插件的 prompt.md，以及 13 个 SKILL.md 入口全文**。Ultra 自 1.0.3 起默认挂载，但模式不会自动开启。入口的参考资料按需读取。停用插件、依赖失败或子任务未选入该插件时，不保证加入，因此不能把这一层称为所有 Agent 无条件必读。

目录位于 `E:/brief2great/sesame/sesame/plugins/api-v1/packages/`；这里沿用源码目录名称，当前插件声明为 API 2。

| 插件／提示词入口 | 内容概要 | 自动加入的技能入口 |
| --- | --- | --- |
| [orchestration/prompt.md](E:/brief2great/sesame/sesame/plugins/api-v1/packages/orchestration/prompt.md) | 定义研究协作职责、主子 Agent 分工与交付原则；编排工具由宿主提供，知识指南指导真实调用；默认流程不合适时主动定制，保留最大努力、轻量研究、授权及长期偏好规则。 | coordinate-research |
| [user-guide/prompt.md](E:/brief2great/sesame/sesame/plugins/api-v1/packages/user-guide/prompt.md) | 定义产品上手与操作帮助职责；问用法时解释入口和结果，要求代做时使用业务能力。核验真实状态，区分默认装配与按需读取；协作、管理开发插件由各自指南负责。 | sesame-user-guide |
| [plugin-manager/prompt.md](E:/brief2great/sesame/sesame/plugins/api-v1/packages/plugin-manager/prompt.md) | 要求优先发现和使用适合的插件，区分信息、方法、流程与执行；分别核对安装、加载、挂载、配置和业务成功，保持真实回执与操作身份。管理已有插件和开发插件各有技能入口。 | manage-plugins、develop-plugins |
| [workspace/prompt.md](E:/brief2great/sesame/sesame/plugins/api-v1/packages/workspace/prompt.md) | 规定工作区文件如何读取、写入和精确编辑，修改需保留编码及换行并核对摘要；绝对路径使用对应宿主能力，遵守覆盖、冲突和删除规则。命令最终由宿主管理进程、超时和取消，返回实际输出及退出码。进程使用本机权限，成功退出不代表产物已经验收。 | prepare-environment |
| [data-access/prompt.md](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/prompt.md) | 负责提供可复用的真实输入；优先共享适用证据并主动寻找来源、缓存及数据能力，保留来源、时间、单位和精度。不把取数当研究结论，不把历史读取当实时显示，不伪造缺失数据或执行证据。 | market-discovery、analyze-data |
| [reports/prompt.md](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/prompt.md) | 用统一模板交付真实报告，保留市场表达、证据、命名与分类、主题语义色、决策树和导出原则；交付前核对统一视觉及当前修订渲染，正文不赘述设计和检查过程。 | report-writing、report-design、interactive-report |
| [strategy-authoring/prompt.md](E:/brief2great/sesame/sesame/plugins/api-v1/packages/strategy-authoring/prompt.md) | 把明确策略逻辑写成可验证、可追溯的 SVL 源，复用已有数据、指标和方法成果；它不负责选研究方向或证明盈利。只用当前语言支持的语义，提供指标纯函数、组合与风险计算、固定事件回放及 Agent 判断入口。发布、逻辑图和回放围绕同一固定源；原生翻译与执行由目标后端声明决定，不能把编译或教学回放通过说成真实回测、实盘验证通过。 | strategy-authoring |
| [memory/prompt.md](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/prompt.md) | 主 Agent 开始任务时检索相关记忆，用户明确要求记住时及时保存，保留真实来源和适用范围。流程选择遵循本次要求、有效长期偏好、插件默认的顺序。子 Agent 提交候选，主 Agent 管理正式记忆；正常交付无需等待记忆整理。记忆不能授予权限，交易红线变更需明确确认；不长期保存密钥、原始日志或即时行情。 | manage-memory、personal-trading-memory |

### 13 篇技能入口的独立概要

这些正文也会进入默认挂载插件的上下文。它们引用的详细指南、示例和公式文件不是全部自动加载，而是按任务读取。

| 技能入口 | 内容概要 |
| --- | --- |
| [sesame-user-guide](E:/brief2great/sesame/sesame/plugins/api-v1/packages/user-guide/skills/sesame-user-guide/SKILL.md) | 按用户问题选择七篇参考，提供必要步骤与可观察结果。同步开屏和后台运行、当前目录标签、附件与聊天进度、Ultra、设置和研究排障；详细交互按需读取，Agent/Run 与插件管理参数不在这里重复维护。 |
| [coordinate-research](E:/brief2great/sesame/sesame/plugins/api-v1/packages/orchestration/skills/coordinate-research/SKILL.md) | 按目标选择直接委派、定制已有业务工作流或自定义协作；给出宿主 Agent/Run 工具与具体步骤，说明成员权限、知识、依赖、报告及完成通知。完整调用和三种工作流计划放参考中，协作图不代替实际调度。 |
| [manage-plugins](E:/brief2great/sesame/sesame/plugins/api-v1/packages/plugin-manager/skills/manage-plugins/SKILL.md) | 发现、读取、会话加载、安装更新和实际验收；区分 mounted/discoverable/disabled、配置依赖与运行失败。明确当前可调用工具及摘要字段，管理完成后继续原任务，不把安装检查当业务通过。 |
| [develop-plugins](E:/brief2great/sesame/sesame/plugins/api-v1/packages/plugin-manager/skills/develop-plugins/SKILL.md) | 确定职责与最小接口，生成并实现草稿，声明配置、权限、依赖和知识，再运行业务测试、安装并验收；保留全部显式声明与测试资料原则，区分 prompt、skill、reference。 |
| [prepare-environment](E:/brief2great/sesame/sesame/plugins/api-v1/packages/workspace/skills/prepare-environment/SKILL.md) | 先检查并复用已有程序、配置和数据目录，发现失败不直接等于未安装；只在确实缺少依赖时，从官方来源向独立环境安装固定版本。保护原有可用配置和密钥，安装后核验版本、导入及真实调用。可导入不等于能取数或交易；长任务尊重取消，结果不明时先查已发生的副作用。 |
| [market-discovery](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/skills/market-discovery/SKILL.md) | 复用有效来源与品种引用，按实际缺口发现全来源、市场来源或适配器专有能力；根据显示、历史研究或一般查询选择入口，核验真实输出。完整时间、分页、缓存和错误处理规则按需读取。 |
| [analyze-data](E:/brief2great/sesame/sesame/plugins/api-v1/packages/data-access/skills/analyze-data/SKILL.md) | 找到登记输入或固定 DataRef，读入独立计算目录，编写并执行分析，再用真实 executionId 和冻结输入输出登记可复查成果，交给方法、工作流或报告；详细证据参数放参考。 |
| [report-writing](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/skills/report-writing/SKILL.md) | 让读者先看懂结论、依据和下一步，围绕市场判断组织文字。数字来自固定输入或登记计算，统一名称、精度和单位，重要统计给出样本量。必要条件贴着对应结论说明，代码、哈希和完整回执放来源或附件。章节按任务取舍，逐句删除既不提供事实、依据、条件，也不帮助行动的内容。 |
| [report-design](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/skills/report-design/SKILL.md) | 选择统一模板与现成图表，按需查询组件参数；发布前核对模板、主题、默认组件和实际预览，对当前 ref 运行渲染检查，修正后发布新修订再验收。保留用户局部自定义及原生回测无需 SVL。 |
| [interactive-report](E:/brief2great/sesame/sesame/plugins/api-v1/packages/reports/skills/interactive-report/SKILL.md) | 先确认真实固定数据、字段、区间与时区，完整读取分页；交互围绕已绑定输入，失败不能用空数组掩盖。兼顾异步初始化、键盘、窄屏和资源释放。完整 HTML 与资源一起发布，更新使用准确版本，交付前核验路径和当前修订的渲染。PDF、PNG 按需另做预检与导出，可浏览不等于可导出，也不能删内容冒充完整输出。 |
| [strategy-authoring](E:/brief2great/sesame/sesame/plugins/api-v1/packages/strategy-authoring/skills/strategy-authoring/SKILL.md) | 按现有输入选择验证、发布、逻辑图、回放或指标函数能力，新写语法时查当前规范。策略源、图和固定事件测试保持同源；复杂策略按信号、目标组合、风险调整、执行组织，Agent 判断记录为带时间的固定输入。明确缺历史、形成中柱、未决订单和数值语义的处理。原生后端支持与真实成交证据需另行验证，不从图或教学回放推断实盘效果。 |
| [manage-memory](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/skills/manage-memory/SKILL.md) | 规定记忆分类、适用范围、证据等级、候选接纳、版本冲突和遗忘流程。保存前查是否已有同一事实，使用真实用户消息或已发布成果；推断只保留为候选，子 Agent 不直接管理正式记忆。压缩前有界整理，失败不阻断正常压缩；一般记忆按实际采用情况转冷或归档，固定约束另受保护。删除记忆不代表原始聊天、报告或外部备份也被删除。 |
| [personal-trading-memory](E:/brief2great/sesame/sesame/plugins/api-v1/packages/memory/skills/personal-trading-memory/SKILL.md) | 区分交易风格、用户确认的风险红线和待检验的策略认知。新增实盘风险或调整规则前，读取完整适用红线，结合真实账户、合约、仓位、成本和压力情景制定方案，不套用统一风险比例。规则修改、撤销与恢复要求本次明确确认；必要数据或保护不足时暂停相关新增风险，但不一并禁止已有授权内的减仓平仓。保存规则、保护单和实际成交分别核验。 |

### Ultra 持续协作

[ultra/prompt.md](E:/brief2great/sesame/sesame/plugins/api-v1/packages/ultra/prompt.md) 随默认挂载全文加入，无额外 SKILL.md 入口。规定开启时持续寻找新路径、最大化有意义的并行探索、组合工作流与知识插件、核验真实任务并交付报告。以持久化的 `ultra_status.enabled` 为准；关闭后解除强制扩展，保留已启动工作，普通模式仍可按需委派。

## 4. 按条件加入，以及不属于这份默认系统提示词的内容

- **其他插件提示词与技能**：插件在当前会话激活后加入；仅安装或出现在可发现目录中，不等于全文加载。Ultra 已纳入上述默认挂载集合，但仍服从停用、依赖与子任务能力选择规则。
- **长期记忆索引**：记忆服务可用且索引非空时追加，最多 20 条 ID、类别、标题及摘要，提醒 Agent 哪些已有资料可能有用。需要时仍要读取正文与来源，索引本身不能授予权限，也不意味着其中内容已经被采用。这一段是动态资料，不是固定规则全文。[装配位置](E:/brief2great/sesame/mt5agent/modules/agent/runtime.js:605)、[索引文本](E:/brief2great/sesame/mt5agent/modules/agent/plugin-memory-service.js:44)
- **用户需求、子任务指令、工具结果及压缩后的历史**：属于会话上下文，不应和固定系统提示词混为一谈。压缩器自身另有仅在压缩时使用的提示词。
- **Codex 的 AGENTS.md、SDK 默认编程助手身份、自动发现的 SYSTEM.md／APPEND_SYSTEM.md**：当前 Sesame 装配链路不自动加入。SDK 默认身份被宿主总提示词替代；本版本也不自动追加日期。工具的 description／schema 仍正常提供给模型。

实际入口：[plugin-registry.js → loader().getSystemPrompt()](E:/brief2great/sesame/mt5agent/modules/agent/plugin-registry.js:724)。顺序为：宿主基础与网络 → 可用工具说明 → 激活插件 prompt → 技能入口全文 → 报告交付与资源规则 → 可用记忆索引 → SDK 工作目录。

## 5. 本次整理

产品使用帮助已迁入独立默认插件 `sesame/user-guide`，原 skill 名称不变；`sesame/orchestration` 只保留协作编排原则、步骤与接口参考。每个插件继续区分 prompt、skill 和按需参考。

`user-guide 3.0.1` 已按当前源码核对并补齐启动与后台运行、目录标签与布局、聊天状态和 Ultra、导出提示、原生策略与 MT5 排障。七篇详细帮助仍按需读取，默认提示词只保留职责、答疑步骤和索引；当前应用尚未替换。

本轮继续整理 orchestration 3.2.1、plugin-manager 3.1.3、data-access 3.0.3、reports 3.3.2：编排增加工具与定制方法，插件管理分为管理与开发两项技能，数据访问按真实来源和固定证据流程组织，报告简化视觉长文并明确交付验收。宿主总提示词和装配逻辑未改动；本目录描述最新源码，当前应用尚未替换。
