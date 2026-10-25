# 插件职责清单

整理日期：2026-10-19。本文详细说明 24 个非专业能力插件；31 个专业能力包已按同一架构完成对齐，逐项责任见[专业能力职责清单](analysis-plugin-responsibilities.md)。两份清单共同覆盖 55 包，按用户要求排除 Kurumi。

本文给出已经落实到当前源码的职责，承接源码审查与[边界方案](../.omx/plans/plugin-boundaries-2026-10-19-plan.md)。24 个包保持原身份、252 个原有能力契约、权限与状态归属；统一配置另新增 MT5、QMT 各两个仅宿主适配器。当前共 256 个能力入口，168 个可供 Agent 调用、88 个仅宿主使用，见[逐项能力清单](plugin-capabilities-by-responsibility.md)。实施与验证证据见[边界实施记录](plans/2026-10-19-plugin-boundaries-implementation.md)；源码状态与已发行、已安装版本分别核对。

开发者从[统一开发指南](plugin-development.md)选择最小接口、硬性约束和同类参考实现；用户入口与使用方式由 orchestration 的 Sesame 使用指南维护。

## 分类口径

| 分类 | 解决的问题 | 本轮数量 |
| --- | --- | ---: |
| 业务流程 `business` | 如何完成一项任务，如何组织研究、决策、执行和验证 | 7 |
| 专业能力 `analysis` | 如何理解或处理一个具体领域问题，提供知识、方法原理或局部计算 | [31，另表详列](analysis-plugin-responsibilities.md) |
| 资源接入 `integration` | 如何访问数据、终端、账户、原生引擎和外部参考目录 | 10 |
| 交互呈现 `presentation` | 如何把已有数据和成果展示为图表、工作台和报告 | 2 |
| 平台管理 `platform` | 如何管理配置、插件、个人记忆、文件和产品使用规则 | 5 |

主分类描述插件承担的任务责任；知识文档、函数、适配器、工作流和服务描述实现方式。业务流程可以由指南、模型协作或确定性服务实现。因子/策略研究指南因此属于业务流程；ICT 一类局部专业知识属于专业能力。

`portfolio-execution` 归入业务流程，保留其 `service` 实现类型，inventory-policy 已同步。7/10/2/5 是本轮排除 Kurumi 和专业能力后的数量。

## 业务流程：任务方法、研究、决策、执行与验证

| 插件 | 核心责任 | 主要交付与状态归属 | 协作边界 |
| --- | --- | --- | --- |
| [factor-research](../plugins/optional-api-v1/packages/factor-research/capabilities.json) | 提供完整的因子研究方法：假设与机制、数据时点、因子定义、筛选、成本、固定选择与样本外验证；附离线诊断脚本 | 研究步骤、实验约束、筛选/选择/留出检验诊断；保留原 CLI 和结果摘要规则 | 数值评价交给选定评估器，自动多轮搜索交给 auto-factor-mining。指南本身没有注册的运行入口 |
| [strategy-research](../plugins/optional-api-v1/packages/strategy-research/capabilities.json) | 提供完整的策略研究方法：明确目标、组合来源与方法、设计实验、比较试验、检查成本与样本外证据、选择原生引擎 | 研究计划、数据可用时点与实验台账审计、引擎交接要求；附离线检查脚本 | 策略表达、局部分析和原生回测由选定能力执行；保留指南及 CLI 的独立使用方式 |
| [auto-factor-mining](../plugins/optional-api-v1/packages/auto-factor-mining/capabilities.json) | 自动组织多轮因子候选研究：角色分工、候选提交、调用评估器、比较与反思、固定选择、最终评价和归档 | 候选/试验台账、真实评价回执、检查点、最终研究报告；拥有本研究流程的业务状态 | 评估器负责数值计算和独立留出数据规则；宿主负责 Agent/Run 执行。评价结果来自真实调用回执 |
| [investment-research](../plugins/optional-api-v1/packages/investment-research/capabilities.json) | 围绕投资问题组合指定信源与互补方法，组织分析师与经理，补齐具体证据缺口，综合观点；可单独重制报告 | 固定研究成果、证据引用、成员输出、综合结论、原研究角色问答；拥有研究成果和角色任务关系 | 数据获取、局部分析、报告发布分别调用相应能力；交易目标由 trading-decision 决定。研究成果可独立于交易账户存在 |
| [trading-decision](../plugins/optional-api-v1/packages/trading-decision/capabilities.json) | 基于固定研究、当前账户及用户风险规则，管理授权交易计划、定时/事件触发、形成并冻结目标仓位，交付执行，复盘既往决策 | 交易计划、决策与目标、触发队列、运行状态、执行回执引用、同账户决策复盘 | 消费符合契约的固定研究成果；目标执行交给选定执行能力。个人风险规则来自 memory，独立判断验证由 judgment-evolution 管理 |
| [portfolio-execution](../plugins/optional-api-v1/packages/portfolio-execution/capabilities.json) | 将已授权的目标或单次手动指令落实到账户：绑定精确账户、计算目标差量、串行执行批次、检查未决订单、核对成交与剩余目标 | 冻结账户绑定、执行申请与批次、账户锁、订单操作与观察回执、对账结果 | MT5/QMT 负责平台原生操作。绑定属于执行业务引用；连接与凭据由选定后端管理。它消费已有目标，保持原交易授权链 |
| [judgment-evolution](../plugins/optional-api-v1/packages/judgment-evolution/capabilities.json) | 管理可验证判断的完整生命周期：事前登记条件和概率、到期核验、证据不足延期、评分与归因、候选准则、前瞻验证、退出，以及回复中的判断覆盖检查 | 判断台账、核验与评分、准则候选/验证记录、覆盖队列与导出；拥有独立判断数据库 | 使用固定、时间有效的证据。统计准则与个人风险约束分别管理；memory 的正式用户规则仍遵循其确认流程 |

