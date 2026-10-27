from pathlib import Path
import csv, html, json, re, hashlib
from collections import Counter
import markdown
from bs4 import BeautifulSoup

REPO = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
BASE = '研究报告体系-Trading-Central-Autochartist与Sesame-20261026'
FIELDS = []

def group(category, text):
    for line in text.strip().splitlines():
        key, label, nature, status, example, route = [x.strip() for x in line.split('|')]
        FIELDS.append(dict(category=category, key=key, label=label, nature=nature,
                           status=status, example=example, route=route))

# 下面是本研究设计的业务字段字典，不是供应商 API schema。
# 取=当前实现可有条件取数；算=已有确定性实现；编=需补版本化计算；源=缺结构化源/历史；授=原厂专有结果需授权；呈=组织/展示。
group('01 身份、时间、单位与来源', '''
report.id | 报告ID、report_uid | 管理 | 呈 | demo-eurusd-01 | reports ArtifactRef；与供应商结果ID分开
report.kind | 报告种类、report_type | 管理 | 呈 | technical_scenario | 新增业务模块目录，映射现有outline
report.provider | 机构、产品、publisher | 来源 | 取/呈 | Sesame / 自有技术研究 | 取真实来源；自研结果不标为TC/AC
instrument.id | Instrument、symbol、ticker、标的 | 事实 | 取 | EURUSD / broker-symbol | data-access + 对应market source；保留来源标识
instrument.name | 公司名、资产名、logo | 事实 | 取/源 | 示例公司；logo未提供 | 行情目录可取名称；公司品牌/标识需资产主数据
instrument.market | 市场、exchange、region、asset_class | 事实 | 取/源 | FX / broker / USD报价 | market source；区域和上市地需主数据补全
instrument.sector | 行业、sector、industry | 事实 | 源 | 示例半导体行业 | 当前财务工具未建立统一公司行业主表
instrument.currency | 报价/报表/账户币种 | 事实 | 取 | quote=USD，account=USD | 各源分别取；不能用报价币种替代财务币种
instrument.contract | tick/pip、lot步长、乘数、合约类型 | 事实 | 取/源 | pip=0.0001；标准手100000 | MT5/Binance/QMT已部分覆盖；pip需明确定义
scope.horizon | Investment/Holding Horizon、forecast_minutes | 定义 | 呈 | 未来4小时 | 与K线周期、回测区间分别保存
scope.bar_size | Bar Size、interval/granularity | 事实 | 取 | 1h | data-access spec；不要从持有期反推
scope.universe | 投资范围、同业范围、国家与筛选池 | 定义 | 编/源 | 同行业40家公司 | 固定证券全集及纳入/退市规则
time.as_of | as_of、data_as_of、Report Time | 来源 | 取/呈 | 2026-10-26T12:00:00Z | 拆成数据截点与报告生成时间
time.observed_at | 价格/指标实际观察时刻 | 来源 | 取 | 2026-10-26T11:59:00Z | 各适配器源时间；未知时不冒充UTC
time.available_at | 首次可得/披露时间、acceptanceDateTime | 来源 | 取/源 | 财报11月5日才可得 | financial-research已有外壳；缺原始发布档案需补
time.retrieved_at | 采集时间 | 来源 | 取 | 2026-10-26T12:01:00Z | DataRef来源；不等于历史首次发布时间
time.timezone | 市场时区、session、calendarRevision | 来源 | 取/源 | UTC；EU session | 券商墙钟需明确转换；未知日历保留未知
source.refs | source_refs、URL、raw_ref、原文 | 来源 | 取/呈 | 固定DataRef + URL | data-access / financial-research；报告绑定引用
source.version | provider/version/endpoint/path、model_version | 来源 | 取/编 | method=sesame.breakout.v1 | 现有hash/版本复用；新增供应商字段路径映射
source.status | 缺失状态、覆盖、许可、修订 | 来源 | 取/编 | unknown / not_applicable | 已有coverage/status；许可与字段级状态需补
value.unit_scale | 单位、精度、score scale | 定义 | 取/编 | 0.72 fraction；72 percent | 同时保留raw值与原尺度，禁止凭数值猜尺度
''')

group('02 行情、技术指标与市场状态', '''
price.reference | Current/Reference Price、closing_price | 事实 | 取 | 1.1000 USD/EUR | 同一来源和价格基准；market_read
price.ohlcv | OHLCV、时间、闭合状态 | 事实 | 取 | H1收盘1.1000；tick volume | market_read；volume类型与单位单列
price.bid_ask | bid、ask、spread | 事实/计算 | 取/编 | 1.0999/1.1001；2 pip | MT5/Binance/QMT报价；ask-bid后换单位
price.return | 涨跌额、涨跌幅、Price Performance | 计算 | 算/编 | 100→103；+3% | ABU收益/波动；基准与复权须一致
price.relative_strength | 相对板块/指数强弱 | 计算 | 编/源 | 20日资产+4%，行业+1% | 两条同口径序列；额外行业/基准来源
market.trend | trend、短/中/长期方向 | 判断 | 编 | 日内偏弱；长期上升 | 指标/确认拐点可用；固定判定方法
market.volatility_regime | volatility_regime、低/高波动状态 | 模型 | 编 | 波动处于自身历史第80百分位 | 现有波动值+训练窗分位阈值
market.liquidity | liquidity、成交活跃度/深度 | 事实/模型 | 取/编/源 | 点差2pip；深度未取 | 报价可取部分；完整深度与冲击历史缺
indicator.ma | SMA/EMA、MA20/MA50 | 计算 | 算 | SMA20=102；SMA50=100 | abu-indicators；显式算法/初始化
indicator.rsi | RSI | 计算 | 算 | RSI14=58 | 当前实现均值法，不能默认为Wilder
indicator.macd | MACD、signal、histogram | 计算 | 算 | DIF=0.5；signal=0.3 | abu-indicators；参数与预热一致
indicator.stochastic | 随机指标、K/D | 计算 | 编 | K14=70，D3=65 | 需补版本化计算与平滑参数
indicator.bollinger | Bollinger上下轨与带宽 | 计算 | 算 | 中轨100；上104；下96 | abu-indicators；ddof/窗口固定
indicator.tr_atr | True Range、ATR、ATR% | 计算 | 算 | TR=60pip；ATR14=35pip | ABU各基线首TR不同；方法ID锁定
indicator.vwap | VWAP | 计算 | 算 | 样本累计VWAP=100.4 | abu-volatility；不是默认交易所当日VWAP
indicator.hv | 收益标准差、年化HV | 计算 | 算 | 日频HV=24% | abu-volatility；交易日数/收益定义固定
indicator.gap | 跳空幅度与标记 | 计算 | 算 | 开盘较前收+1.2% | abu-volatility；公司行为与停市先解释
indicator.adc | Adaptive Divergence Convergence | 专有 | 授/编 | 原厂值缺；自研另命名 | TC公开框架但自适应周期不完整
market.snapshot | 指数/板块/商品/FX/加密表现 | 事实/汇总 | 取/编/源 | 指数+0.6%；能源领先 | 行情可拼接；跨市场全集/行业源待补
market.risk_gauges | VIX、国债收益率、DXY等 | 事实 | 取/源 | 10Y收益率4.0% | FRED/行情按实际series与授权；无统一实时包
''')

