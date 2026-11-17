import { readFileSync } from 'node:fs';

export const COMPONENT_PROTOCOL = 'sesame-components/1';
const clone = value => structuredClone(value);
const readJSON = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

// The existing publication contract is authoritative. Do not read schemas from
// components_*: those capabilities themselves consume this catalog.
const publicationSchema = readJSON('capabilities.json').capabilities.find(item => item.id === 'report_render').inputSchema.properties.input;
const documentDefinition = publicationSchema.properties.content;
const blockDefinitions = publicationSchema.$defs.block.oneOf;
const blockDefinition = type => blockDefinitions.find(item => item.properties.type.const === type);
const standalone = schema => ({ ...clone(schema), ...(JSON.stringify(schema).includes('#/$defs/') ? { $defs: clone(publicationSchema.$defs) } : {}) });
export const documentSchema = freeze(standalone(documentDefinition));

const blocksPlacement = ['content.sections[].blocks[]', 'block.group.blocks[]', 'block.details.blocks[]'];
const chartPlacement = blocksPlacement;
const categories = [
  ['trend', '趋势与有序变化'], ['comparison', '比较与差距'], ['distribution', '分布与统计'],
  ['composition', '总量与构成'], ['relationship', '结构与关系'], ['temporal', '日期与事件'],
  ['multivariate', '多维比较'], ['content', '文字与证据'], ['layout', '布局与组合'],
].map(([id, label]) => ({ id, label }));

// Purpose descriptions describe the encoding and data relationship, rather than
// restricting general charts to the domain of a particular demonstration.
const chartMetadata = {
  line: ['折线图', 'trend', '观察时间、距离或其他有序维度上的变化趋势，并比较多条序列的转折与差异。', 'line trend ordered time series change'],
  area: ['面积图', 'trend', '用填充面积突出有序序列的规模及其变化，适合关注总量走势而非单点差值。', 'area magnitude trend volume'],
  bar: ['柱形图', 'comparison', '在共同零基线上比较少量类别的数值大小，清楚呈现类别之间的差距。', 'bar categorical comparison magnitude'],
  hbar: ['横条图', 'comparison', '比较名称较长或项目较多的类别数值，便于顺着标签阅读大小与排名。', 'horizontal bar ranking long labels'],
  scatter: ['散点图', 'relationship', '观察两个连续变量之间的关系、聚集与离群点，每个点保留一条观测。', 'scatter correlation relationship outliers continuous'],
  heatmap: ['热力图', 'comparison', '以色阶快速寻找两个维度交叉后的高低值区域与整体模式。', 'heatmap cross tab intensity pattern'],
  matrix: ['数值矩阵', 'comparison', '逐格核对两个类别维度的数值与缺失，适合需要直接读数的小型完整网格。', 'matrix cell values missing grid'],
  units: ['单位点阵', 'composition', '把非负数量拆成具有明确单位的点，直观比较可计数规模与组成。', 'units pictogram count quantity'],
  waterfall: ['瀑布图', 'composition', '解释一个起点经过逐项增加和减少如何到达终点，并核对中间累计值。', 'waterfall reconciliation changes balance'],
  dumbbell: ['哑铃图', 'comparison', '比较各对象两个状态或两次观测之间的差距，同时保留两个端点的实际位置。', 'dumbbell two states gap before after'],
  strip: ['观测点图', 'distribution', '逐点展示原始观测的集中、离散和异常，适合小样本或需要保留个体记录的比较。', 'strip raw observations distribution individual'],
  histogram: ['直方图', 'distribution', '用已计算的连续分箱展示频数或密度，识别集中区间、偏态与尾部。', 'histogram frequency density bins distribution'],
  boxplot: ['箱线图', 'distribution', '紧凑比较多组分布的中心位置、离散程度和异常值，适合组数较多的统计概览。', 'boxplot quartiles distribution center spread outliers'],
  ridgeline: ['山脊图', 'distribution', '在共同尺度上排列多组已有密度曲线，比较峰的位置、形状与分布迁移。', 'ridgeline density distribution peaks groups'],
  violin: ['小提琴图', 'distribution', '用对称宽度呈现各组已有密度，比较偏态、多峰和尾部等分布形状。', 'violin density shape multimodal distribution'],
  calendar: ['日历图', 'temporal', '沿真实日历检查逐日数值、周期性和日期聚集，并区分零值、关闭与缺失。', 'calendar daily seasonality missing dates'],
  parallel: ['平行坐标', 'multivariate', '同时比较对象的多个不同量纲，并通过各维范围过滤观察权衡与共同特征。', 'parallel coordinates multivariate tradeoffs filter'],
  bump: ['排名轨迹', 'trend', '追踪固定比较集合中已给定的名次随时间如何升降、交叉或并列。', 'bump rank trajectory ties ranking change'],
  lifecycle: ['事件时间线', 'temporal', '按真实时间呈现多个对象已记录的状态事件，保留事件身份及其证据链接。', 'lifecycle timeline event state evidence'],
  treemap: ['矩形树图', 'composition', '以嵌套面积展示非负总量的层级构成，快速定位各层级中的主要部分。', 'treemap hierarchy part whole nested area'],
  threads: ['三阶段链路', 'relationship', '追踪记录在三个阶段之间的实际对应关系，揭示一对多关联与明确缺口。', 'threads three stages trace links records'],
  flow: ['流向图', 'relationship', '展示同一批次的数量从来源经过中转流向去处，并核对各中转节点的守恒。', 'flow sankey conserved source target allocation'],
  'network-circular': ['环形关系网', 'relationship', '把固定节点排列在圆周上比较已有连接、方向、权重与正负关系，便于逐节点核对。', 'circular network graph edges relationships'],
  'network-force': ['力导向关系网', 'relationship', '探索已有连接形成的群组与桥接节点，适合结构尚不直观的关系网络。', 'force network graph cluster bridge relationships'],
  'decision-tree': ['条件决策树', 'relationship', '把逐层判断条件组织成分支树，清楚解释每条路径如何到达结果或行动。', 'decision tree conditions branches outcomes'],
  candlestick: ['开高低收图', 'trend', '比较各时期的开高低收与方向变化；可叠加已有同单位价格列或给定参考价，让关键位置与走势在同图可见。', 'candlestick ohlc open high low close range overlays threshold reference price 参考价 关口'],
  stream: ['构成流带图', 'composition', '观察同一总量各部分随有序维度变化的规模与占比，突出构成的扩张、收缩和替换。', 'stream composition stacked temporal change'],
  'stacked-rungs': ['堆叠刻度柱', 'composition', '比较多个对象可相加的非负构成，同时让每一格对应明确的实际数量。', 'stacked rungs composition discrete units'],
  'dot-heatmap': ['气泡矩阵', 'comparison', '在两个类别交叉的完整网格中以圆面积比较数值大小，并明确区分零值与缺失。', 'dot heatmap bubble matrix magnitude'],
  funnel: ['递减漏斗', 'composition', '展示依次筛选或转化后留下的真实数量，定位各阶段的留存与流失。', 'funnel sequential conversion retention attrition'],
  'category-links': ['名单归属图', 'relationship', '把逐个对象连接到其唯一类别，同时查看对象归属和各类包含的数量。', 'category links membership classification items'],
  'outcome-tally': ['结果次数刻度', 'comparison', '对照各结果的实际发生次数与有效样本总数，并明确结果之间是否重叠。', 'outcome tally counts sample denominator overlap'],
  'paired-rungs': ['成对刻度柱', 'comparison', '在共同零点与单位刻度上比较两个状态的数量，突出各对象的绝对规模及增减。', 'paired rungs before after counts comparison'],
  'rank-race': ['动态排名条形图', 'trend', '逐期查看固定对象集合的数值和排序变化，同时保留全时期统一的长度尺度。', 'rank race animated ranking value time'],
  spectrum: ['多维位置图', 'multivariate', '把一个关注对象与对照对象放在两端含义明确的多个尺度上，突出各维所处的位置。', 'spectrum bounded scales focus multivariate positions'],
  'tick-donut': ['刻度圆环', 'composition', '用明确数量单位组成完整圆环，展示互斥且可相加的各部分与总数。', 'tick donut part whole mutually exclusive units'],
  barcode: ['密集观测图', 'trend', '压缩展示较长有序序列的逐点数值与波动，并标出事先选定的观察位置。', 'barcode dense observations ordered spikes'],
  'bubble-ledger': ['年度气泡表', 'temporal', '同时比较多个类别跨年份的数值规模与缺口，并区分资料完整和部分覆盖的观测。', 'bubble ledger years categories coverage missing'],
};