业务交接采用明确成果：研究交付固定结论与证据；决策交付冻结目标与授权上下文；执行交付真实账户操作和回执。各阶段可以选择符合原契约的实现，这些责任划分不新增强制插件依赖。

### 流程可以调整，状态责任保持明确

业务流程并不等于固定的角色清单或步骤顺序。当前任务要求优先于适用的长期偏好，再采用插件默认；主 Agent 读取偏好并生成插件支持的实际计划。memory 保存带真实用户来源的 `user/workflow`，不另建流程偏好数据库。

| 插件 | 已支持的调整 | 保留的约束 |
| --- | --- | --- |
| investment-research | 选择/省略成员、调整阶段与并行组、添加自定义角色、指定最终综合者；问答跟随实际已完成前序成员 | 最后阶段唯一综合者，来源与工具显式选择，固定成果；省略计划保持默认八成员 |
| auto-factor-mining | 调整角色分工、同一成员兼任多项、跳过规划/评审/反思的 Agent 环节 | 真实 evaluator、候选资格、固定选择及独立留出；不同业务步骤保留独立任务身份 |
| trading-decision | 顺序前置复核、只形成决策与报告 | 任一复核阻止则不执行；复核无下单权限，原账户授权与风险规则有效 |
| factor-research / strategy-research | 根据目标裁剪研究指南并选择能力与原生引擎 | 保留证据时间、成本、试验与验证要求；指南不伪造运行入口 |

已接受的 Run 冻结计划，恢复复用身份、成果和已保存回执；修改计划开启新一轮。临时调整不写入长期默认，偏好不能放宽权限、风险或证据要求。判断生命周期和账户执行中的状态/授权校验仍是业务约束，不能因为允许调整流程而绕过。

## 资源接入：数据、平台、原生引擎与参考目录