group('03 技术事件、几何、质量与生命周期', '''
event.id | result_uid、技术事件ID | 管理 | 取/编/授 | demo-pattern-01 | 现有计算生成事件；原厂结果须接入；大ID用字符串
event.type | Event Type、pattern_name、形态名称 | 判断 | 算/编/授 | 已确认前高收盘突破 | 已有突破/有限PA/ICT；完整形态库未有
event.direction | Idea Direction、bullish/bearish | 判断 | 算/编/授 | forecast=up | 历史走势方向与预测方向分开
event.stage | emerging/complete/failed/expired | 判断/管理 | 编/授 | forming；尚未突破 | 现有confirmed事件基础；需机会生命周期
event.detected_at | Detection/identified | 来源 | 算/编/授 | 10:00检测，11:00确认 | AC内部found应忽略；检测时间不等于实际可行动时间
event.confirmed_at | 确认时间 | 来源 | 算 | 右侧第3根闭合后确认 | PA/ICT源bar结束仅为确认下界；不证明当时已送达
event.earliest_action | earliest_action、最早可行动时间 | 来源/方法 | 取/编 | bar确认后，数据实际可得且市场可交易 | ABU依赖输入available_at；真实延迟/会话需补，未知不填确认时间
event.age_length | age、length、形态起止 | 事实 | 算/编/授 | 长40根；年龄2根 | 起止时间、长度单位与更新事件独立
event.expiry | expires_at、relevant、失效原因 | 管理/判断 | 编/授 | 16:00到期；未达标 | 需设超时/破坏/替代事件规则
event.history | 事件历史、bullish/bearish计数 | 统计 | 编/源 | 近30日8多5空 | 先固定检测器与去重，再积累事件库
pattern.anchors | 摆动点、A/B/C/D/X、时间价位 | 计算 | 算/编/授 | 高点A=103；确认时刻已记录 | ABU/PA提供拐点；谐波组合另算
pattern.point_count | 图形qty_tp、Fibonacci qtyTP | 计算 | 算/编/授 | 5个形态转折点 | 按端点和路径解释；不当作水平位触碰次数
pattern.boundaries | 支撑/阻力线端点、几何边界 | 计算 | 编/授 | resistance=(t1,103)-(t2,103) | 趋势线拟合/容差需新增；绘图只呈现
pattern.height | 形态高度 | 计算 | 编 | 区间57−47=10 | 明确形态/基底；不能对所有事件套高度法
pattern.ratios | Fibonacci比例与阶梯 | 计算 | 算/编/授 | 回撤0.618；target10=1.2800 | ABU有最近高低点水平；完整ABCD/Gartley需补
pattern.continuation | Continuation/Reversal、trend_change | 判断 | 编/授 | continuation | 以前置趋势和形态定义判定
levels.values | Key Levels、support/resistance | 计算 | 算/编 | 支撑98、阻力103/110 | ABU聚类水平；原厂值需授权
levels.significance | Level Significance、星级/重要性 | 判断 | 编/授 | 强/中/弱；自有规则v1 | 触碰数/距离可算；TC星级精确规则未公开
levels.touches | Key Level qtyTP、触碰时刻 | 计算 | 算/编/授 | 4次确认触碰 | ABU聚类已有；仅水平位路径适用，图形/Fib点数另存
levels.approach | 接近区、approachingTime/Price | 判断 | 编/授 | 距150阻力0.15 | 需定义阈值；接近不等于反转
levels.round | 整数关口与穿越状态 | 判断 | 编/授 | BTC接近100000 | 自有粒度规则；AC专属raw schema待验
quality.overall | Technical Score、quality、averageQuality | 专有/模型 | 授/编 | AC原始quality=0.70 | 自研质量必须另命名；不是70%胜率
quality.components | clarity/uniformity/initial_trend/breakout/volume | 专有 | 授/编 | clarity=0.80；breakout不适用 | 原厂0–1；子项公式未完整公开
quality.fibonacci | ratioQuality、timeQuality | 专有 | 授/编 | ratioQuality=0.84 | 几何拟合；不能转换成交易成功率
anomaly.movement | from/to_price、movement | 计算 | 编/授 | 1.1000→1.1060，60pip | 现有价格输入可算；检测/分位需固定窗口
anomaly.consecutive | qty_candles、连续方向 | 计算 | 编/授 | 连续6根上涨 | doji/平价定义与样本窗明确
anomaly.percentile | 异常百分位、统计基准 | 统计 | 编/源/授 | 历史第98百分位 | ≥95与0.98端点尺度不同；不是反转概率
chart.annotations | Annotated/Reference Chart、drawing | 展示 | 呈/编 | K线+拐点+目标区域 | reports内置candlestick；图元来自真实计算
''')

group('04 观点、情景与执行计划', '''
thesis.summary | thesis.summary、Comment、Market Outlook | 判断 | 编 | 突破前等待确认 | 基于已取证据与方法；不是取数结果
thesis.direction | Strategy、Long/Short/Neutral | 判断 | 编/授 | conditional-long | 条件未成立时不写已触发
thesis.status | thesis.status、Decision、Value Status | 判断 | 编 | watching | 区分观点状态与实际订单状态
scenario.primary | Preferred Scenario、primary_scenario | 判断 | 编/授 | 收盘突破103后观察回踩 | 原厂情景授权；自有规则可组合
scenario.alternative | Alternative Scenario、trigger/action | 判断 | 编/授 | 跌破98后退出原多头观点 | 条件是业务信息，避免无意义免责声明
scenario.entry | Entry Price/reference/zone/condition | 判断 | 编/授 | 103确认；候选入场103–104 | 价格、区域、触发、执行方式分开
scenario.invalidation | Pivot、invalidation_price | 判断 | 编/授 | 98失效 | 技术失效位不等于传统OHLC Pivot点
scenario.stop | Stop Price/stop_loss | 判断/计算 | 算/编 | 计划止损98 | 已有ATR退出；结构止损规则需定
scenario.targets | Target1/2、target_level | 判断/计算 | 编/授 | 110/115 | 来源可为结构/高度/原厂；保存期限
scenario.target_region | 预测价格范围与期限 | 模型 | 编/源/授 | 未来4h目标110–112 | 双侧波动区间另列；概率区间需校准
scenario.expected_action | Expected Price Action、Signal Rationale | 判断 | 编/授 | 趋势延续；先确认再执行 | 含证据与条件，避免仅报“看多”
scenario.reward_risk | reward_risk_at_entry_reference | 计算 | 编 | entry103，stop98，T1=113→2R | (target-entry)/(entry-stop)，费用另计
evidence.supporting | evidence[].type/finding/source/timeframe | 来源/判断 | 取/编 | H1收盘突破；固定数据引用 | 分离原始事实与解释
evidence.conflicts | conflicting_evidence、evidence_conflicts | 判断 | 编 | H1强、D1仍受阻 | 不同周期不必视为数据错误
evidence.independence | 同源/独立证据与共振 | 定义/统计 | 编 | RSI和MACD来自同一价格序列 | 不简单累加或相乘“概率”
monitoring.recheck | monitoring.recheck_on、提醒条件 | 管理/判断 | 呈/编 | 突破103/事件公布后复查 | 由编排/监控实现；报告保存条件
''')

