# ABU 研究基线插件

把 [bbfamily/abu](https://github.com/bbfamily/abu/tree/d602d847677e4c2b77b0a122df30816ea68b5710)
的实用研究主题翻新为 18 个独立 API 2 包。每包一个研究工具、等价 Node.js CLI、
独立 Skill、合成示例及行为测试。全部按需发现，不进入九包默认集合。

**代码是可修改、可验证的基线，不是标准答案。Agent 可以根据需求改进算法、参数、
特征及验证方法；默认实现和默认参数均不代表最优。**

## 分类与使用场景

| 分类 | 插件 ID（均以 `sesame/` 开头） | 基线范围 |
| --- | --- | --- |
| 行情 | `abu-indicators` | SMA/EMA、MACD、RSI、布林带、ATR；对照窗口与初始化口径 |
| 行情 | `abu-trend` | 回归趋势、通道、路径效率；考察尺度敏感性 |
| 行情 | `abu-price-structure` | 延迟确认摆动、支撑阻力、黄金分割；明确何时知道拐点 |
| 行情 | `abu-volatility` | 滚动收益波动、跳空、ATR、成交量加权均价 |
| 行情 | `abu-similarity` | 对齐收益的 Pearson、Spearman 与方向相似性 |
| 选股 | `abu-stock-screening` | 显式股票池的价格、动量、趋势和路径效率筛选 |
| 信号 | `abu-breakout` | 历史窗口突破与最早行动时间；收盘观察不冒充同根成交 |
| 信号 | `abu-moving-average` | 快慢均线交叉，窗口敏感性及震荡中的反复触发 |
| 信号 | `abu-trend-pullback` | 长趋势与短期回撤/反弹的组合条件 |
| 信号 | `abu-seasonality` | 已完成历史的星期效应，明确日历与时区假设 |
| 风控 | `abu-exit-rules` | ATR 止损止盈、入场后峰值回撤和持有期退出 |
| 风控 | `abu-position-sizing` | ATR 风险预算、分数凯利、价格分位仓位及明确单位 |
| 评估 | `abu-trade-metrics` | 权益收益、回撤、胜负与成本归因 |
| 评估 | `abu-parameter-search` | 有界参数试验、开发集排名、固定选择与留出证据 |
| 特征 | `abu-ml-features` | 按可得时点计算回归、分位、波动、ATR、跳空特征 |
| 学习 | `abu-trade-judges` | 用历史已结束交易的相似邻居提供评分与拒绝依据 |
| 学习 | `abu-model-lab` | 轻量可解释模型，训练段拟合与之后的评估分开 |
| 回测 | `abu-backtest-lab` | 审计时序、成本、成交和约束，交接已选原生引擎 |

正常调用所需的输入、输出、默认参数、依赖和限制直接来自每个能力的 Schema 与 usage，
由宿主提供给 Agent，无需自行寻找用法。具体公式、差异及研究方法以各包 `README.md` 与
`skills/<插件名>/references/method.md` 为准。交易裁判不声称与原 UMP/GMM 等价，
回测审计不代替 MT5/vn.py/Backtrader 撮合，轻量模型不冒充完整 sklearn/XGBoost/HMM。

## Agent 使用与改进

公开入口为 `abu_<主题>_analyze({input:…})`。输入声明 `schema_version:1`、
`source:{id,kind}`、UTC `as_of`、参数与主题数据。时间格式含毫秒；K 线的 `time`
表示收盘时点，`available_at` 表示可被使用的时点。本能力不获取行情，缺失数据应作为
证据缺口保留；不能补造行情或改变来源以满足输入条件。

Native 调用立即返回实际计算结果及 `input_artifact`、`result_artifact` 两个完整 DataRef。
这些不可变引用保留 id、revision、digest、kind、schemaVersion，不能只截取 id 当作
登记数据集 ID。`data_read({ref})` 可把对应固定内容复制到研究目录；输入工件保存
`[{input}]`，结果工件保存不带自引用的计算结果。有效参数、输入/实现摘要、限制和
可得时点与结果一起保存；摘要核对字节身份，不独立证明供应商历史。

各包的 Skill 和合成示例用于需要时核对公式与格式，不是每次调用前的固定步骤。
正常使用已注册能力不需要翻实现源码。需要主动改进算法时，可在研究工作区保存原版和
修改版，以同一固定数据、成本和成交约束比较，并保留假设、参数、成功与失败试验。
训练拟合与参数选择只使用开发证据，固定选型后才使用留出结果验证，避免反过来优化留出集。

CLI `node scripts/baseline.mjs input.json --out result.json` 仅创建新结果文件，不覆盖已有
文件，也不自动发布工件、联网或下单。算法变更的发布保留出处、GPL 声明、独立版本和验证。

## 研究与交易组合

`investment-research` 的成员按研究问题调用选定的 ABU 能力，保留完整
`input_artifact` / `result_artifact` 及其参数口径，交接为固定研究成果 `result_ref`。
`trading-decision` 通过 `research_refs` 消费这些成果，不再派研究员或重复运行分析方法。
直接证据仍可用完整 `evidence_artifacts`；`evidence_dataset_ids` 只接受登记数据集 ID，
不能用 ArtifactRef.id 冒充。ABU 观察不创建交易授权或执行计划；真实账户执行由
`portfolio-execution` 和明确选择的原生后端负责。

## 来源与维护

ABU 来源固定至 `d602d847677e4c2b77b0a122df30816ea68b5710`。每包记录主题路径、作者、
差异与 GPL v3 全文，以 GPL-3.0-only 提供源码。公共数学方法用新的 Node 实现，
无旧 Python/NumPy/pandas/sklearn 运行时依赖。未搬入旧行情爬虫、Notebook 控件、
Caffe 演示、书本数据、私有模型或 abuquant.com 当前在线平台。

共享边界由 `scripts/abu-runtime.mjs` 维护，复制入每包保证独立安装；
`node scripts/sync-abu-runtime.mjs --check` 校验一致性，`--write` 同步改动。
行为测试验证数值、边界、时间可见性和训练隔离；真实宿主测试使用临时状态验证安装、
独立加载、资源读取、计算、证据冻结和重启。合成数据测试不证明投资业绩。

源码合入 dev 不等于发布安装归档。已发布目录、归档和标签不可变；安装版本以单独
发布流程后的统一目录为准。实际验证结果见 [验收记录](ABU-VALIDATION.md)。