| 插件 | 核心责任 | 主要交付与状态归属 | 协作边界 |
| --- | --- | --- | --- |
| [data-access](../plugins/api-v1/packages/data-access/capabilities.json) | 提供通用数据访问入口：发现来源与品种、查询分页数据、读取/冻结行情和数据快照、读取与导出固定数据、登记真实计算结果及输入关系 | 数据源描述、查询结果、固定数据引用、捕获记录、来源与派生关系 | 具体网络/API/终端协议归各来源插件；研究解释归业务或专业能力。保存的快照可复用，来源引用与固定快照分别表达 |
| [financial-research](../plugins/optional-api-v1/packages/financial-research/capabilities.json) | 接入金融研究信息源，管理来源凭据映射和访问状态，按查询与截止时点取得或复用证据，保存原始与规范化内容 | 金融来源证据、来源/可见时间/覆盖信息、历史证据目录、固定引用与访问状态；拥有证据记录 | 来源语义与历史时间约束留本包；投资问题拆解、观点综合交给 investment-research。复用历史证据按原规则判断所需配置 |
| [web-sources](../plugins/optional-api-v1/packages/web-sources/capabilities.json) | 获取明确指定的 HTTP/HTTPS URL，处理传输、编码和格式，保存完整来源内容，提供可查询的数据行与有界预览 | 原始内容、来源与哈希、固定引用、规范化行、获取状态 | 当前提供明确 URL 获取；通用搜索引擎检索不在其现有接口内。资料解释由调用者选择的分析能力负责 |
| [akshare](../plugins/optional-api-v1/packages/akshare/capabilities.json) | 接入 AKShare 及其支持的明确上游，发现和准备运行环境，提供 A 股等研究数据、报价、品种、历史行情及订阅适配 | 带上游身份、单位、复权与时间说明的数据；运行环境与安装回执、来源绑定 | 各上游覆盖、时间和单位语义分别保留；数据分析和交易执行交给对应能力。公共来源按实际需要配置 |
| [ccxt](../plugins/optional-api-v1/packages/ccxt/capabilities.json) | 接入当前支持的 Kraken/Coinbase/OKX 公共现货市场，管理路线与连接、品种、历史 K 线、更新订阅、断流与回填 | 交易所公共行情、品种精度、固定分页、连接版本和订阅状态；拥有路线 worker 与环境状态 | 当前范围为公共市场数据，无账户交易与 API key 功能；保留交易所游标、限速及闭合时间规则 |
| [mt5](../plugins/optional-api-v1/packages/mt5/capabilities.json) | 提供 MT5 平台完整适配：终端/连接/配置，市场和账户，原生方法与图表/编辑器/Python/系统工具，MQL5 工程/编译/翻译及一致性检查，Tester，EA 部署与原生交易 | 平台连接、行情/账户 source、持仓服务、工程修订和构建记录、Tester/部署/订单回执与产物；拥有原平台状态 | 投资研究与目标决策交给业务流程；组合批次由 portfolio-execution 管理。MT5 原生图表控制属于平台操作；Sesame 工作台呈现归 canvas-control |
| [qmt](../plugins/optional-api-v1/packages/qmt/capabilities.json) | 提供 MiniQMT 环境和连接适配，查询/下载行情，读取账户、持仓、委托与成交，提交/撤销原生订单，提供交易上下文及持仓服务 | 连接版本、行情与账户数据、原生订单标识、提交意图和回执、环境状态 | 保留整数份额、可售数量、T+1 等平台规则及 main/workflow/宿主不同入口的授权条件；组合目标编排交给 portfolio-execution |
| [backtrader](../plugins/optional-api-v1/packages/backtrader/capabilities.json) | 发现和准备 Backtrader 环境，校验固定输入，以策略源码执行真实 Cerebro 回测，保存并读取结果 | 原生回测回执、统计、输入/策略/结果引用、费用和撮合假设；拥有引擎环境及回测记录 | 数据来源由调用者明确提供；策略研究方法归研究指南/流程。引擎时间、精度与原生成交规则保持独立 |
| [vnpy](../plugins/optional-api-v1/packages/vnpy/capabilities.json) | 发现和准备 VeighNa 环境，使用固定数据及 CtaTemplate 策略运行原生 CTA 回测，管理预热与结果 | 原生 CTA 回测回执、统计、输入关系和结果产物、引擎环境及准备回执 | 保留本引擎的时间授权、预热和数据类型限制；与 Backtrader 分别适配各自引擎行为 |
| [quantskills-catalog](../plugins/optional-api-v1/packages/quantskills-catalog/capabilities.json) | 接入静态研究资源目录，按关键词/类别/阶段/资产筛选，读取条目，根据任务推荐方法和后端入口 | 参考条目、分类、任务路由建议与待核实的可用性说明 | plugin-manager 核验实际软件目录和安装状态并执行生命周期操作；参考推荐自身不产生安装授权 |

## 交互呈现：工作台与报告