group('05 波动、账户风险与规模', '''
risk.account | equity/balance、currency、margin | 事实 | 取 | 权益10000USD | MT5/QMT；Binance未换汇资产余额不冒充净值
risk.position | side/quantity/averagePrice/PnL | 事实 | 取 | 多头0.2手 | 对应账户source；PnL维持原红绿色义
risk.budget_fraction | max_portfolio_risk_fraction | 决策 | 编 | 0.005，即0.5% | 用户/策略预算；不是供应商默认授权
risk.cash | account_risk、risk_amount | 计算 | 算 | 10000×0.5%=50USD | ABU sizing；金额与比例不同字段
risk.stop_variants | Tight/Medium/Loose、trailing offset | 计算 | 算/编 | ATR×1/2/3（自有示例） | ABU已有ATR退出；三档参数另定，非TC系数
risk.stop_distance | risk_in_pips、ATR stop distance | 计算 | 算/编 | 入场1.1000至1.0950=50pip | 合约单位/币种转换需一致
risk.quantity | lot_size、quantity_estimate | 计算 | 算/编 | 风险100USD、50pip→0.20手 | ABU需point_value/quantity_unit；MT5可算单量盈亏；统一跨币种/任意止损/步长衔接需补
risk.profit_margin_calc | order_calc_profit/margin | 计算 | 算 | 0.2手50pip风险100USD | MT5原生只计算；不等于发单
risk.costs | 点差、佣金、滑点、融资/借券 | 事实/模型 | 取/编/源 | 双边成本8USD | 历史成交部分可取；冲击/未来滑点需模型与样本
risk.event | event_risk、跳空/财报等风险 | 判断 | 取/编/源 | 1小时后就业数据 | 结构化未来日历需补源
risk.expected_ranges | low/high_15/30/60/240/1440 | 模型 | 编/源/授 | H1范围1.0985–1.1015 | 自研需历史分布和回测；不是方向目标
risk.seasonality | 日内/周内波动 | 统计 | 编/源/授 | 纽约开盘时段较活跃 | 时区/DST/交易日历与半年以上样本
risk.relative_volatility | rank/rank_rounded、标的相对波动排序 | 统计 | 编/源/授 | 当前返回集合中排名第3 | 保留排名集合与时刻；不是星期或日内季节性
risk.stress | 压力情景、组合损失/敞口 | 模型 | 编/源 | 跳空2ATR时损失150USD | 同步持仓/相关资产/跨币种风险源
''')

group('06 财务事实、比率与周期', '''
fund.period | 报告期、fiscalYear/period、TTM | 事实/计算 | 取/编 | 2026Q2；TTM由4季相加 | SEC/FMP原始期可取；TTM需处理年度/累计口径
fund.filing | accession、form、filingDate、公告链接 | 事实 | 取 | 10-Q / 原始文档URL | financial-research SEC索引；正文需另读
fund.revenue | 营收、revenue | 事实 | 取 | 1000M USD | SEC/FMP实际返回，币种/财期明确
fund.net_income | 净利润、EPS、稀释股数 | 事实 | 取/源 | 净利100M；EPS2.0 | SEC/FMP；股数概念/稀释口径需映射
fund.balance | 资产/负债/权益/现金/债务 | 事实 | 取 | 资产2000M；权益1000M | SEC/FMP三表原料
fund.cashflow | 经营现金流、资本开支、FCF | 事实/计算 | 取/编 | CFO150M；capex50M；FCF100M | FCF定义明确；原表符号先标准化
fund.market_cap | Market Cap | 计算/事实 | 编/源 | 50M股×100=5000M | 当前源未保证profile市值；点时流通/总股数
fund.pe | P/E、Trailing P/E | 计算 | 编 | price100/EPS5=20 | TTM/forward分开；负EPS不硬填正常倍数
fund.pb | P/B | 计算 | 编 | 市值5000M/权益2500M=2 | 权益归属和价格时间一致
fund.ps | Price/Sales | 计算 | 编 | 市值5000M/营收2500M=2 | TTM和稀释股本口径固定
fund.fcf_yield | 自由现金流收益率 | 计算 | 编 | FCF250M/市值5000M=5% | CFO-capex、企业/股权口径不能混
fund.growth | Revenue/EPS增长 | 计算 | 编 | 营收1000→1100M，+10% | 同比可比期；基数为负另处理
fund.margins | 利润率/现金转化率 | 计算 | 编 | 净利100/营收1000=10% | 研发/一次性项等调整单独版本
fund.roe | ROE、ROA、质量指标 | 计算 | 编 | 净利100/平均权益1000=10% | 平均期初期末权益；不使用期末替代未说明
fund.leverage | 杠杆、偿债能力、利息覆盖 | 计算 | 编 | 净债务/EBITDA=2 | 所需EBITDA/利息实际字段映射
fund.dividend | 股息、Dividend Yield、Payout | 事实/计算 | 源/编 | 年股息2/价格100=2% | 独立股息/公司行为源待补；比率方法可算
fund.revisions | 分析师盈利预测及修正 | 事实/统计 | 源/编 | EPS预期2.0→2.2 | grades不是盈利预期数据
fund.insiders | 内部人交易/持股变动 | 事实 | 取 | 申报买入1000股 | FMP insider事件；不推断内幕动机
fund.peer_rank | Peer Comparison、Sector Ranking | 统计 | 编/源 | 同业40家中第8 | 行业全集+点时比较口径
macro.series | FRED序列值/单位/频率/季调 | 事实 | 取 | 实际GDP、季度、季调年率 | FRED series+observations；不是事件共识日历
macro.vintage | realtime_start/end、修订版本 | 来源 | 取/源 | 当时可见vintage | FRED保守as_of已有；精确发布时间仍需源
macro.cycle | Nowcasting、经济阶段/风格适配 | 模型 | 编/源/授 | 增长放缓、质量风格适配 | 原厂周期模型未全公开；自有方法另标
cot.positions | CFTC各类多空/OI/交易者数 | 事实 | 取 | M-money long10000/short8000 | Disaggregated Futures Only；公布时刻需补
cot.net | 净仓、占OI、历史分位 | 计算 | 编 | 净多2000；占OI10% | 相同合约/周度/历史窗口；不是散户投票
''')

group('07 综合评分、估值与共识', '''
score.quantamental | Quantamental Rating、综合信号 | 专有/模型 | 授/编 | 自有68/100 | 原厂需授权；自有权重/标准化/缺失规则公开
score.factors | Value/Growth/Momentum/Income/Quality | 专有/模型 | 授/编 | 自有82/54/63/43/71 | 现有因子工具可测，不是现成TC评分
score.labels | 六个*Label、评级解释 | 专有/判断 | 授/编 | valuationLabel=very-strong | TC标签存在；阈值未全公开；自有映射另定义
score.technical | Technical Summary、趋势评分 | 专有/模型 | 授/编 | short=bullish；long=neutral | 原厂版本/期限保留，不与五因子硬均分
valuation.fair_value | Fair Value | 模型 | 编/源/授 | 120USD | 自研剩余收益/DCF需假设；TC输出需授权
valuation.gap | Valuation Gap、折价/上行空间 | 计算 | 编 | 现价100对FV120：上行20%，折价16.67% | 分母明确：相对现价 vs 相对公允值
valuation.target | TC Target Price 12M、自有模型目标 | 模型 | 编/源/授 | 12月目标112 | 估值不自动等于12月市场价格模型
valuation.target_return | Target Return、目标上行 | 计算 | 编 | 112/100−1=12% | 目标与参考价各有时刻；是否含股息
valuation.assumptions | 盈利预测、资本成本、增长/终值 | 模型输入 | 编/源 | k=10%；永续g=3% | 自有假设可设，但须标假设并做敏感性
valuation.sensitivity | 牛/基/熊估值区间 | 模型 | 编 | 95/120/145 | 不叫统计置信区间；DCF/剩余收益情景
valuation.update | 更新频率、模型日期 | 来源 | 授/编 | FV月15日；模型目标月更 | 各产品不同；不统一为实时
analyst.grade_events | 评级变动、机构、新旧评级 | 事实 | 取 | Hold→Buy | financial-research FMP grades
analyst.consensus | Analyst Consensus、总体Buy/Hold/Sell | 统计 | 源/编/授 | Buy | 新增共识端点；事件列表不能替代当前持有评级
analyst.counts | Buy/Hold/Sell人数、样本数 | 统计 | 源 | 12/6/2，共20 | 去重机构/分析师、最新日期/覆盖
analyst.targets | mean/high/low target | 统计 | 源/编/授 | 115/145/85 | FMP目标共识端点待接；不是TC模型目标
analyst.dispersion | 目标分歧、修订趋势/期限 | 统计 | 编/源 | 高低差60；期限未提供 | 需要逐条预期或供应商汇总；不默认12月
''')