const string = { type: 'string', minLength: 1, maxLength: 20000 };
const field = (description, defaultValue) => ({ ...string, description: `${description}；值为源数据列名。`, ...(defaultValue === undefined ? {} : { default: defaultValue }) });
const fields = defaults => Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, field(value[1], value[0])]));
const enumOf = (...values) => ({ enum: values });
const array = (items, minItems, maxItems) => ({ type: 'array', items, minItems, maxItems });
const positive = { type: 'number', exclusiveMinimum: 0 };
const count = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const timeValue = { type: ['string', 'number'], description: '日期或带偏移的时间戳；temporal 图的 Unix 数值为毫秒，candlestick 为秒。' };
const unitValue = { ...positive, description: '每个点或刻度代表的实际数量；数据须为该单位的整数倍。' };
const xType = enumOf('time', 'number', 'category', null);
const tone = enumOf('neutral', 'signed', 'positive', 'negative', null);
const labels = { type: 'object', additionalProperties: { type: 'string' }, description: '源列名到显示名称的映射。' };
const commonOptions = { unit: { type: 'string' }, height: { type: 'number', minimum: 120, maximum: 12000 } };
const xy = { x: field('横轴坐标'), y: { anyOf: [field('数值'), array(field('数值序列'), 1, 32)] }, xType, series: { ...field('分组（只能配一个 y）'), type: ['string', 'null'] }, labels, tone,
  format: enumOf('number', 'integer', 'percent', 'ratio', 'currency', 'text'), digits: { type: 'integer', minimum: 0, maximum: 100 }, baseline: { type: 'number' },
  marks: array({ type: 'object', properties: { x: timeValue, label: { type: 'string' } }, required: ['x', 'label'] }, 0, 6) };