| 插件 | 核心责任 | 主要交付与状态归属 | 协作边界 |
| --- | --- | --- | --- |
| [canvas-control](../plugins/api-v1/packages/canvas-control/capabilities.json) | 查看实际工作台状态，建立精确行情绑定，调整图表/窗口布局和焦点，发布及挂载/移除标准指标成果；读取、创建和修改与指标共用执行协议的绘图代码 | 布局修改、行情绑定、指标/绘图成果与挂载状态；布局、绘图修订和订阅由宿主管理 | 来源插件负责数据事实，专业能力负责分析结果；建立绑定与实际读取、渲染分别核验。绘图遵循原布局版本、对象修订和来源绑定检查 |
| [reports](../plugins/api-v1/packages/reports/capabilities.json) | 提供通用与回测报告模板，把已有数据和研究/策略成果组织为 HTML 报告，发布固定资源与版本，执行渲染检查和诊断；宿主报告界面提供 PDF/图片导出 | 模板、不可变报告与资源引用、报告版本、实际检查回执；导出绑定当前报告或文件版本，单文件直接列入目录 | 数据冻结继续复用 data-access；内容结论和标题归原研究或计算者。导出复用隔离渲染器，保留配套资源和版本归属，不另设研究流程 |

## 平台管理：配置、插件、记忆、文件与使用说明

| 插件 | 核心责任 | 主要交付与状态归属 | 协作边界 |
| --- | --- | --- | --- |
| [configuration](../plugins/api-v1/packages/configuration/capabilities.json) | 提供模型/认证/偏好/环境设置与统一“配置与密钥”入口；发现插件字段、展示消费能力、检查条件、保存或清除编辑值 | 配置目录、脱敏状态、依赖关系、原配置更新回执与管理界面 | 复用原配置和凭据存储、原读取/更新能力；字段语义和真实使用条件由所属插件声明，连接/认证结果由实际适配器核验 |
| [memory](../plugins/api-v1/packages/memory/capabilities.json) | 管理个人长期记忆、偏好、交易风格和风险约束；支持候选、来源核验、采用记录、修订、归档、恢复、遗忘及维护 | 个人记忆与候选、确认来源、版本/生命周期、适用的交易风险上下文；拥有个人记忆库 | 正式风险规则遵循真实用户确认；交易决策复盘归 trading-decision，统计判断与准则验证归 judgment-evolution |
| [plugin-manager](../plugins/api-v1/packages/plugin-manager/capabilities.json) | 发现和加载插件/知识，读取可信发布目录与状态，校验并执行安装、启停、更新和卸载，生成插件开发脚手架 | 插件及能力目录、知识资源读取、生命周期回执、版本/摘要状态、插件草稿 | 实际安装权限和生命周期由宿主执行；参考资料推荐归 quantskills-catalog。保留原发行校验和主会话权限 |
| [workspace](../plugins/api-v1/packages/workspace/capabilities.json) | 提供工作区编辑、宿主文件访问和受管理进程执行：列出/搜索/读取/导入，写入/编辑/移动/删除，执行命令与取消 | 文件内容与操作回执、变更版本/哈希、进程 Run 和输出 | 共用原 FileAccess 与进程桥接；工作区编辑和显式宿主文件操作保留各自路径、分页及覆盖语义。专属环境与依赖版本由对应适配器定义 |
| [orchestration](../plugins/api-v1/packages/orchestration/capabilities.json) | 提供 Sesame 产品使用与任务协作指南：安装上手、工作台、聊天/命令、设置、Agent/Run、研究与策略用法、排障 | 可加载的产品与协作知识文档 | 本包没有执行入口；Agent 调度、Run 状态、暂停/恢复、取消及权限等运行机制由现有宿主负责 |

## 配置与能力依赖的统一责任

| 责任主体 | 负责的信息和动作 |
| --- | --- |
| configuration | 统一发现字段、展示用途与状态、查看受影响能力、提供编辑/检查/保存/清除入口，并汇总原更新回执 |
| 字段所属插件 | 用 `configuration.fields[].schema/binding` 声明字段含义、格式、秘密属性、原读取/更新绑定；维护配置版本和实际连接/环境语义 |
| 实际消费能力 | 用 `configurationRequirements` 及其条件声明依赖；source/service 通过真实 operation 能力关联，缺项只影响满足该条件的调用 |
| 业务流程 | 按已选择的来源、模型和执行后端检查实际依赖；保留原任务状态，在原 Run 机制下处理补配置与恢复 |
| 原宿主与适配器存储 | 保持原权限、并发版本检查、配置/凭据存储和更新规则；秘密不进入普通回执、日志和 Run 历史 |

配置存在、运行环境就绪和外部连接验证分别表达。保存配置不隐式安装依赖、登录或启动终端。账户绑定引用保持冻结；修改后端配置不能静默切换执行账户。