group('08 经济、公司事件与历史冲击', '''
calendar.identity | event_uid/name/type、country/currency | 事实 | 源/取 | US就业 / USD | FRED有观测；未来结构化事件表缺，网页可补证
calendar.release | Release Time、盘前/盘后、确认状态 | 事实 | 源 | 2026-11-06 13:30Z，confirmed | 日历源/DST；预计日期与正式日期分开
calendar.importance | Importance、事件类别/频率 | 供应商判断 | 源/编/授 | high / monthly | 供应商分档或明确自有规则；不是概率
calendar.values | Actual/Forecast/Previous、单位 | 事实 | 取/源 | 90k/70k/60k | 实际宏观序列部分可取；共识/首发/前值同表缺
calendar.surprise | actual−forecast、above/below/inline | 计算 | 编/源 | +20k，above | 来源齐备才算；等于容差/修订固定
calendar.corporate | earnings/meeting/dividend/split | 事实 | 源 | 财报盘后；拆股2:1 | SEC索引不是完整未来公司日历
calendar.earnings | fiscal quarter、EPS consensus/actual | 事实 | 源/取 | 预期1.20；实际未公布 | 实际报表部分已取；预期与未来时间需新源
calendar.dividend | 除息/登记/支付日、每股金额 | 事实 | 源 | 每股0.50USD；除息11月10日 | 公司行动专用源，避免从报道拼完整全集
calendar.split | 拆股生效日/比例、复权因子 | 事实 | 源 | 2:1 | 要与行情复权统一
impact.window | 5m/15m/30m/1h/4h、trend_length | 定义 | 编/授 | 事件后60分钟 | 固定t0、交易日历/价格基准
impact.move | 价格净变动、方向、pips | 计算 | 编 | 1.1000→1.0970，−30pip | 同一来源事件窗行情
impact.true_range | 事件TR、历史平均TR、ATR-based | 计算/统计 | 算/编 | 前收1.1000、高1.1020、低1.0960，TR60pip | TR基础已有；事件样本匹配与聚合需新增
impact.condition | delta_sign、趋势方向 | 定义/判断 | 编/授 | actual>forecast，价格趋势向下 | 不能把经济数字高低当资产利好利空
impact.sample | sample_size、条件样本/历史窗口 | 统计 | 编/源/授 | 总12；above组8 | 总样本和条件样本分别统计
impact.frequency | 历史涨跌频次、probability | 统计/专有 | 编/源/授 | above组6/8下跌=75% | 条件频次，不是本次实际高于预期概率
impact.distributions | 正常/事件min/p25/median/p75/max/mean/std | 统计 | 编/源/授 | 正常中位12pip；事件30pip | 成对同时间窗样本；n与单位随分布保存
impact.difference | volatility_diff/percent/value | 计算 | 编/授 | (30−12)/12=150% | 标注比较统计量；差值std可为负
impact.money | mean_mov_value、pip_value、换汇时刻 | 计算 | 编/授 | 18pip×每pip10USD=180USD/手 | 合约/账户币种/汇率时刻
impact.history | 历次date/expected/actual/delta/trend | 事实/统计 | 源/编 | 12次首发事件及1h路径 | 必须点时版本，当前修订宏观值不替代
impact.concurrent | 同时事件、样本排除/对照 | 方法 | 编/源 | 同时发布失业率；无法单因果归因 | 事件研究设计，记录混杂因素
''')

group('09 新闻、情绪、关注度与传播', '''
news.article | headline/title、URL、正文/摘要 | 事实 | 取 | 某公司发布新订单 | FMP stock news、web、RSS；摘要非全文
news.source | source_info、来源/类型/作者 | 来源 | 取/编 | 新闻社 / news | 原文归属与转载聚类需补
news.published | publication time、语言、版本 | 来源 | 取 | 2026-10-26T09:00Z | 原始发布时间/采集时间分开
news.entity_topic | 资产实体、topic、event type | 模型 | 编/授 | DEMO / 订单 / 监管 | 需要实体链接/去重/分类规则
news.mentions | News Volume、Buzz Volume、total_mentions | 统计 | 编/源/授 | 24h去重提及320 | 当前有限分页≠全网统计；限定语料范围
news.baseline | 基准量、volume_ratio、Buzz Score | 统计/专有 | 编/源/授 | 320/80=4倍 | 自有量比可算，不能叫TC原厂Buzz公式
news.channels | news/web/social来源占比 | 统计 | 编/源 | news70%、blog20%、social10% | 源全集与同一窗口；社交是否计分按产品
sentiment.score | Sentiment Score、News Sentiment | 模型/专有 | 编/授 | 原厂72/100 | NLP模型/语料/尺度版本须记录
sentiment.signal | Bullish/Bearish/Neutral | 判断 | 编/授 | bullish | 阈值依模型，不自动来自市场收益
sentiment.subjectivity | Subjectivity Score | 专有 | 授/编 | 81/100 | 文本主观性不是新闻真假
sentiment.confidence | Confidence Index、证据量等级 | 专有/统计 | 授/编 | Average | 不同于预测置信区间或上涨概率
sentiment.trend | Sentiment Trend/Monitor/Histogram | 模型 | 编/源/授 | 强弱72，趋势直方图46 | 近期/历史情绪；TC直方图50阈值只属该指标
sentiment.history | 情绪/价格历史、sentiment_change | 统计 | 编/源/授 | 365日序列；70→65 | 缺历史语料/旧分数时不能回填伪历史
sentiment.fear | Fear Index、市场比较 | 专有 | 授/编 | 90交易日历史；原值待取 | TC Fear不等于VIX；未公开阈值不捏造
sentiment.peer | Peer Comparison、sector sentiment | 统计 | 编/源/授 | 同业中位情绪55 | 同一模型、语料时间与行业全集
social.sample | Reddit score/comments/upvote_ratio | 事实 | 取 | 30帖；单帖42评论 | 当前有限社区样本；不代表全市场散户态度
media.asset | 视频/文章标题、语言、时间、URL/稿 | 事实/展示 | 取/呈/源 | 3分钟市场短评及文字稿 | 网页媒体引用；商业媒体全文/分发许可另核
''')

