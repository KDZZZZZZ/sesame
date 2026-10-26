# 插件功能架构与分批验收

本说明适用于当前 Plugin API 2 源码：59 个插件，其中 11 个核心、48 个可选。主分类按插件在实际任务中的职责划分，用于发现和导航；实现类型独立记录它如何实现，用于选择包内结构。分类本身不改变调用权限；2026-10-26 将产品帮助从编排中独立为默认核心插件 `sesame/user-guide`。

## 分类与清单

每包在 [inventory-policy.json](../plugins/api-v1/inventory-policy.json) 中指定一个主要 `functionalCategory`，保留原 `category` 以兼容既有目录。2026-10-19 按用户反馈，将原先混合业务主题和实现形式的九类改为以下五类；判据是插件负责的结果，不是它暴露的接口。

| 职责 | 标识 | 当前数量 | 判断依据 |
| --- | --- | ---: | --- |
| 业务流程 | business | 9 | 组织完整任务的目标、步骤、选择、验收与交接，包含宏观方法指南和可执行工作流 |
| 专业能力 | analysis | 31 | 在给定证据和边界内提供可复用的知识判断、分析、计算或解析 |
| 资源接入 | integration | 11 | 访问和发现数据、搜索信源、终端、原生引擎或参考资源 |
| 交互呈现 | presentation | 2 | 组织可见的工作台、图表、报告及交互 |
| 平台管理 | platform | 5 | 管理配置、插件、工作空间、记忆与宿主使用规则 |

因子研究指南和自动因子研究都负责推进完整研究，属于业务流程；ICT 判断和指标计算都为任务提供局部能力，属于专业能力。一个专业方法包含操作步骤，不代表它负责完整业务流程。资源接入也包含离线目录、本机终端和原生引擎，不限于联网 API。

`implementationKinds` 是非空、无重复数组，可组合 `knowledge`、`function`、`adapter`、`workflow`、`service`。生成器根据**实际暴露的声明及随包入口**推导最小实现：显式 agent/workflow/graph、source 或 MCP 绑定、service/view/lifecycle hook、普通 capability、最后才是纯知识。更专门的职责覆盖机械 function/lifecycle 胶水；执行时间长、存在状态回执或存在 Python/JS 参考脚本，都不自动等于 workflow/service/function。纯知识包的空原生入口也不是执行能力。

policy 中的类型是可校验的审阅预期，不是分类真相。只有声明无法表达的语义差异可加 `implementationReason`（例如通过普通函数适配宿主服务，或离线 MCP 目录查询）；无理由的漂移、已过时的例外、把纯知识虚构为执行能力，以及隐藏已声明 workflow/source，都会失败。主职责、effects 和实现标签均不授予调用权限。

| 插件 | 任务职责 | 实现类型 |
| --- | --- | --- |
| factor-research | business：因子研究全过程指南 | knowledge：知识文档 |
| auto-factor-mining | business：可执行的因子研究流程 | workflow：工作流 |
| ict | analysis：局部结构与流动性判断 | knowledge：知识文档 |
| abu-trend | analysis：趋势计算 | function：确定性函数 |
| mt5 | integration：终端、行情与账户接入 | adapter：平台适配 |
| reports | presentation：报告展示与交互 | service：宿主服务 |

### 全量归属

以下均省略 `sesame/` 前缀，每个包只列一次：

| 主类 | 插件 |
| --- | --- |
| business（9） | factor-research、strategy-research、auto-factor-mining、investment-research、trading-decision、portfolio-execution、judgment-evolution、kurumi-replay、ultra |
| analysis：领域知识（8） | ict、price-action、elliott-wave、wyckoff、dow-theory、behavioral-finance、institutional-analysis、narrative-analysis |
| analysis：局部量化处理（18） | abu-backtest-lab、abu-breakout、abu-exit-rules、abu-indicators、abu-ml-features、abu-model-lab、abu-moving-average、abu-parameter-search、abu-position-sizing、abu-price-structure、abu-seasonality、abu-similarity、abu-stock-screening、abu-trade-judges、abu-trade-metrics、abu-trend、abu-trend-pullback、abu-volatility |
| analysis：评估、表达与解析（5） | factor-evaluator、strategy-authoring、market-data-parser、rss-collect、web-extract |
| integration（11） | data-access、web-sources、financial-research、akshare、ccxt、binance、mt5、qmt、backtrader、vnpy、quantskills-catalog |
| presentation（2） | canvas-control、reports |
| platform（6） | configuration、memory、orchestration、plugin-manager、user-guide、workspace |

binance 专注 Binance Spot 的公开行情、账户余额及订单操作，生产与测试网身份独立；ccxt 继续负责其已声明交易所的公开行情聚合。现货余额和交易数量使用原生资产单位，不套用 MT5 持仓票据或 QMT 整数股语义。