当前统一管理 33 个实际连接、路径和来源凭据字段：MT5 22 项关联 31 个消费能力、Financial Research 5 项关联其查询能力、QMT 6 项关联 21 个消费能力，没有未关联字段。MT5 的终端设置与五项本地依赖路径分别沿原配置版本保存；跨组写入在变更前拒绝。QMT 沿原配置 CAS 和 operation 回执，区分行情与账户依赖。必需项、输入条件和 `optional:true` 分别表达；可选字段缺失不阻断原有默认/发现行为。

Python 环境动作的可选解释器选择继续沿各引擎的原环境入口；CCXT 的交易所和代理属于每个连接的绑定参数；Memory 的默认保留周期属于可选策略设置。它们不被改成全插件必填项或单个全局账户。模型认证通过统一页中的原模型设置入口管理。公共无密钥来源与纯知识指南不增加虚构密钥依赖。

客户端从 **User → Agent 插件 → 浏览插件与更新** 管理安装和更新，并从同页进入 **配置与密钥**。默认挂载自动装配能力和 SKILL 入口正文，可发现按任务显式发现/读取/加载，不可使用禁止调用与知识加载；子 Agent 的选择范围和工具权限仍需明确授予。更新保留三态，失败保留原可用版本，取消后核对实际安装状态。

## 共用实现与状态归属

| 共用范围 | 统一维护什么 | 原插件继续负责什么 |
| --- | --- | --- |
| judgment-evolution / trading-decision | 已核实相同的固定证据快照读取实现 | 各自的时间/证据规则、判断或交易业务、原 host/context 与数据库 |
| financial-research / web-sources | 相同的资源读取与文件发布基础代码 | 各自的原始来源、publishRows、输入输出差异、固定引用和发布归属 |
| web-extract / rss-collect / market-data-parser | 相同的固定来源读取、宿主进程调用和长结果发布 transport | 各自 Python 格式解析、能力身份、原输入边界和成果归属 |
| 18 个 ABU 局部计算包 | 既有输入/时间校验、摘要、固定成果与 CLI runtime | 各自 baseline 算法、参数和能力；完整职责见[专业能力清单](analysis-plugin-responsibilities.md) |
| reports / data-access | 保留已有 report_data → data_snapshot 委托 | 报告与通用证据捕获分别负责各自原契约 |
| workspace 两组文件接口 | 保留已有 FileAccess 与进程桥接 | 路径、行/字节分页、默认覆盖与文件策略等不同入口语义 |

新增共用代码统一维护、随各包自包含交付，不引入新的必装插件。原插件继续作为公开能力执行主体；数据库、队列、资源归属、幂等键、权限和已保存引用保持原契约。MT5/QMT 等来源已有宿主 source/service 适配，继续通过现有公开契约协作。

## 包内职责安排

以下为当前已实现的模块责任；没有新增必装插件或公共运行框架。

| 插件 | 内部职责安排 |
| --- | --- |
| financial-research | configuration（配置适配）、transport（来源访问策略）、evidence（证据生命周期）；复用既有 sources 和 records |
| mt5 | 工程与编译分别由 projects、compiler 负责；现有连接/来源/Tester/部署模块保留，共用原队列和生命周期 |
| qmt | connection、market、account、commands；共享原 provider-state、service 生命周期和最终授权校验 |
| ccxt | connection、instruments、history、stream；共享原状态、路线 worker 和取消/释放机制 |
| backtrader | fixed-input、backtest、results；environment 和 runner 保持原引擎适配 |
| trading-decision | scheduler 提取定时、事件准入与账户订阅；runtime 保留门面和唯一状态，计划、团队、报告等既有模块继续各负其责 |
| judgment-evolution | rules 负责规则评估，coverage 负责判断覆盖审计；service 保留门面与账本写入，完整证据读取继续位于同步事务之前 |
| memory | 保留已有分层；风险确认和短小的交易上下文仍紧邻唯一 repository，避免分散授权与事务 |

Investment Research 已有研究运行、成员、组合、产物和问答模块；portfolio-execution 已有绑定、组合、服务和锁的分工。其余包已逐项复核，按维护收益保留结构清楚的现有模块；这不是遗漏或要求它们统一目录外形。历史方案和回归门槛见[边界方案](../.omx/plans/plugin-boundaries-2026-10-19-plan.md)与[验证规格](../.omx/plans/plugin-boundaries-2026-10-19-test-spec.md)。