group('10 期权合约、波动率与组合', '''
option.contract | 代码、call/put、strike、expiry、乘数 | 事实 | 源 | DEMO call K100，乘数100 | 当前无结构化期权链；不能从现货推出
option.quote | bid/ask/last、报价时刻、volume/OI | 事实 | 源 | 3.0/3.2；OI1000 | 同步underlying；低流动性报价过滤
option.exercise | 美/欧式、结算、交割与公司行为 | 事实 | 源 | 美式、实物交割 | 决定提前行权和模型，链源需明确
option.iv | IV、Volatility Levels | 模型 | 源/编/授 | 30%年化 | 真实权利金+合约+利率股息+定价模型
option.iv_history | 历史IV、HV比较 | 事实/模型 | 源/编 | 过去252交易日IV | 今日链不能还原历史报价与IV
option.iv_rank | IV Rank、IV Percentile | 统计 | 源/编/授 | IVR75；IV百分位另存 | 100×(IV-min)/(max-min)；max=min未定义；历史窗与可比IV序列固定，百分位另算
option.skew | 上/下行偏斜、期限偏斜 | 模型 | 源/编/授 | 同到期90%put IV35%，110%call IV28% | 执行价偏斜用同到期；期限结构固定delta/moneyness再跨到期
option.surface_cone | IV曲面、期限结构、波动锥 | 模型/统计 | 源/编/授 | strike×expiry矩阵 | 需真实链和历史；插值方法与空洞保留
option.expected_move | 预期波动范围/到期价格区间 | 模型 | 源/编/授 | 30日±8.6%（自有近似） | σ√T需假设；不是原厂区间/确定目标
option.greeks | Delta/Gamma/Vega/Theta/Rho | 模型 | 源/编 | Delta=0.55 | 非本次证实TC必返字段；自有扩展
option.preference | 方向、幅度、目标、风险偏好 | 决策输入 | 呈 | 温和看涨、限定最大损失 | 由需求给出，不从分数推断用户权限
option.strategies | 首选/替代策略、排名理由 | 判断/模型 | 编/源/授 | bull call spread / long call | 需真实可成交价格、事件和成本后比较
option.legs | 每腿方向、类型、执行价、到期、数量 | 计划 | 编/源 | 买100call，卖110call，同到期 | 组合乘数一致、合约标识唯一
option.premium | 净付/净收权利金 | 计算 | 编/源 | debit3/股，合计300 | mid估值与可成交bid/ask分开
option.max_loss | 最大亏损 | 计算 | 编/源 | 300USD | 到期结构的确定性计算；裸卖可能无界
option.max_profit | 最大收益 | 计算 | 编/源 | 700USD | 不等于期望收益
option.breakeven | 到期盈亏平衡 | 计算 | 编/源 | 103USD | 到期前还受IV/时间影响
option.payoff | 到期损益曲线/情景损益 | 计算 | 编/源/呈 | S=108时净收益500USD | 明确到期/估值时点；reports展示
option.pop | Probability of Profit | 模型/专有 | 编/源/授 | P(净损益>0)=0.60（合成概率） | 需分布/风险中性或真实概率区分、成本与验证；不是期望利润
option.expected_profit | Expected Profit、期望利润 | 模型 | 编/源/授 | 0.6×100+0.4×(−200)=−20USD | E[净损益]以金额/收益率表示；高胜率仍可负期望
''')

group('11 筛选、策略、组合与回测', '''
screen.name | Strategy Name/Description/Objective | 定义 | 呈 | 零售价值筛选 | 将目的与实际规则分开
screen.conditions | Filters、逻辑组合 | 定义 | 编 | marketCap≥300M AND P/S≤1 | 当前自有筛选可写；TC任意OR未证实
screen.matches | 匹配数、名单、TopN | 计算 | 编/源 | 18匹配，选10 | 证券全集与缺失排除可追溯
screen.rank | rank、score、排序/并列规则 | 模型 | 编 | 归一化因子均值排序 | factor-evaluator可测因子；非现成选股器
portfolio.constituents | 当前/新增/移除成分及权重 | 事实/计算 | 取/编/源 | 10股等权；两只替换 | 实际持仓与模拟组合分开；指数方案可复用
portfolio.rebalance | 换仓频率/日期、权重约束 | 定义 | 编 | 每13周换仓（TC筛选示例） | TC指数月调50股与筛选回测不同
portfolio.exposure | 行业/资产/币种/相关性敞口 | 计算 | 编/源 | 科技40%、USD80% | 真实持仓+资产主数据+汇率/相关历史
backtest.window | Start/End、训练/验证/留出区间 | 定义 | 算/编 | 2021–2025训练，2026留出 | evaluator固定计划；样本可得时间需成立
backtest.equity | Equity Curve、Historical Performance | 计算 | 算 | 初值1，5年终值1.8 | 回测引擎输出；清楚现金/保证金模型
backtest.return | Total Return、CAGR | 计算 | 算 | 1.8^(1/5)−1=12.47% | ABU trade-metrics；实际期限不是行数
backtest.benchmark | Benchmark、超额收益 | 计算 | 算/编/源 | 基准CAGR9.86%，差2.61pp | 收益差不称风险调整alpha
backtest.drawdown | Max Drawdown、回撤路径 | 计算 | 算 | 最大回撤−15% | ABU metrics/evaluator；值域与符号明确
backtest.sharpe | Sharpe、波动风险 | 统计 | 算 | Sharpe0.9 | 频率、无风险率和自相关假设
backtest.trades | 成交/交易数、win rate、profit factor | 统计 | 算 | 100笔、55盈利；PF1.3 | 必须真实模拟成交日志；因子IC不替代
backtest.costs | 费用、滑点、换手与融资 | 模型/统计 | 算/编/源 | 毛收益12%，成本2%，净10% | 引擎实际设定与数据；缺成本不默认完备
backtest.assumptions | 成交价/停牌/退市/股息/复权 | 方法 | 编/源 | 次根开盘成交；股息再投 | 点时全集/公司行为源是关键
backtest.attribution | 逐策略/因子/资产收益贡献 | 计算 | 算/编 | 趋势+6%，均值回归−1% | ABU有策略归因；因子归因需额外模型
backtest.update | 报告更新、Daily/Weekly/Monthly alerts | 管理 | 呈/编 | 每周五更新 | 调度通知与投资指标分开
idea.card | Headline/Idea Details、候选机会 | 判断/展示 | 编/呈/授 | H1三角突破候选 | 组合事件+理由+时间；未触发不叫已下单
idea.watch_trade | Watchlist Status、Trade Action/URL | 管理/展示 | 呈/编 | 加入观察；打开交易计划 | UI操作入口不视作已成交或交易授权
''')

group('12 统计验证、概率与结果跟踪', '''
stats.sample | total/correct、样本/分组/起止 | 统计 | 算/编/源/授 | 200事件、140达标 | evaluator能评诊断；形态事件库需另建
stats.hit_rate | percentage、历史目标触及率 | 统计 | 编/源/授 | 140/200=70% | 不含止损先后/成本则不叫盈利率
stats.favorites | percent、hod/symbol/pattern分组统计 | 专有 | 授/编 | percent=68.5；分组各有n | AC总值组合未公开；自研不反推等价
stats.correlating | Correlating Alerts percent_probability | 专有 | 授/编 | 同向聚合原厂值72% | 与Favorites分开；完整共振算法未公开，不用两个概率相乘
stats.confidence_interval | bootstrap/Wilson区间 | 统计 | 算/编 | 140/200的Wilson95%约63.3–75.9% | evaluator有bootstrap；比例Wilson需新增
factor.ic | IC、rank IC、coverage、net return | 统计 | 算 | time-series IC0.04 | factor-evaluator/CLI；单资产可做时序
factor.redundancy | 因子相关/冗余、选择回执 | 统计 | 算 | 训练集相关0.92，保留一项 | train-only筛选；不能用留出集调阈值
validation.placebo | 安慰剂测试 | 统计 | 算 | 打乱标签对照 | evaluator已有；检验何种null需明确
validation.monte_carlo | 蒙特卡洛模拟 | 统计 | 算 | 经验分块重采样诊断收益路径 | 当前不是交易执行顺序仿真；其他生成机制需另实现
validation.out_of_sample | 样本外测试 | 统计 | 算 | 冻结后评未参与选择的数据 | holdout需真正未使用
validation.walk_forward | 滚动前推测试 | 统计 | 算 | 固定候选在前推窗评估，阈值来自训练期 | 当前不等于每窗重新训练/选参；不能全样本先选参再伪前推
validation.sensitivity | 参数敏感性 | 统计 | 算 | 窗口10/15/20 | 关注稳定区间，避免只报最好点
validation.regimes | 市场状态分层 | 统计 | 算/源 | 高波动/低波动分别评估 | regime标签必须点时可得
validation.bootstrap | bootstrap置信区间 | 统计 | 算 | 分块重采样收益均值区间 | 样本依赖决定重采样单元
forecast.probability | 事前概率、基准概率 | 模型/判断 | 编/呈 | P=0.65；base=0.5 | 概率由研究方法产生；judgment登记而不估计事前概率
outcome.definition | outcome、期限、标量/路径判据 | 定义 | 呈/编 | 4h内先触110还是98 | 当前judgment只核验窗口内最新标量；路径需补
outcome.realized | 实际结果、MAE/MFE、达标/到期 | 统计 | 算/编/源 | 先止损；随后才达目标 | 回测路径层生成；同bar双触需更细数据/明确规则
outcome.calibration | Brier、baseline_Brier、confidence_calibration | 统计 | 算/编 | n=100，Brier0.22 | judgment有Brier/5档校准；不能声称已有成熟历史库
outcome.attribution | 原因归因、模型/数据/执行差异 | 判断/统计 | 编 | 方向对，成本后亏损 | 固定原判断，不能事后改目标与期限
''')

