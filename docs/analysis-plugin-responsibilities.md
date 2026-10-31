# 专业能力插件职责与架构

2026-10-19 的不可变审计基线记录 31 个原 `analysis` 包与 33 项能力。2026-10-29 当前主分类为 29 个 `analysis` 包：RSS/网页解析改列 search，新增 historical-evidence，逐笔审计合入交易结果诊断。历史基线保留，以精确扩展和退役记录核验变化；当前全量 57 包的分类见[功能架构](plugin-functional-architecture.md)。

专业能力的共同责任是消费给定证据，解决一个局部问题，并把输入、计算或判断、限制和来源交回调用者。完整研究目标、方法选择与任务调度属于业务流程；数据获取属于资源接入；布局与报告呈现属于交互呈现。包内结构按实现责任选择，不按名字强制生成相同目录。

## 八个领域知识包

八包均为 `analysis / knowledge`，没有执行 capability 或 source。`index.js` 保留空注册；`SKILL.md` 负责使用边界，`references/` 负责具体判据、反例及验证，`examples/` 保存合成证据和独立预期。ICT、Price Action 附带的 Python 观察脚本仍可通过原路径读取和执行，其计算不代表自动完成理论解释。

| 插件 | 局部责任与交付 | 保留的边界 |
| --- | --- | --- |
| [ict](../plugins/optional-api-v1/packages/ict/README.md) | 固定参考范围、三柱缺口、流动性与结构转变候选；交付确认时点、支持/反证和失效条件 | 既有 `scripts/observe.py`、`bar_input.py` 保留；不从 OHLC 推断真实机构订单 |
| [price-action](../plugins/optional-api-v1/packages/price-action/README.md) | 趋势/区间、延迟确认摆动、突破与失败动作的局部判断 | 观察脚本与人工解释分开；后续柱确认不能回填为事前已知 |
| [elliott-wave](../plugins/optional-api-v1/packages/elliott-wave/README.md) | 对照明确浪形计数、替代解释和失效位置 | 浪形标签是待检验解释；无自动全局计数或取数器 |
| [wyckoff](../plugins/optional-api-v1/packages/wyckoff/README.md) | 区间、量价关系与阶段假设 | 保留成交量单位和 tick volume 的限制，不把阶段标签当因果事实 |
| [dow-theory](../plugins/optional-api-v1/packages/dow-theory/README.md) | 趋势层级、跨市场确认与相反证据 | 缺少另一市场证据时保持缺口，不自行制造确认 |
| [behavioral-finance](../plugins/optional-api-v1/packages/behavioral-finance/README.md) | 参照点、注意力与预期偏差的可检验假设 | 心理解释、可观测代理和因果证据分别表达 |
| [institutional-analysis](../plugins/optional-api-v1/packages/institutional-analysis/README.md) | 基于披露、持仓、流量与市场结构材料解释机构约束和行为 | 保留披露时滞、覆盖与代理性质；不把价格模式当机构真实订单 |
| [narrative-analysis](../plugins/optional-api-v1/packages/narrative-analysis/README.md) | 叙事命题、传播、预期和反证的结构化解释 | 来源文本是资料；关注度和价格同向不自动证明因果 |

这八种方法可以单独选择，原知识入口不互相自动加载。已有结构足够清楚，继续保留；补齐其包内架构说明并纠正过期版本文字，不增加空执行层或新工具。

## 十七个局部量化计算包、十八项能力

十七包均为 `analysis / function`；交易结果诊断同时提供 `abu_trade_metrics_analyze` 与 `abu_trade_results_audit`，其它包各保留一个实际能力。`index.js` 注册，`scripts/baseline.mjs`（逐笔审计为 `scripts/audit.mjs`）实现本包算法，`scripts/runtime.mjs` 保持输入、时间、证据摘要、固定成果和 CLI 协议。统一 runtime 在仓库 `scripts/abu-runtime.mjs` 维护并同步到每个独立包；算法仍分别维护，不创建一个包代替全部能力。