const mappings = {
  line: xy, area: xy, bar: xy, hbar: xy, scatter: xy,
  heatmap: { x: field('横轴类别'), y: field('纵轴类别'), value: field('单元格数值；缺失使用 null'), tone, format: xy.format, digits: xy.digits },
  matrix: { x: field('横轴类别'), y: field('纵轴类别'), value: field('完整网格的数值；缺失使用 null'), tone, colorMax: { ...positive, description: '颜色绝对值上界，不得小于已有最大绝对值。' } },
  units: { x: field('类别'), y: field('非负数量'), unitValue: { ...unitValue, default: 1 } },
  waterfall: { ...fields({ x: ['label', '标签'], y: ['value', '增减或累计数值'], type: ['type', '角色：start、delta、total、end'] }), balanceTolerance: { type: ['number', 'string'], description: '已声明的非负对账容差；默认 0。' } },
  dumbbell: { ...fields({ x: ['label', '比较对象'], before: ['before', '第一个端点数值或 null'], after: ['after', '第二个端点数值或 null'] }), beforeLabel: string, afterLabel: string },
  strip: { y: field('逐条观测数值或 null', 'value'), x: field('可选分组'), id: field('原始记录身份'), jitter: { type: 'number', minimum: 0, maximum: 0.4 } },
  histogram: { ...fields({ x: ['lower', '分箱下界'], xEnd: ['upper', '分箱上界'], y: ['count', '已计算的频数或密度'] }), sampleCount: count, method: string, valueType: enumOf('count', 'density'), lastBinClosed: { type: 'boolean' } },
  boxplot: { ...fields({ x: ['group', '组名'], low: ['low', '下须'], q1: ['q1', '第一四分位'], median: ['median', '中位数'], q3: ['q3', '第三四分位'], high: ['high', '上须'], n: ['n', '非负整数样本量'], outliers: ['outliers', '须线外原始数值数组'] }), method: string },
  ridgeline: { ...fields({ x: ['value', '已计算密度网格的坐标'], y: ['density', '非负密度或 null'], group: ['group', '分组'], n: ['n', '同组一致的样本量'] }), method: string, sampleCount: count },
  calendar: { ...fields({ date: ['date', '日期或带偏移时间'], value: ['value', '数值或 null'], status: ['status', 'observed、closed 或 missing'] }), x: field('date 的兼容别名'), y: field('value 的兼容别名'), timezone: string, weekStart: { type: 'integer', minimum: 0, maximum: 6 }, from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
  parallel: { label: field('对象标签'), group: field('已有分组'), dimensions: array({ type: 'object', properties: { key: field('维度'), label: string, unit: string, invert: { type: 'boolean' }, domain: array({ type: ['number', 'string'] }, 2, 2) }, required: ['key'], description: '每个 key 唯一；domain 必须递增并包含该维全部观测。' }, 3, 6) },
  bump: { ...fields({ time: ['time', '观察时点'], item: ['item', '固定集合中的对象'], rank: ['rank', '来源给定的 1…集合大小整数名次或 null'] }), x: field('time 的兼容别名'), y: field('rank 的兼容别名'), timezone: string, universe: { ...array(string, 1, 50), uniqueItems: true }, ties: enumOf('competition', 'dense', 'ordinal', 'as_reported'), periods: { ...array(timeValue, 1, 2500), uniqueItems: true } },
  lifecycle: { ...fields({ time: ['time', '真实事件时间'], item: ['item', '对象'], state: ['state', '原始状态'], event: ['id', '唯一事件 ID'], evidence: ['evidence', '最多 30 条 {label,href} 证据链接；可省略'] }), x: field('time 的兼容别名'), timezone: string },
  treemap: fields({ id: ['id', '唯一节点 ID'], parent: ['parentId', '父节点 ID；根为 null'], label: ['label', '节点名称'], value: ['value', '非负数量；父值可省略，否则须等于子叶总和'], side: ['side', '可选 long、short 或 neutral 类别，可继承父类别'] }),
  threads: { ...fields({ id: ['recordId', '唯一记录 ID'], signal: ['signalId', '第一阶段 ID 或显式 null'], order: ['orderId', '第二阶段 ID 或显式 null'], fill: ['fillId', '第三阶段 ID 或显式 null'] }), stageLabels: array(string, 3, 3) },
  flow: fields({ id: ['id', '唯一边 ID'], source: ['source', '起点 ID'], target: ['target', '终点 ID'], value: ['value', '非负流量'], batch: ['batch', '同一批次 ID'], nodeId: ['id', '独立 nodes 数据中的唯一节点 ID'], nodeLabel: ['label', '节点名称'], role: ['role', '节点 source、sink 或 transit；默认 transit'] }),
  'network-circular': { ...fields({ id: ['id', '唯一边 ID'], source: ['source', '起点 ID'], target: ['target', '终点 ID'], weight: ['weight', '非负权重'], sign: ['sign', '数值 -1、0 或 1'], nodeId: ['id', '独立 nodes 数据中的唯一节点 ID'], nodeLabel: ['label', '节点名称'] }), directed: { type: 'boolean' } },
  'decision-tree': fields({ id: ['id', '唯一节点 ID'], parent: ['parentId', '父节点 ID；唯一根为 null'], label: ['label', '判断问题或最终结果'], condition: ['condition', '进入节点的分支条件'], detail: ['detail', '补充说明'] }),
  candlestick: { ...fields({ time: ['time', '日期、时间或 Unix 秒'], open: ['open', '开值'], high: ['high', '高值'], low: ['low', '低值'], close: ['close', '收值'] }), x: field('time 的兼容别名'), digits: { type: 'integer', minimum: 0, maximum: 8 }, overlays: array({ type: 'object', properties: { field: field('已有同单位价格列；明确给定的参考价可映射为常数列，以参考线命名，不冒充逐日观测'), label: string, group: string, style: enumOf('solid', 'dashed'), visible: { type: 'boolean' } }, required: ['field', 'label'], additionalProperties: false }, 0, 12) },
  stream: { ...fields({ x: ['x', '至少两个有序时点'], series: ['series', '可相加的构成部分'], value: ['value', '非负数量'] }), xType },
  'stacked-rungs': { ...fields({ x: ['x', '比较对象'], series: ['series', '构成部分'], value: ['value', '非负数量'] }), unitValue },
  'dot-heatmap': { ...fields({ x: ['x', '横轴类别'], y: ['y', '纵轴类别'], value: ['value', '数值或显式 null'] }), tone: enumOf('neutral', 'signed', null) },
  funnel: fields({ x: ['x', '按顺序且不重复的阶段'], value: ['value', '非负整数；后阶段不能大于前阶段'] }),
  'category-links': fields({ item: ['item', '唯一对象'], group: ['group', '对象唯一归属的类别'] }),
  'outcome-tally': { ...fields({ x: ['x', '结果名称'], value: ['value', '非负整数发生次数'], total: ['total', '正整数有效样本数'] }), unitValue, overlap: { type: 'boolean' } },
  'paired-rungs': { ...fields({ x: ['x', '比较对象'], before: ['before', '第一次数量'], after: ['after', '第二次数量'] }), unitValue, labels, tone: enumOf('neutral', 'signed', null) },
  'rank-race': { ...fields({ time: ['time', '按输入顺序排列的时期'], item: ['item', '每期相同的对象集合'], value: ['value', '有限数值'] }), frame: { type: ['string', 'number'], description: '已有时期；默认输入的最后一期。' }, tone: enumOf('neutral', 'signed', null) },
  spectrum: { label: field('唯一对象名称', 'item'), focus: string, dimensions: array({ type: 'object', properties: { field: field('已有结果数值或 null'), min: { type: 'number' }, max: { type: 'number' }, left: string, right: string, label: string, unit: string }, required: ['field', 'min', 'max', 'left', 'right'], description: '字段唯一，min < max，已有值位于该范围内；两端文字说明尺度含义。' }, 1, 10) },
  'tick-donut': { ...fields({ x: ['x', '互斥组成部分'], value: ['value', '可相加的非负数量'] }), unitValue },
  barcode: { ...fields({ x: ['x', '不重复的观测位置'], value: ['value', '数值或显式 null'] }), xType, highlights: array(timeValue, 0, 6), tone: enumOf('neutral', 'signed', null) },
  'bubble-ledger': { ...fields({ x: ['x', '类别'], y: ['year', '四位整数年份'], value: ['value', '数值或显式 null'], status: ['status', 'observed、partial 或 missing'], event: [undefined, '同年一致的已有事件说明'] }), tone: enumOf('neutral', 'signed', null) },
};
mappings.violin = mappings.ridgeline;
mappings['network-force'] = mappings['network-circular'];

const requiredOptions = {
  line: ['x', 'y'], area: ['x', 'y'], bar: ['x', 'y'], hbar: ['x', 'y'], scatter: ['x', 'y'],
  heatmap: ['x', 'y', 'value'], matrix: ['x', 'y', 'value'], units: ['x', 'y'],
  histogram: ['sampleCount', 'method'], boxplot: ['method'], ridgeline: ['method'], violin: ['method'],
  calendar: ['timezone'], parallel: ['dimensions'], bump: ['timezone', 'universe', 'ties'], lifecycle: ['timezone'],
  'stacked-rungs': ['unitValue'], 'outcome-tally': ['unitValue', 'overlap'], 'paired-rungs': ['unitValue'], 'tick-donut': ['unitValue'], spectrum: ['focus', 'dimensions'],
};
const chartNotes = {
  line: 'xType 决定真实时间、数值间距或类别顺序；缺失 y 断线。series 仅可搭配单个 y。',
  area: '填充相对 baseline 或可见纵轴下界；不自动累计，也不把多序列自动堆叠。',
  bar: '类别内同一序列不能重复；多序列使用分组柱，数值共用零基线。',
  hbar: '适合长标签；输入次序不自动转成排名，需事先按目标次序组织记录。',
  scatter: '每点是一条观测；图形不计算相关性、回归或因果关系。',
  heatmap: '每个 x/y 组合只能一条记录；数值为 null 时显示缺失，不能用零代替未知。',
  matrix: '必须提供完整且不重复的网格，最多 20×20；缺失格显式为 null。',
  units: '数量非负且为 unitValue 的整数倍；整图最多 1,000 个点。',
  waterfall: '首行为 start，末行为 end，中间为 delta 或 total；累计值须精确对账，容差只用于已说明的舍入差。',
  dumbbell: '端点须同单位同口径；缺失端点不连接，不暗示两个状态之间的过程。',
  strip: '每点保留原行；jitter 只减少遮挡，最多 40 组，不表示第二个数值维度。',
  histogram: '分箱不重叠；count 模式须等宽整数频数且合计 sampleCount，不等宽使用预计算 density。',
  boxplot: '最多 40 组；low≤q1≤median≤q3≤high，异常值在须线外且数量小于 n；统计量须预先计算。',
  ridgeline: '最多 40 组；组内坐标唯一、密度非负，样本量一致；直接连接已提供网格，不估计或平滑密度。',
  violin: '宽度表示密度而非样本量；使用与山脊图相同的已计算网格和方法约束。',
  calendar: 'timezone 为有效 IANA 时区；最多 2,500 日且每日唯一，observed 必须有值，closed/missing 无值。',
  parallel: '3–6 个不同维度；每轴独立量纲，范围须覆盖全部已知值，不自动评分、归一化或排名。',
  bump: '名次由来源提供；同对象同时间唯一，声明固定 universe 和 ties；缺失断线，过滤不重算排名。',
  lifecycle: '事件 ID 唯一；时间接受日历日期、带偏移时间或 Unix 毫秒，同图时间口径一致；连线不表示持续时间或因果。',
  treemap: '唯一 ID、存在的父节点、无环且不超过 32 层；面积只累计非负叶子，不重复计算父节点。',
  threads: '最多 200 条路线；三个阶段字段均须出现，缺口写 null，不能全部为 null；stageLabels 恰好三项。',
  flow: '需要独立 nodes 或节点绑定（1–100 节点）；单批次无环，source/sink/transit 角色及中转守恒必须成立。',
  'network-circular': '需要 1–100 个独立节点、最多 500 条真实边；端点存在、无自环，权重非负，sign 为 -1/0/1。',
  'network-force': '与环形网络共用节点与边约束；布局距离和位置不代表统计强度或因果。',
  'decision-tree': '必须恰好一个根且全部节点连通无环；叶子写结果，继续判断的条件应拆成分支。',
  candlestick: '每个时点唯一；OHLC 全缺失可留时间空位，部分缺失或高低矛盾报错；overlays 只读取已有同单位数值，给定参考线保留数值来源和适用时点，不能伪造动态指标。',
  stream: '完整非负时点×构成网格，2–300 时点、最多 8 部分；流带中心位置不编码数值。',
  'stacked-rungs': '完整非负对象×构成网格，最多 12 对象、6 部分；各值是 unitValue 整数倍，每段≤500 格、全图≤2,500 格。',
  'dot-heatmap': '完整且不重复的网格，最多 24×24；圆面积对应绝对值，signed 另编码正负，空心为零、叉号为缺失。',
  funnel: '2–12 个唯一阶段，数量为非负整数并逐步不增；新增或重复计数的流程应使用流向图。',
  'category-links': '最多 60 个唯一对象、12 类；一对象只能属于一类，连线不表示因果。',
  'outcome-tally': '最多 12 项；0≤value≤total，次数与样本数是 unitValue 整数倍；不重叠时分母一致且合计次数不超过分母。',
  'paired-rungs': '最多 12 对象；两列不同且同口径，各值是 unitValue 整数倍；不推断两次观测之间的走势。',
  'rank-race': '完整时期×对象网格，最多 120 期、12 对象；按提供数值降序排列，并列保持初始对象顺序，默认静止在最后一期。',
  spectrum: '最多 12 个唯一对象和 10 个尺度；focus 必须存在，min<max 且覆盖已有值，null 不画点。',
  'tick-donut': '1–8 个互斥部分，单位整数倍，合计 1–360 格；零保留名称，缺失不能当零。',
  barcode: '每位置唯一，按 xType 的实际间距或输入类别顺序定位；highlights 只能引用最多 6 个已有位置。',
  'bubble-ledger': '完整类别×年份网格，最多 16 类、25 年、跨度≤30 年；状态须与数值匹配，同年事件说明一致。',
};

function chartSchema(kind) {
  const schema = standalone(blockDefinition('chart'));
  schema.properties.kind = { const: kind };
  schema.properties.options = {
    ...schema.properties.options, properties: clone({ ...commonOptions, ...mappings[kind] }),
    propertyNames: { not: { anyOf: [{ enum: ['rows', 'data', 'nodes', 'kind', 'title', 'caption', 'onSelect', 'onFilter', 'onError', '__proto__', 'constructor', 'prototype'] }, { pattern: '^on[A-Z]' }] } },
    description: '映射值指向 rows 或 data_id 中的源列；关系与跨行约束见 notes，由真实渲染器继续检查。',
  };
  if (requiredOptions[kind]) {
    schema.required.push('options');
    schema.properties.options.required = requiredOptions[kind];
  }
  if (['line', 'area', 'bar', 'hbar', 'scatter'].includes(kind)) schema.properties.options.allOf = [{
    if: { properties: { series: { type: 'string' } }, required: ['series'] },
    then: { properties: { y: { anyOf: [field('数值'), array(field('数值'), 1, 1)] } } },
  }];
  if (['flow', 'network-circular', 'network-force'].includes(kind)) {
    schema.properties.nodes.minItems = 1;
    schema.properties.nodes.maxItems = 100;
    schema.allOf = [{ oneOf: [{ required: ['nodes'], not: { required: ['chart_data'] } }, { required: ['chart_data'], not: { required: ['nodes'] }, properties: { chart_data: { minItems: 1 } } }] }];
  }
  const limits = { boxplot: [1, 40], threads: [1, 200], 'network-circular': [1, 500], 'network-force': [1, 500], funnel: [2, 12], 'category-links': [1, 60], 'outcome-tally': [1, 12], 'paired-rungs': [1, 12], spectrum: [1, 12], 'tick-donut': [1, 8] };
  if (limits[kind]) [schema.properties.rows.minItems, schema.properties.rows.maxItems] = limits[kind];
  return schema;
}

const fixtureCharts = new Map(['statistical', 'temporal', 'structural', 'composition'].flatMap(family => readJSON(`examples/${family}-fixtures.json`).charts).map(entry => [entry.spec.kind, entry.spec]));
function gridSample(spec, keys, limits = [2, 2]) {
  const values = keys.map((key, i) => [...new Set(spec.rows.map(row => row[spec[key] ?? key]))].slice(0, limits[i]));
  return spec.rows.filter(row => keys.every((key, i) => values[i].includes(row[spec[key] ?? key])));
}
function chartExample(kind) {
  let spec = fixtureCharts.has(kind) ? clone(fixtureCharts.get(kind)) : null;
  if (spec) {
    delete spec.title;
    if (['dumbbell', 'parallel', 'lifecycle', 'threads', 'outcome-tally', 'paired-rungs', 'spectrum', 'tick-donut'].includes(kind)) spec.rows = spec.rows.slice(0, 2);
    if (kind === 'strip') spec.rows = spec.rows.slice(0, 4);
    if (kind === 'funnel') spec.rows = spec.rows.slice(0, 3);
    if (kind === 'category-links') spec.rows = gridSample(spec, ['group'], [3]).filter((row, index, rows) => index === rows.findIndex(item => item[spec.group] === row[spec.group]));
    if (kind === 'barcode') { spec.rows = spec.rows.slice(0, 6); spec.highlights = [spec.rows[2][spec.x]]; }
    if (['stream', 'stacked-rungs'].includes(kind)) spec.rows = gridSample(spec, ['x', 'series']);
    if (['dot-heatmap', 'bubble-ledger'].includes(kind)) spec.rows = gridSample(spec, ['x', 'y']);
    if (kind === 'rank-race') spec.rows = gridSample(spec, ['time', 'item']);
  } else if (['line', 'area', 'bar', 'hbar', 'scatter'].includes(kind)) {
    spec = { kind, x: 'position', y: 'value', xType: 'number', rows: [{ position: 1, value: 2 }, { position: 2, value: 5 }, { position: 3, value: 3 }] };
    if (['bar', 'hbar'].includes(kind)) { spec.xType = 'category'; spec.rows = [{ position: '甲', value: 2 }, { position: '乙', value: 5 }]; }
  } else if (['heatmap', 'matrix'].includes(kind)) {
    spec = { kind, x: 'column', y: 'row', value: 'value', rows: [{ column: '甲', row: '一', value: 2 }, { column: '乙', row: '一', value: 5 }, { column: '甲', row: '二', value: 0 }, { column: '乙', row: '二', value: null }] };
  } else if (kind === 'units') spec = { kind, x: 'label', y: 'count', unitValue: 1, rows: [{ label: '甲', count: 3 }, { label: '乙', count: 5 }] };
  else if (kind === 'candlestick') spec = { kind, time: 'time', open: 'open', high: 'high', low: 'low', close: 'close', digits: 1,
    overlays: [{ field: 'reference_low', label: '参考下界', group: '给定参考区间', style: 'dashed' }, { field: 'reference_high', label: '参考上界', group: '给定参考区间', style: 'dashed' }],
    rows: [{ time: '2026-01-01', open: 10, high: 13, low: 9, close: 12, reference_low: 9.5, reference_high: 12.5 }, { time: '2026-01-02', open: 12, high: 13, low: 10, close: 11, reference_low: 9.5, reference_high: 12.5 }] };
  else if (kind === 'decision-tree') spec = { kind, rows: [{ id: 'root', parentId: null, label: '容量是否充足？' }, { id: 'yes', parentId: 'root', condition: '容量充足', label: '开始处理' }, { id: 'no', parentId: 'root', condition: '容量不足', label: '等待空闲容量' }] };
  if (!spec) throw new Error(`Missing chart example: ${kind}`);
  const { rows, nodes, kind: ignoredKind, ...options } = spec;
  return { type: 'chart', kind, options, rows, ...(nodes ? { nodes } : {}) };
}

const paragraph = { type: 'paragraph', text: '演示说明：以下内容使用虚构样本。' };
const blockExamples = {
  paragraph, markdown: { type: 'markdown', text: '**演示**：用短段落补充说明。' },
  attachments: { type: 'attachments', items: [{ label: '演示数据', path: 'evidence/demo.json' }] },
  judgment: { type: 'judgment', text: '演示：当前容量足够完成任务。' },
  formula: { type: 'formula', latex: 'r=\\frac{a}{b}' },
  metrics: { type: 'metrics', items: [{ label: '演示数量', value: 12 }] },
  range: { type: 'range', label: '演示位置', min: 0, max: 10, value: 6 },
  scores: { type: 'scores', min: 0, max: 10, items: [{ label: '演示尺度甲', value: 6 }, { label: '演示尺度乙', value: 8 }] },
  reasoning: { type: 'reasoning', steps: ['演示：需求为 6。', '演示：容量为 10，足以覆盖需求。'] },
  table: { type: 'table', columns: ['项目', '数量'], rows: [['演示甲', 2], ['演示乙', 5]] },
  group: { type: 'group', layout: 'columns', blocks: [paragraph, { type: 'metrics', items: [{ label: '演示数量', value: 12 }] }] },
  details: { type: 'details', title: '演示依据', blocks: [paragraph] },
  chart: chartExample('line'),
  judgments: { type: 'judgments', items: [{ label: '容量', value: '演示：容量充足。' }] },
  logic: { type: 'logic', title: '演示依赖关系', nodes: [{ id: 'input', label: '已有输入' }, { id: 'result', label: '输出结果' }], edges: [{ from: 'input', to: 'result' }] },
};
const blockMetadata = {
  paragraph: ['段落', 'content', '用简短自然语言解释背景、方法、限制或图表中的关键观察。', 'paragraph text prose'],
  markdown: ['Markdown 文本', 'content', '需要加粗、列表或链接等基础格式时，组织补充说明与阅读结构。', 'markdown formatted text list'],
  attachments: ['证据附件', 'content', '向读者提供已打包数据、文本或图片的下载入口，便于核对完整材料。', 'attachments evidence files download'],
  judgment: ['一句判断', 'content', '突出一个已有的核心判断。', 'judgment conclusion statement'],
  formula: ['数学公式', 'content', '以 LaTeX 表达变量关系、计算定义或方法中的关键公式。', 'formula latex math equation'],
  metrics: ['指标摘要', 'content', '集中呈现少量关键数值及其含义，便于读者快速读取结果。', 'metrics kpi numeric summary'],
  range: ['区间位置', 'comparison', '在明确上下界内定位一个真实数值，突出它距两端的相对位置。', 'range bounded position'],
  scores: ['同尺度数值', 'comparison', '在统一且已说明的数值范围内并列比较多个已提供结果。', 'scores common scale values comparison'],
  reasoning: ['推理步骤', 'content', '按顺序列出从已有事实到结论的解释步骤，便于逐步核查。', 'reasoning ordered steps explanation'],
  table: ['数据表', 'content', '需要精确读数、混合字段或逐行核对时，直接保留原始标量记录。', 'table records exact values'],
  group: ['内容组合', 'layout', '把相关内容按并列或纵向关系组成一组，保持同一阅读上下文。', 'group layout columns stack composition'],
  details: ['折叠详情', 'layout', '把完整证据、方法或长说明放入可展开区域，减少主叙述中的干扰。', 'details disclosure evidence'],
  chart: ['通用图表入口', 'content', '把固定源数据映射到一种已支持图型，具体选择与参数由 chart.* 目录提供。', 'chart builtin visualization'],
  judgments: ['分项判断', 'content', '并列展示已有的标签和判断；需要明细时显式提供命名的值。', 'judgments results evidence conditions'],
  logic: ['逻辑依赖图', 'relationship', '展示多个输入、步骤和结果之间的有向依赖，适合包含共享输入或汇合的无环结构。', 'logic dag dependency directed graph'],
};

const entries = new Map();
function add(id, metadata, detail) {
  const [label, category, whenToUse, keywords = ''] = metadata;
  if (!categories.some(item => item.id === category)) throw new Error(`Unknown component category: ${category}`);
  entries.set(id, { id, label, category, whenToUse, ...detail, exampleContext: { target: 'answer', provenance_kind: 'demo', ...detail.exampleContext }, keywords });
}
const publicKinds = blockDefinition('chart').properties.kind.enum;
if (publicKinds.length !== Object.keys(chartMetadata).length || publicKinds.some(kind => !chartMetadata[kind] || !mappings[kind])) throw new Error('Component catalog must cover every public chart kind');
for (const kind of publicKinds) add(`chart.${kind}`, chartMetadata[kind], {
  placement: chartPlacement, inputSchema: chartSchema(kind), example: chartExample(kind), notes: [chartNotes[kind], 'rows 与固定 data_id 二选一；columns 从实际数据推导，可显式提供。图表 title 可省略；解释放独立 paragraph/markdown。示例按 exampleContext 作为 answer 组件调用；完整报告另需顶层 title、lead、highlights 和非空正文。'],
});
for (const schema of blockDefinitions) {
  const type = schema.properties.type.const;
  if (!blockMetadata[type] || !blockExamples[type]) throw new Error(`Missing public block component: ${type}`);
  add(`block.${type}`, blockMetadata[type], { placement: type === 'chart' ? chartPlacement : blocksPlacement, inputSchema: standalone(schema), example: blockExamples[type], notes: [
    type === 'attachments' ? 'items.path 必须匹配发布参数 assets 的真实惰性附件；exampleContext.source_path 相对调用者工作区，按实际文件位置调整。'
      : ['group', 'details'].includes(type) ? '嵌套深度最多 5；子内容复用同一公开 block schema。'
        : type === 'chart' ? '这是所有图型共用的公开外壳；请 describe 对应 chart.<kind> 获取具体字段与数据约束。'
          : type === 'range' || type === 'scores' ? 'min < max 且数值在范围内；组件只展示已有结果，不自行生成分数或概率。'
            : type === 'table' ? '每行单元格数必须等于列数；只接受有限标量，null 保留为缺失。'
              : '示例为虚构演示；内容和证据由调用者提供，组件不产生新的分析结论。',
  ], ...(type === 'attachments' ? { exampleContext: { assets: [{ path: 'evidence/demo.json', source_path: 'packages/reports/examples/statistical-fixtures.json', media_type: 'application/json' }] } } : {}) });
}
for (const layout of ['columns', 'stack']) {
  const schema = standalone(blockDefinition('group'));
  schema.properties.layout = { const: layout };
  add(`layout.${layout}`, layout === 'columns'
    ? ['并列布局', 'layout', '把需要同时对照的少量内容并列摆放，让读者在同一视区比较。', 'columns side by side comparison layout']
    : ['纵向布局', 'layout', '把具有先后阅读关系的相关内容纵向串联，保持完整的叙述顺序。', 'stack vertical ordered layout'], {
    placement: blocksPlacement, inputSchema: schema, example: { ...clone(blockExamples.group), layout }, notes: ['实际输入为 type: group；最多 12 个子块，嵌套深度最多 5，子块复用公开 block schema。'],
  });
}
add('report.highlights', ['首屏关键结果', 'content', '让读者在开篇快速读到最重要的已有数值或短定性结论；完整报告必用1–6项，无框大字网格。', 'report opening highlights metrics key results 首屏'], {
  placement: ['highlights', 'input.highlights'], inputSchema: clone(publicationSchema.properties.highlights),
  example: [{ label: '样本数量', value: 24 }, { label: '已有判断', value: '需要继续观察' }],
  exampleContext: { target: 'report', title: '合成结果示例', lead: '样本结果需要继续观察。', content: { kind: 'document', sections: [{ title: '已有结果', blocks: [{ type: 'paragraph', text: '这是结构和视觉演示，不是研究结论。' }] }] } },
  notes: ['复用 block.metrics.items 的 {label,value,tone?}；将 example 数组直接放入 components_show 的 highlights，或完整 provider input.highlights，不包在 component 内。', '呈现顺序：title → lead → highlights → content.sections。完整报告同时提供这四项；普通强调用蓝色，明确盈亏用原有 positive/negative tone。只展示已有结果，不自动提取正文，也不必凑满6项。', '首屏仅作快速概览，不能替代正文趋势、比较、分布或条件关系的图表设计。'],
});
freeze([...entries.values()]);

function entry(id) {
  if (typeof id !== 'string' || !entries.has(id)) throw new Error(`Unknown component id: ${String(id)}`);
  return entries.get(id);
}
export function getComponentSchema(id) { return clone(entry(id).inputSchema); }
export function getChartSchema(kind) { return getComponentSchema(`chart.${kind}`); }
export function getBlockSchema(type) { return getComponentSchema(`block.${type}`); }

export function describeComponents(ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 12) throw new Error('Component ids must contain 1–12 identifiers');
  return { schemaVersion: 1, items: ids.map(id => { const { keywords, ...detail } = entry(id); return clone(detail); }) };
}