group('13 叙述、展示与交付', '''
report.modules | 一个或多个报告模块、sections | 管理 | 呈/编 | 技术情景+事件影响+风险 | 需新增业务recipe；复用reports outline
report.summary | 简明结论、Market Commentary/Wrap | 判断/展示 | 编/呈 | 先说机会与触发条件 | 主agent综合固定研究结果
report.story | FIBI各Story、自然语言解释 | 展示/判断 | 编/授 | 技术/基本面/新闻故事 | 自有agent可综合；TC FIBI需授权
report.charts | 图表/Reference Chart/Payoff等 | 展示 | 呈 | candlestick / decision-tree / boxplot | reports已有26种图型；图表不创造数据
report.details | Research Detail、关联报告/组合上下文 | 管理 | 呈 | 引用估值报告与实际持仓 | ArtifactRef去重；避免相同报告重复出现
report.risk_text | 原稿Risk Disclosure/风险披露 | 文案 | 呈 | 仅保留影响决策的具体事件风险 | 供应商必要署名/许可文本按合同；不默认生成空泛章节
report.publish | 生成/发布版本、文件路径、状态 | 管理 | 呈 | 单文件HTML；固定revision | reports publish/check，报告存在才可引用
report.export | PDF/PNG导出与状态 | 管理 | 呈 | 导出成功短提示 | 已有export检查；本研究交付HTML/MD/CSV
report.delivery | channel/language/frequency/session | 管理 | 呈/编 | EU早报 / zh / daily | 邮件、视频、Portal是交付形式，不新增信号
''')

SOURCES = {
'T01': ('TC Technical Views 官方FAQ', 'https://investor.tradingcentral.com/technical-views'),
'T02': ('TC Technical Insight 官方FAQ', 'https://investor.tradingcentral.com/technical-insight'),
'T03': ('TC 历史技术分析方法PDF', 'https://global.tradingcentral.com/www/pdf/methodology_web_sites_en.pdf'),
'T04': ('TC Alpha Generation 教程', 'https://investor.tradingcentral.com/tutorials/getting-started-with-alpha-generation-8b775'),
'T05': ('TC 2026 Technical Views Storyteller', 'https://www.tradingcentral.com/blog/new-in-technical-views-smarter-trading-strategies-with-storyteller'),
'T06': ('TC Fundamental Insight 教程', 'https://investor.tradingcentral.com/tutorials/getting-started-with-fundamental-insight'),
'T07': ('TC Fundamental Insight 发布记录与FAQ', 'https://employee.tradingcentral.com/resources/fundamental-insight'),
'T08': ('TC Fair Value 剩余收益模型', 'https://www.tradingcentral.com/blog/tc-fair-value-available-by-trading-central'),
'T09': ('TC 分析师共识', 'https://www.tradingcentral.com/blog/analyst-consensus-rating-target-price'),
'T10': ('TC Economic Insight 教程', 'https://investor.tradingcentral.com/tutorials/getting-started-with-economic-insight'),
'T11': ('TC Economic Insight / FIBI 发布记录', 'https://employee.tradingcentral.com/resources/economic-insight'),
'T12': ('TC 公司事件日历', 'https://www.tradingcentral.com/tc-products/tc-corporate-calendar'),
'T13': ('TC Market Buzz 教程', 'https://investor.tradingcentral.com/tutorials/getting-started-with-market-buzz'),
'T14': ('TC Market Buzz 当前FAQ', 'https://employee.tradingcentral.com/resources/market-buzz'),
'T15': ('TC 情绪分析教程', 'https://investor.tradingcentral.com/tutorials/premium-sentiment-analysis-3ff89'),
'T16': ('TC 2026 Sentiment Monitor', 'https://www.tradingcentral.com/blog/stay-ahead-of-market-moving-sentiment-trends-with-sentiment-monitor'),
'T17': ('TC Fear Index', 'https://www.tradingcentral.com/blog/when-emotion-moves-markets-keep-your-investors-ahead-with-tc-fear-index'),
'T18': ('TC Options Insight 教程', 'https://investor.tradingcentral.com/tutorials/getting-started-with-options-insight'),
'T19': ('TC 波动率、偏斜与市场危机', 'https://www.tradingcentral.com/blog/how-to-manage-market-crisis-using-options'),
'T20': ('TC Strategy Builder 方法FAQ', 'https://employee.tradingcentral.com/resources/strategy-builder'),
'T21': ('TC Strategy Builder 产品', 'https://www.tradingcentral.com/tc-products/tc-strategy-builder'),
'T22': ('TC Panoramic View', 'https://www.tradingcentral.com/blog/trading-central-releases-summary-scores-in-panoramic-view'),
'T23': ('TC Newsletter 教程', 'https://investor.tradingcentral.com/tutorials/getting-started-with-tc-newsletters-47de0'),
'T24': ('TC Videos', 'https://www.tradingcentral.com/tc-products/tc-videos'),
'T25': ('TC Quant Indices 方法', 'https://www.tradingcentral.com/financial-products/methodology'),
'T26': ('TC MCP 官方入口', 'https://www.tradingcentral.com/solutions/mcp'),
'T27': ('TC Labs 2025 情绪研究论文', 'https://aclanthology.org/2025.jeptalnrecital-industrielle.2/'),
'T28': ('TC 2024 已使用0–100的官方实例', 'https://www.tradingcentral.com/blog/techs-quantum-leap-unearthing-u-s-tech-stocks-set-for-explosive-growth'),
'T29': ('TC Featured Ideas', 'https://www.tradingcentral.com/tc-products/tc-featured-ideas'),
'A01': ('Autochartist 开发者与API目录', 'https://www.autochartist.com/developer-apis/'),
'A02': ('Autochartist Technical Analysis API', 'https://www.autochartist.com/ac_api_docs/Technical_Analysis_API.html'),
'A03': ('Autochartist Market Scanner', 'https://www.autochartist.com/products/market-scanner/'),
'A04': ('Autochartist 形态质量说明', 'https://tradersupport.autochartist.com/en/knowledgebase/article/pattern-results-details'),
'A05': ('Autochartist 水平关键位', 'https://tradersupport.autochartist.com/en/knowledgebase/article/horizontal-support-resistance-levels'),
'A06': ('Autochartist Performance Stats API', 'https://www.autochartist.com/ac_api_docs/Performance_Stats_API.html'),
'A07': ('Autochartist Volatility API', 'https://www.autochartist.com/ac_api_docs/Volatility_Analysis_API.html'),
'A08': ('Autochartist 波动率方法', 'https://tradersupport.autochartist.com/en/knowledgebase/article/volatility-analysis'),
'A09': ('Autochartist Risk Calculator API', 'https://www.autochartist.com/ac_api_docs/Risk_Calculator_API.html'),
'A10': ('Autochartist Economic Event Forecast API', 'https://www.autochartist.com/ac_api_docs/Economic_Event_Forecast_API.html'),
'A11': ('Autochartist Economic Event Volatility API', 'https://www.autochartist.com/ac_api_docs/Economic_Event_Volatility_API.html'),
'A12': ('Autochartist EEVI', 'https://www.autochartist.com/economic-event-volatility-intelligence/'),
'A13': ('Autochartist Market Alerts API', 'https://www.autochartist.com/ac_api_docs/Market_Alerts_API.html'),
'A14': ('Autochartist 连续蜡烛方法', 'https://tradersupport.autochartist.com/en/knowledgebase/article/consecutive-bullbear-candles'),
'A15': ('Autochartist 统计异常分析', 'https://www.autochartist.com/statistical-analysis/'),
'A16': ('Autochartist News Sentiment API', 'https://www.autochartist.com/ac_api_docs/News_Sentiment_API.html'),
'A17': ('Autochartist Our Favorites API', 'https://www.autochartist.com/ac_api_docs/Our_Favorites_API.html'),
'A18': ('Autochartist Correlating Alerts API', 'https://www.autochartist.com/ac_api_docs/Correlating_Alerts_API.html'),
'A19': ('Autochartist Market Snapshot API', 'https://www.autochartist.com/ac_api_docs/Market_Snapshot_API.html'),
'A20': ('Autochartist Market Report', 'https://www.autochartist.com/products/messaging-and-alerts/market-report/'),
'A21': ('Autochartist ContentCast', 'https://www.autochartist.com/contentcast/'),
}