| 插件 | 局部责任与交付 | 不承担的相邻责任 |
| --- | --- | --- |
| [abu-indicators](../plugins/optional-api-v1/packages/abu-indicators/README.md) | SMA、EMA、MACD、RSI、布林带、ATR 与预热状态 | 不形成策略、不获取行情；未知可见时间保持未知 |
| [abu-trend](../plugins/optional-api-v1/packages/abu-trend/README.md) | 滚动回归斜率、通道、拟合和路径效率 | 描述趋势，不预测价格或调度研究 |
| [abu-price-structure](../plugins/optional-api-v1/packages/abu-price-structure/README.md) | 延迟确认摆点、支撑阻力聚类、回撤水平 | 不替代 Price Action/ICT 等方法解释 |
| [abu-volatility](../plugins/optional-api-v1/packages/abu-volatility/README.md) | 收益波动、ATR、跳空和累计 VWAP | 不估算未经声明的成交量含义或下单 |
| [abu-similarity](../plugins/optional-api-v1/packages/abu-similarity/README.md) | 时间精确对齐的收益相关、秩相关、方向一致率 | 不补日历、不前向填充或推断交易可替代性 |
| [abu-stock-screening](../plugins/optional-api-v1/packages/abu-stock-screening/README.md) | 在明确有界品种池内按动量、价格位置、趋势与效率排名 | 不获取成分股、补退市数据或决定交易目标 |
| [abu-breakout](../plugins/optional-api-v1/packages/abu-breakout/README.md) | 已知历史窗口的收盘突破观察 | 不把观察当原生入场成交 |
| [abu-moving-average](../plugins/optional-api-v1/packages/abu-moving-average/README.md) | 双均线交叉和时点可见性 | 保留独立参数及观察，不并入通用指标后改变原接口 |
| [abu-trend-pullback](../plugins/optional-api-v1/packages/abu-trend-pullback/README.md) | 长趋势、短回撤与反弹的组合观察 | 不负责研究步骤、授权仓位或账户执行 |
| [abu-seasonality](../plugins/optional-api-v1/packages/abu-seasonality/README.md) | 用已结束历史样本统计 UTC 星期效应 | 不把 UTC 星期自动等同交易所会话或月日历 |
| [abu-exit-rules](../plugins/optional-api-v1/packages/abu-exit-rules/README.md) | ATR 止损/止盈、移动退出和持有期观察 | 消费显式持仓输入，不管理真实保护单 |
| [abu-position-sizing](../plugins/optional-api-v1/packages/abu-position-sizing/README.md) | ATR 风险预算、分数 Kelly、价格分位仓位比较 | 数量单位和点值需明确，不连接账户或提交订单 |
| [abu-trade-metrics](../plugins/optional-api-v1/packages/abu-trade-metrics/README.md) | 权益收益、回撤、交易统计，以及独立订单/成交时序、成本和约束审计 | 不生成成交、补资金流或执行回测 |
| [abu-parameter-search](../plugins/optional-api-v1/packages/abu-parameter-search/README.md) | 有限网格排名、固定开发选择与留出交接校验 | 消费真实试验指标，不执行试验或自动研究循环 |
| [abu-ml-features](../plugins/optional-api-v1/packages/abu-ml-features/README.md) | 指定决策时点之前已知的历史特征 | 不训练模型、生成标签或改变数据可见时间 |
| [abu-trade-judges](../plugins/optional-api-v1/packages/abu-trade-judges/README.md) | 已结束交易的邻居相似评分和拒绝证据 | 透明替代基线，不宣称 ABU UMP/GMM 等价 |
| [abu-model-lab](../plugins/optional-api-v1/packages/abu-model-lab/README.md) | 时间分离的线性/逻辑预测实验、训练 scaler 和评估指标 | 固定本地计算，不管理宿主模型认证或 Agent 团队 |

输出继续返回原完整 `input_artifact` 和 `result_artifact`；CLI 保留原 JSON 输入及 `--out` 不覆盖语义。参数和证据属于一次调用，不移成全局配置。保持原 `implementation_sha256` 算法、源时点、缺值、迟到、预热、固定选择和留出规则；重叠公式只代表可复用计算主题，不能把多个同源派生量算作独立证据。

## 评估、表达与解析边界