export function listComponents(filter = {}) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter) || Object.keys(filter).some(key => !['query', 'category', 'cursor', 'limit'].includes(key))) throw new Error('Invalid component list filter');
  const { limit = 20, category = '', cursor } = filter;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Component limit must be an integer from 1 to 100');
  if (typeof category !== 'string' || category && !categories.some(item => item.id === category)) throw new Error(`Unknown component category: ${String(category)}`);
  if (filter.query !== undefined && typeof filter.query !== 'string') throw new Error('Component query must be text');
  const query = (filter.query ?? '').normalize('NFKC').trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const matching = [...entries.values()].filter(item => (!category || item.category === category) && terms.every(term =>
    `${item.id} ${item.label} ${item.whenToUse} ${item.category} ${item.keywords}`.normalize('NFKC').toLowerCase().includes(term)));
  let offset = 0;
  if (cursor !== undefined) {
    try {
      if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const state = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (state.version !== 1 || state.query !== query || state.category !== category || !Number.isInteger(state.offset) || state.offset <= 0 || state.offset >= matching.length) throw new Error();
      offset = state.offset;
    } catch { throw new Error('Invalid component cursor; keep the same query and category when paging'); }
  }
  const end = offset + limit;
  return { schemaVersion: 1, items: matching.slice(offset, end).map(({ id, label, whenToUse, category, placement }) => clone({ id, label, whenToUse, category, placement })),
    ...(end < matching.length ? { nextCursor: Buffer.from(JSON.stringify({ version: 1, query, category, offset: end })).toString('base64url') } : {}),
    total: matching.length, categories: categories.map(item => ({ ...item, count: [...entries.values()].filter(entry => entry.category === item.id).length })),
  };
}