def table(headers, rows):
    def cell(v): return str(v).replace('|', '\\|').replace('\n', '<br>')
    return '\n'.join(['| ' + ' | '.join(headers) + ' |', '| ' + ' | '.join(['---'] * len(headers)) + ' |'] + ['| ' + ' | '.join(cell(v) for v in row) + ' |' for row in rows])

def main():
    body = (OUT / 'research-catalog-body-20261026.md').read_text(encoding='utf-8')
    body = body.replace('{{FIELD_COUNT}}', str(len(FIELDS)))
    body += '\n\n## 附录 A：统一业务字段字典\n\n'
    body += '这张字典是 **Sesame 建议业务模型**，并非 TC 或 Autochartist 的完整授权接口。原稿字段的同义词合并为一项，数组与结构化对象按业务单元归类；原厂机器字段另见附录 B。示例均为合成。每行的获取路线说明当前实现及补建工作。\n\n'
    body += '**状态**：取＝当前代码可有条件获取；算＝已有确定性实现；编＝需补可复现、带版本的计算或判断方法；源＝还缺结构化来源、覆盖或历史；授＝若要原厂专有值需授权接入；呈＝组织、状态或展示能力。多状态表示同一字段在不同来源/部分子项上的差异，不统计为一个笼统“支持率”。\n\n'
    for cat in dict.fromkeys(f['category'] for f in FIELDS):
        body += '\n### '+cat+'\n\n'
        body += table(['规范键 / 字段','性质 / 当前状态','合成示例','获取、推导与缺口'], [(f"`{f['key']}`<br>{f['label']}", f"{f['nature']}<br>**{f['status']}**", f['example'], f['route']) for f in FIELDS if f['category']==cat])+'\n'

    # Keep every discovered machine-field group with endpoint context. These are documentation facts,
    # not a generated or production-tested client schema.
    ac = (OUT / 'Autochartist-官方核对-20261026.md').read_text(encoding='utf-8')
    rawpart = ac.split('## 4. 实际字段名称清单（可供字段词典使用）')[1].split('## 5.')[0]
    rawrows=[]
    for l in rawpart.splitlines():
        if l.startswith('|') and not re.match(r'^\|\s*[-:]|^\| 来源/层级',l):
            cells=[x.strip() for x in l.strip('|').split('|')]
            if len(cells)==2: rawrows.append(cells)
    maps=[
      ('传输与分页元数据','source.refs/source.status；不进投资正文'),
      ('身份、事件、生命周期、文本、来源','event.*、scenario.*、time.*、instrument.*'),
      ('入场、止损、目标与期限','scenario.entry/stop/targets、scope.horizon'),
      ('身份、周期、事件状态','instrument.*、event.*、scope.*'),
      ('几何、质量、目标','pattern.*、quality.*、scenario.target_region'),
      ('Fibonacci几何、质量、内部参数','pattern.ratios/anchors、quality.fibonacci；内部参数保留原文'),
      ('水平位、触碰、接近与目标','levels.*、scenario.target_region'),
      ('已发生异常与历史稀有度','anomaly.*；历史方向与预测方向拆开'),
      ('图元与显示约定','chart.annotations；不另计为分析信号'),
      ('历史达标统计','stats.sample/hit_rate'),
      ('历史分组筛选与组合值','stats.favorites；不同边际样本不合并'),
      ('波动区间、相对排序、时段与来源','risk.expected_ranges/relative_volatility/seasonality、time.*'),
      ('合约、风险输入与规模','instrument.contract、risk.*'),
      ('事件身份、类别与发布','calendar.*'),
      ('条件方向、样本、幅度与单位','impact.*'),
      ('条件枚举与历史事件','impact.condition/history；id值不误作顶层字段'),
      ('事件/正常分布与差异','impact.distributions/difference/money'),
      ('同向结果聚合与叙述','evidence.independence、stats.correlating、report.story'),
      ('新闻计数、情绪与变化','news.*、sentiment.*'),
      ('报告身份、交易时段与模块','report.*、time.*'),
      ('单标的技术快照','event.*、levels.*、indicator.*、report.story'),
      ('鉴权、查询与筛选参数','安全配置/请求元数据；不进研究正文，不保存密钥到报告'),
    ]
    assert len(rawrows)==len(maps),(len(rawrows),len(maps))
    body += '\n## 附录 B：Autochartist 已公开机器字段的完整分组归类\n\n'
    body += '以下完整保留本次官方文档核对中出现的字段组，补上归类与业务映射。`priceA/B/...`、`x0…x9` 等缩写需在真正接入时展开；同名 `value`、`direction`、`percent` 必须连同端点与 JSON 路径识别。这里包括传输字段，**不应把所有字段都塞入报告正文**。生产空值、枚举、许可及样例冲突仍待授权样本验证。[开发者目录][A01]\n\n'
    body += table(['原始来源/层级','文档出现的字段','归类 → 业务映射'], [(r[0],r[1],m[0]+' → '+m[1]) for r,m in zip(rawrows,maps)])+'\n'
    body += '\n字段依据：'+'、'.join(f'[{SOURCES[k][0]}][{k}]' for k in ['A02','A06','A07','A09','A10','A11','A13','A16','A17','A18','A19'])+'。\n'
    body += '\n## 附录 C：原稿 JSON 与专有标签映射\n\n'
    body += table(['原稿字段','归类/本研究业务键'],[
      ('report_type / provider / instrument / market / as_of / horizon','report.kind / report.provider / instrument.id / instrument.market / time.as_of / scope.horizon'),
      ('market_state.trend / volatility_regime / liquidity','market.trend / market.volatility_regime / market.liquidity'),
      ('thesis.direction / summary / status','thesis同名字段'),
      ('primary_scenario.entry_condition / entry_reference / targets / invalidation_price','scenario.entry / scenario.targets / scenario.invalidation'),
      ('alternative_scenario.trigger / direction / action','scenario.alternative；触发条件与动作保留为结构'),
      ('evidence[].type / finding / source / timeframe','evidence.supporting + scope.bar_size + source.refs'),
      ('conflicting_evidence[].type / finding；evidence_conflicts','evidence.conflicts'),
      ('risk.max_portfolio_risk_fraction / reward_risk_at_entry_reference / event_risk','risk.budget_fraction / scenario.reward_risk / risk.event'),
      ('monitoring.recheck_on[]','monitoring.recheck'),
      ('data_as_of / source_refs / model_version / confidence_calibration / outcome','time.as_of / source.refs / source.version / outcome.calibration / outcome.definition + realized'),
      ('growthLabel / incomeLabel / momentumLabel / qualityLabel / valuationLabel / quantamentalLabel','score.labels；各保留id/name与供应商尺度版本，不能自行推阈值'),
      ('Instrument IDs / Countries / get_storyteller_economics','instrument.id / calendar.identity；工具名与API路径是接口元数据，不是报告指标'),
    ])+'\n'
    body += '\n## 来源与审计范围\n\n核对日期：2026-10-26。外部事实以官方产品、教程、公开 API 文档、发布记录及论文为依据；自有设计与合成示例已单独标明。Sesame审计基于插件仓库 `7f5c7a8`、宿主仓库 `1bd1d26` 的源码，没有读取账户配置、调用付费行情/交易或测试授权供应商接口。\n\n'
    body += '详细核对记录：\n\n- [Sesame源码与70处证据](Sesame-研究字段能力核对-20261026.md)\n- [Autochartist逐模块/API核对](Autochartist-官方核对-20261026.md)\n- [Trading Central非技术领域与历史实例核对](Trading-Central-非技术领域核对-20261026.md)\n\n'
    for key,(title,url) in SOURCES.items(): body += f'[{key}]: {url} "{title}"\n'
    # Reject undefined source references, duplicate keys, and unresolved template markers.
    keys=[f['key'] for f in FIELDS]
    assert len(keys)==len(set(keys))
    assert not re.search(r'\{\{[A-Z_]+\}\}',body)
    refs=set(re.findall(r'\]\[([TA]\d+)\]',body))
    assert not refs-set(SOURCES), refs-set(SOURCES)
    mdpath=OUT/(BASE+'.md'); mdpath.write_text(body,encoding='utf-8')
    csvpath=OUT/(BASE+'-字段字典.csv')
    with csvpath.open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.writer(f);w.writerow(['分类','规范字段','字段与别名','性质','当前状态','合成示例','获取/推导/缺口'])
        for x in FIELDS:w.writerow([x[k] for k in ['category','key','label','nature','status','example','route']])
    (OUT/(BASE+'-字段字典.json')).write_text(json.dumps(FIELDS,ensure_ascii=False,indent=2),encoding='utf-8')
    content=markdown.markdown(body,extensions=['tables','fenced_code','toc','attr_list'],extension_configs={'toc':{'toc_depth':'2-3'}})
    soup=BeautifulSoup(content,'html.parser')
    for tb in list(soup.find_all('table')):
        wrap=soup.new_tag('div');wrap['class']='report-table';tb.wrap(wrap)
    title=soup.find('h1'); title.extract() if title else None
    css=(REPO/'plugins/api-v1/packages/reports/assets/editorial.css').read_text(encoding='utf-8')
    template=(REPO/'plugins/api-v1/packages/reports/templates/document.html').read_text(encoding='utf-8')
    extra='''
.report { max-width:1200px; } .report-header h1{max-width:32ch;} article h3{margin-top:32px;color:var(--report-default-accent);font-size:18px} article p{max-width:92ch} article code{overflow-wrap:anywhere;font-size:.86em} .report-table{overflow:auto} table{min-width:640px} td{vertical-align:top;max-width:38rem;overflow-wrap:anywhere} th{white-space:normal} .toc{margin:24px 0 40px;columns:2;column-gap:48px;font-size:14px}.toc ul{margin:0;padding-left:18px}.toc>ul>li{break-inside:avoid;margin-bottom:10px}.toc ul ul{display:none} .catalog-search{display:block;margin:28px 0 12px;max-width:100%;width:440px;padding:10px 12px;border:1px solid var(--report-default-border);border-radius:8px;background:transparent;color:inherit;font:inherit}.catalog-count{font-size:12px;color:var(--report-default-muted)} .dict-group[hidden],tr[hidden]{display:none!important} pre{overflow:auto;max-width:100%;padding:16px;background:var(--report-default-accent-soft);border-radius:8px} @media(max-width:700px){.toc{columns:1}.report{padding:28px 18px}table{min-width:600px}h1{font-size:28px}}@media print{.toc{columns:2}.catalog-search,.catalog-count{display:none}table{min-width:0;font-size:9pt}.report-table{overflow:visible}a{overflow-wrap:anywhere}h2,h3{break-after:avoid}tr{break-inside:avoid}.report{max-width:none}}
'''
    doc=template.replace('{{LOCALE}}','zh-CN').replace('{{TITLE}}','研究报告体系：Trading Central、Autochartist 与 Sesame').replace('{{STYLES}}',css+extra).replace('{{BODY}}',str(soup))
    # Add a search control only to the exhaustive field appendix; each group remains readable offline.
    soup=BeautifulSoup(doc,'html.parser')
    heads=soup.find_all('h2'); annex=next(x for x in heads if x.get_text().startswith('附录 A'))
    inp=soup.new_tag('input',type='search',placeholder='搜索字段、示例或插件…');inp['class']='catalog-search';inp['aria-label']='搜索业务字段字典';inp['id']='field-search';annex.insert_after(inp)
    note=soup.new_tag('p');note['class']='catalog-count';note['id']='field-count';note.string=f'{len(FIELDS)} 个业务字段组';inp.insert_after(note)
    nxt=note.next_sibling
    while nxt and not (getattr(nxt,'name',None)=='h2'):
        if getattr(nxt,'name',None)=='div' and 'report-table' in nxt.get('class',[]):nxt['data-field-table']='true'
        nxt=nxt.next_sibling
    js=soup.new_tag('script');js.string='''
const search=document.getElementById('field-search');const rows=[...document.querySelectorAll('[data-field-table] tbody tr')];function filterFields(){const q=search.value.trim().toLowerCase();let n=0;for(const row of rows){row.hidden=q!==''&&!row.textContent.toLowerCase().includes(q);if(!row.hidden)n++;}document.getElementById('field-count').textContent=n+' / '+rows.length+' 个业务字段组';}search.addEventListener('input',filterFields);filterFields();
''';soup.body.append(js)
    htmlpath=OUT/(BASE+'.html');htmlpath.write_text(str(soup),encoding='utf-8')
    assert len(soup.select('[data-field-table] tbody tr'))==len(FIELDS)
    # Independent arithmetic checks used in the synthetic examples.
    assert round((1.8**.2-1)*100,2)==12.47
    assert (110-100-3)*100==700 and 3*100==300
    assert abs((30-12)/12-1.5)<1e-12
    audit={'field_groups':len(FIELDS),'categories':len(set(x['category'] for x in FIELDS)),
           'raw_api_groups':len(rawrows),'cited_sources':len(refs),'html_tables':len(soup.find_all('table')),
           'statuses':dict(Counter(s for f in FIELDS for s in f['status'].split('/'))),
           'files':[{ 'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [mdpath,htmlpath,csvpath]]}
    (OUT/(BASE+'-核验.json')).write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(audit,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