其中 strategy-authoring 处理已明确的策略逻辑、表达与求值，不负责选择研究方向；三个解析器消费已经提供的内容，不负责联网获取。portfolio-execution 对已有账户执行获授权目标，交易目标由 trading-decision 决定。judgment-evolution 组织事前登记、结果核验、复盘与前瞻验证；kurumi-replay 负责完整的历史角色模拟任务。orchestration 提供 Agent/Run 协作编排方法，user-guide 提供产品操作帮助；两者都是平台知识，默认挂载且不注册运行入口。quantskills-catalog 提供资源发现，不实现目录收录的方法。

[分类定义与校验](../plugins/api-v1/scripts/plugin-taxonomy.mjs) 集中维护枚举；[inventory 生成器](../plugins/api-v1/scripts/inventory.mjs) 从实际声明投影能力和版本，检查缺失、重复和过期条目。生成清单仅作描述，安装授权仍来自既有固定发布目录。

## 发行目录与脚手架

继续保持以下平铺结构，不按功能组嵌套包目录：

```text
plugins/
├── api-v1/packages/<slug>/           # 核心包
└── optional-api-v1/packages/<slug>/  # 可选包
```

包内共同边界是 `plugin.json`、`capabilities.json`、薄注册入口 `index.js` 和显式知识资源。只增加业务需要的目录；跨包调用使用公开 capability，不相对导入其它插件实现。

`plugin_create` 和 [独立 CLI](../plugins/api-v1/packages/plugin-manager/scripts/create-plugin.mjs) 支持五种实现模板，并保留 `native`、`skill`：

| 模板 | 起点 |
| --- | --- |
| knowledge | 空执行能力、技能及方法/反例参考 |
| function | `src/analyze.js`，固定数值求和示例和预期输出 |
| adapter | `src/source.js`，按实际支持的来源或平台功能补充 |
| workflow | `src/runtime.js`，native workflow + Run |
| service | `src/service.js`，按需声明宿主贡献和状态 |
| native / skill | 原有 echo / 纯知识草稿，接口保持兼容 |

adapter、workflow、service 的未实现入口明确抛出 `NOT_IMPLEMENTED`。脚手架可通过相同的宿主 package、schema 和 binding 检查，不代表业务已完成。`native` 保留旧 echo 输入/输出，`skill` 保留旧最小知识布局；生成 README 明示它们分别是 function/knowledge 的兼容形式，不伪称与新模板字节相同。所有模板的权限请求从空数组开始，模板配置说明不向无依赖的草稿添加必填密钥。

`plugin.json` 根级 `permissions` 为 `{ "scopes": [], "calls": [] }`；省略也表示空请求，声明存在时两数组必须显式提供。`calls` 只能是完整能力 ID（`host.name`、`publisher/name#name`）或 `{pluginId,serviceId,operation}` 服务操作选择器，不支持通配符。优先声明依赖锁或确切调用；只有实际运行时选择任意提供方的组合才请求 `capabilities.compose`。敏感 scope 的用户授权由宿主另存，包、配置、effects、分类和 Agent 不能自行授权；缺失、撤销或扩权时应显示待授权，而不是默认放行。同进程原生 JS 与直接子进程仍是受信代码，这些端口授权不是 OS 沙箱。

## 三个试点

| 试点 | 目录职责与保留边界 |
| --- | --- |
| [ICT](../plugins/optional-api-v1/packages/ict/README.md) | `skills/ict/` 组织判据与参考，`examples/` 固定教学输入和预期，`scripts/observe.py`、`scripts/bar_input.py` 保留原路径和内容；仍无执行 capability，不创建空 src 层。 |
| [MT5](../plugins/optional-api-v1/packages/mt5/README.md) | `index.js` 负责绑定；`backend/plugin-runtime.js` 负责生命周期与分发；既有 `backend/`、`tools/`、`skills/` 继续承担连接、实际操作及用法。原生 bridge、公开输入输出和状态目录保持原状。 |
| [Investment Research](../plugins/optional-api-v1/packages/investment-research/README.md) | `src/runtime.js` 组织流程和恢复，workflow 管可选计划，members/composition 管成员与选择，artifacts 管固定成果，qa/team 管问答和协作；保留原能力 ID、知识路径和默认行为，Schema 增加可选流程参数。模型继续使用宿主目录。 |

ICT 的验收保留原 Python 样例的 5 个区间观察及其确认时点；MT5 核对既有连接配置、激活和源/能力绑定；Investment Research 核对完整成果、多轮问答、缺依赖暂停、原 Run 恢复和报告精确修订。固定夹具验证不替代真实外部服务连接验证。

## 统一配置与能力依赖

用户通过 **配置与密钥** 窗口管理已安装插件声明的字段，也可由主 Agent 调用以下入口：

- `configuration_integration_open` 打开统一窗口。
- `configuration_integration_catalog` 查看字段、配置状态和依赖该字段的能力。
- `configuration_integration_check` 检查指定字段是否具备配置。
- `configuration_integration_apply` 保存已编辑字段；旧配置入口继续可用。

插件作者在 `capabilities.json` 顶层的可选 `configuration.fields` 声明字段，并在真正消费它的能力上添加 `configurationRequirements`。字段用稳定 ID 关联，`when` 可限定能力输入中的适用分支。例如只有选择收费信源时才要求该信源密钥，不因此阻塞本地计算、其它来源或配置探测。