| 插件 | 实现与能力 | 包内责任与保留理由 |
| --- | --- | --- |
| [historical-evidence](../plugins/optional-api-v1/packages/historical-evidence/README.md) | `analysis / function`；历史匹配、校准及固定引用读取 | 固定特征与到期结果的分层匹配；前瞻原记录与今日 historical_replay 分开，回放仅探索诊断、不输出当前校准概率 |
| [factor-evaluator](../plugins/optional-api-v1/packages/factor-evaluator/README.md) | `analysis / function`；`factor_evaluate` | `index.js` 注册，`engine.js` 负责有界 AST、数据时点和实际指标，`evaluator.js` 负责可信调用者、冻结选择、回执与原 `sessions` 状态。局部评估协议已有完整边界；保留唯一串行队列、CAS、持久资源和原所有权校验 |
| [strategy-authoring](../plugins/api-v1/packages/strategy-authoring/skills/strategy-authoring/references/architecture.md) | `analysis / service`；原 10 个策略/模型判断/生命周期能力 | 复用 SDK 的 SVL 验证/图/回放；`lib/` 已按组合、风险、执行回放、量化函数、模型判断与持久记录划分。`artifact-io.js` 保留固定文件与成果 I/O；不再分散现有账本、生命周期和状态。图的前端布局由宿主呈现 |
| [web-extract](../plugins/optional-api-v1/packages/web-extract/skills/web-extract/SKILL.md) | `search / function`；`extract_webpage` | `index.js` 注册；共用 `parser.js` 处理宿主 transport；`server.py` 负责 HTML 正文、标题和链接规则。只解析已有内容 |
| [rss-collect](../plugins/optional-api-v1/packages/rss-collect/skills/rss-collect/SKILL.md) | `search / function`；`parse_feed` | 同一 transport、独立 RSS/Atom 解析；原条目截断、源信息与固定结果规则保持 |
| [market-data-parser](../plugins/optional-api-v1/packages/market-data-parser/skills/market-data-parser/SKILL.md) | `analysis / function`；`parse_fx_json`、`parse_fx_xml` | 同一 transport、独立 JSON/XML 汇率解析；原币种筛选和字段保持，不变成实时行情源 |

三个解析器保留不同包、能力、格式算法和成果归属，只将完全相同的 transport 设为单一维护源：`plugins/optional-api-v1/scripts/shared/parser.js`。现有 `sync-boundary-helpers.mjs` 校验或同步包内副本；安装包不需要邻居包或仓库脚本。固定源读取、大小限制、错误、取消、临时目录与长结果发布均保持原行为。

## 配置与能力关联审计

| 范围 | 真实依赖及归属 | 本次结论 |
| --- | --- | --- |
| 8 个领域知识包 | 已有证据；ICT/Price Action 可选脚本需要实际 Python；解释使用宿主模型 | 没有插件私有配置字段；不为知识加载添加运行或密钥门槛 |
| 17 个 ABU 包 / 18 项能力 | 宿主 Node.js、调用中的固定输入与参数、宿主资源接口 | 没有外部服务凭据；账户数值是研究输入，不是连接配置 |
| factor-evaluator | 宿主固定数据、资源和私有 state；可信工作流调用 | `sessions` 是评估业务状态，不属于用户可编辑配置；不复制模型或信源凭据 |
| strategy-authoring | 纯验证/图/回放无需外部后端；实际模型判断使用宿主模型目录和 `host.model.complete` | 模型认证复用统一页的原模型设置入口；本地 bridge token 为每次进程生成的短期凭据，不进入长期配置、报告或源码 |
| 3 个解析器 | 原 `requires` 显式绑定 `host.process.exec`；已有 `host.context.pythonPath` 或原平台默认解释器 | 没有独立 Python 配置存储和 API Key；不额外设置全局必填项；源凭据绑定在所选取数能力 |

31 包当前都没有需要新增到统一入口的用户配置字段，原声明无孤立 `configurationRequirements`。这是按实际消费关系核验的结果；以后引入真实可保存字段时，仍须按统一规则声明字段并绑定消费能力。插件参数、评估会话、短期 bridge token 和上游连接凭据不能混为一类配置。

## 验证与维护

实施计划与测试证据见[专业能力架构实施记录](plans/2026-10-19-analysis-plugin-architecture.md)。`analysis-plugin-contracts.json` 在修改前冻结 31 包完整声明摘要与原路径，`analysis-plugin-architecture.test.js` 校验全部契约，并逐包归档、解包、摘要验证、独立导入和实际能力注册。既有数值、CLI、知识隔离、宿主资源与恢复测试继续保留。

专业能力包没有渲染用的深浅绿色主题；可视化颜色由宿主和呈现包管理。此次职责对齐没有改变算法、函数接口、许可、持久化身份或现有成果；源码验收与发布、安装和外部服务连通分别核对。

ABU 整理仅把逐笔结果审计并入 `abu-trade-metrics`，旧包/能力已删除，无同名空壳。源算法和数值算例保持，见 [退役记录](../plugins/api-v1/tests/fixtures/analysis-plugin-retirements.json)。`abu-parameter-search` 排名已提供开发指标，不执行优化器；`abu-similarity` 计算同期收益相似性，不替代历史同情景匹配；`abu-trade-judges` 的历史连续收益邻居评分也不等同二元概率校准。