字段绑定复用环境配置源或既有插件的读取/更新能力；不建立另一份凭据存储。`configSchema` 继续描述启动配置，不能被当作全部能力的共同前提。ICT 没有密钥依赖；Investment Research 复用宿主模型配置；MT5 统一入口复用现有版本化配置能力。

同插件的多组原配置保留各自读取、更新和版本，统一页按 authority 分组独立保存；单次跨组写入在任何变更发生前拒绝。有默认值或发现机制的消费字段通过 `optional:true` 显示关联，缺项不增加调用门槛。可选环境选择和多连接的绑定参数继续沿原入口维护，不被改成虚构的全局必填字段。

密钥通过 `writeOnly` 标记，只显示配置状态，不显示已存值或在回执中回显。未编辑密钥省略，清除是显式操作。`configured` 或保存成功只说明已有配置，认证、权限、订阅范围和连接健康仍由相应能力实际核验。缺字段导致 Run 暂停时，补齐后沿用原 Run 的恢复流程。

详细字段、条件、绑定、并发版本、保存权限及脱敏规则以宿主的 [configuration.md](../../mt5agent/docs/plugin-api-v2/configuration.md) 为准；该链接指向同一工作区的宿主仓库。插件作者另见 [API 2 作者说明](../plugins/api-v1/packages/plugin-manager/skills/develop-plugins/references/authoring.md)。

## 分批推广与验收

31 个专业能力包已完成全量架构核对与对齐，详见[逐项责任和配置审计](analysis-plugin-responsibilities.md)。八个知识包保持显式知识资源，十八个 ABU 包保持算法与共用证据运行时分离；三个解析器统一维护同源 transport 并独立交付；评估器和 SVL 保留已有纯计算、协议、状态与生命周期分层。修改前冻结全部 33 个执行能力的完整声明，未增加无实际依赖的配置项。

后续按实现类型选小批插件逐包迁移，每批完成以下步骤后再继续：

1. 核对实际包清单、功能分类与实现职责，记录公开声明、资源路径和当前测试基线。
2. 补必要回归，整理私有文件；保留接口和状态语义，仅把真实配置依赖绑定到消费能力。
3. 验证 API 2 声明、原生绑定、包内资源/导入、固定样例、异常/取消与必要的宿主恢复链路。
4. 统一更新 inventory 和发行锁，检查版本、能力与文件摘要一致；检查通过后进入下一批。

首批持续回归入口包括 `inventory-taxonomy`、`plugin-scaffold`、`profiles`、`plugin-authoring-host`、`plugin-architecture-pilots`、方法脚本/宿主测试，以及 MT5 和 Investment Research 的专项测试。宿主测试使用匹配版本的 SDK loader 和临时状态；清单同步与测试通过是推广前提，发布仍走现有发行流程。

交付检查使用仓库内 `plugins/api-v1/tests/fixtures/plugin-boundaries-baseline.json` 和显式 configuration extensions，不读取个人规划目录。`verify-plugin-boundaries.mjs --report` 分开列出版本标签与声明/路径漂移；版本增加不等于接口破坏，也不能批准实际接口变化。原始 baseline 保持不变；`--capture <新路径>` 只生成可重复的、注明未审阅的候选，拒绝覆盖原始证据或既有输出，不能靠重录当前源码把失败变绿。`--review <新路径>` 输出每个声明差异的 before/after 指纹、字段值及保守影响提示，默认全部 pending。审阅者逐项写出理由并批准之后，可用 `--approved <审阅文件>` 验证，或把审批记录作为 `tests/fixtures/plugin-boundaries-reviewed-changes.json` 纳入源码。审批只允许精确的旧/新差异；基线、扩展、源码再变化、未知条目、重复条目、空理由或未批准项均拒绝，未审阅的新差异继续失败。

`optional-api-v1/scripts/sync-boundary-helpers.mjs --check` 检查显式登记的 19 份复制件：原 7 份 dataset/artifact/parser helper、10 份 workflow/research/report helper 和 2 份隔离报告 fixture。`--write` 只写这些路径，不遍历覆盖各业务的 records/账本。绘图契约另用 `api-v1/packages/canvas-control/scripts/sync-drawing-contract.mjs <host-root> --check` 验证；领域状态模型仍独立。

所有源码写入收敛之后才重建两发行锁与描述 inventory，核对源码分类文档，再进行独立 archive 和真实宿主声明验证。本轮依赖新权限、SDK、绘图或执行契约的包使用 `engines.sesame: ">=0.3.0-dev.1 <0.4.0"`，拒绝旧 0.2.4 宿主静默忽略安全请求；这是未发布的开发候选版本，不改变独立 API 2/协议版本。发布目录必须仍从实际固定发布文件验证；不可改历史 archive/source pin 或历史字节断言来匹配当前工作区。版本按各包的实际变化递增，并避开已知已安装版本；源码、已安装二进制和正式发布始终分别报告。
