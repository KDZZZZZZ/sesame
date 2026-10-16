# 时序与多维比较

按要回答的问题选择一种图：逐日观察用 `calendar`，多维候选比较用 `parallel`，已有排名随时间变化用 `bump`，有记录和证据的事件过程用 `lifecycle`。这些图是可选补充，使用原版无框排版与主题色，不替代报告的结论、来源和方法。

从零编写 HTML 时，先加载 `assets/editorial.css`、`assets/editorial-charts.js`，再加载 `assets/charts-temporal.js`。生成独立报告时把资产内联或随报告打包，不依赖 CDN。模板已经提供这些资产时不要重复加载。

```js
const chart = SesameCharts.chart(container, {
  kind: 'calendar', rows, date: 'day', value: 'pnl', status: 'status',
  timezone: 'Asia/Shanghai', unit: 'CNY',
  onSelect(row, index) {
    // row 就是 rows[index]，包括未用于绘图的来源、精确字符串等字段。
    inspectSource(row, index);
  }
});
// 容器销毁或替换自己的自定义视图时释放 resize observer 与交互监听。
chart.destroy();
```

每个图最多读取 2,500 条已经固定的源记录；不在浏览器中补市场数据、排名、回测统计或因果解释。保持传入的 `spec` 和 `rows` 不变；数据发生变化时重新调用 `chart`。SVG 坐标会转为 Number，提示和选择仍保留原值，例如金额字符串的尾数不会被改写。

所有源记录标记都支持点击，以及聚焦后 Enter / Space；`onSelect(row,index)` 和容器上的 `chartselect` 事件返回原行与原索引。模板有 Inspect 时直接连接它。独立嵌入需要额外明细时可传 `inspector:true`，它是折叠面板，不会默认重复放一份表格。

## 日历 `calendar`

```js
{
  kind: 'calendar', timezone: 'America/New_York',
  date: 'day', value: 'pnl', status: 'status', unit: 'USD',
  weekStart: 1, from: '2026-01-01', to: '2026-01-31', rows
}
```

| 字段 | 含义 |
| --- | --- |
| `date` | 日期字段名，默认 `date`，也可用 `x` |
| `value` | 数值字段名，默认 `value`，也可用 `y` |
| `status` | 状态字段名，默认 `status` |
| `timezone` | 必填 IANA 时区，如 `Asia/Shanghai` 或 `UTC` |
| `weekStart` | 一周起点，0 为周日，1 为周一；默认 1 |
| `from` / `to` | 可选的闭区间日历日期，默认最早到最晚源记录 |

状态有且仅有三种：

- `observed`：必须有有限数值，**0 是真实观察值**，格内显示 0。
- `closed`：必须没有数值，显示 ×。只接受来源明确给出的休市/关闭状态，不按星期猜测休市。
- `missing`：必须没有数值，显示虚线格和 —。

状态省略时，有限值推定为 observed，无值推定为 missing；绝不推定 closed。缺少整个源行的日期也用空格表示，但提示为“no source row; status unknown”，不会伪造一行数据或产生选择回调。正负使用不同颜色，颜色深度对应绝对量。

`YYYY-MM-DD` 是指定时区的日历日，原样保留；带 UTC offset 的 ISO 时间或 Unix **毫秒**先转换到指定时区，再定位日历日。例如 `2026-01-06T00:30:00Z` 在纽约落到 1 月 5 日。同一日只能有一条记录；需要汇总时先根据已声明的方法登记真实聚合结果。重复日、非法日期、状态和值矛盾会报错。

范围最多 2,500 日，不能裁掉任何传入源行。日历按宽度排列月份，手机上为单列。超过 12 个月时自动提供年份选择器，默认最早年份，并同时展示当前页和完整日期范围；可以切到没有任何源行的年份，那里所有格都明确为未知，而非零值或休市。切年通过 `onFilter` / `chartfilter` 返回当前页的原始行和原索引，缩放容器保留年份。整段数据共用颜色尺度，不因切年改变颜色含义。

## 平行坐标 `parallel`

```js
{
  kind: 'parallel', label: 'candidate',
  dimensions: [
    { key: 'sharpe', label: 'Sharpe' },
    { key: 'drawdown', label: 'Drawdown', unit: '%', domain: [0, 30], invert: true },
    { key: 'trades', label: 'Trades' },
    { key: 'latency', label: 'Latency', unit: 'ms', invert: true }
  ],
  rows,
  onFilter(selectedRows, originalIndices) { updateLinkedTable(selectedRows, originalIndices); }
}
```

`dimensions` 必须有 3–6 个不同的字段。每个轴有自己的量纲和刻度，不会算加权分数、综合优劣或重新排名。`invert:true` 仅反转该轴方向，并显示向下提示，不代表“更好”。可选 `domain:[min,max]` 必须覆盖所有已有值，不能把观察值静默截在边界；未声明则按实际范围绘图。

小量级的不同端点会使用有效数字或科学计数，不能都被显示成 0；每维筛选区同时显示完整范围。若很接近的端点在窄轴上无法无损显示，轴标为 min/max，完整值保留在刻度提示和筛选区，不截出两个相同的伪刻度。

每维提供可编辑的最小/最大筛选，另有“包含缺失维度”复选框和 Reset。每次有效筛选通过 `onFilter(selectedRows, originalIndices)` 与 `chartfilter` 事件返回**原对象**和**原索引**；数组顺序与输入一致。筛选边界包含等号；空白表示不设该方向边界。输入反向区间会保留上一次有效筛选并提示错误，不偷偷交换最小/最大。

缺失维度会打断连线；没有值的轴明确显示 No values。默认保留含缺失值的行：缺失维度不参与该维条件，其他已有维度仍需满足范围。取消复选框后，任何含缺失维度的行都被排除。缩放容器不会丢失当前筛选。

`group:'field'` 可按已有分类上色，不改变过滤或排序；来源未给分组不生成新类别。不要把视觉交叉多少当成相关性或优劣证据。

## 排名变化 `bump`

```js
{
  kind: 'bump', time: 'period', item: 'candidate', rank: 'rank',
  timezone: 'UTC',
  universe: ['A', 'B', 'C'],
  ties: 'competition',
  periods: ['2026-01-01', '2026-02-01', '2026-03-01'],
  rows
}
```

`universe` 必须明确指定固定比较集合，包含 1–50 个唯一名称；只允许该集合中的源行。排名是来源已经计算的整数 1…集合大小，或缺失值；图不会根据得分、输入顺序或当前可见曲线重新计算名次。前后排名口径、集合和样本不同，应先解释可比性再作图。

`ties` 必填：

| 值 | 口径 |
| --- | --- |
| `competition` | 竞赛排名，如 1、1、3 |
| `dense` | 稠密排名，如 1、1、2 |
| `ordinal` | 无并列的序号；相同时间出现同名次会报错 |
| `as_reported` | 来源原样排名，必须在方法里写明提供者的并列规则 |

同一时间、同一对象只能有一条源行。排名字符串按实际小数位检查整数性，不能把 `"0.99999999999999999"` 四舍五入当第 1 名。同名次保留相同纵坐标，圆点仅左右错开少许便于分别选择；不会拆成不同名次。完整时点会验证 competition / dense 规则；缺少任何排名时不能证明完整排名分布，图不补齐它，但会拒绝已经可证明不可能的竞赛名次，例如同一时点的 1、1、2，即使其他对象缺失。

`periods` 可选，表示完整的预期观察时点。整个时点都没数据时也应列出，才能显示那里的断线；省略时只使用源数据出现的时点，无法推测未声明的频率。未提供行和明确 `rank:null` 都断线；后者在独立缺失带有空心标记，仍可选择原行。缺失带不是末位。

图例可隐藏对象，保持原排名和固定 universe；`onFilter` / `chartfilter` 与平行坐标同义。容器缩放保留隐藏状态。支持日历日期，或带明确 offset 的时间戳 / Unix 毫秒，同一张图不能混用日历日期和瞬时时间。轴和提示转换到 `timezone`；提示还保留 source time 原值。

## 生命周期 `lifecycle`

```js
{
  kind: 'lifecycle', timezone: 'UTC',
  time: 'recorded_at', item: 'strategy', state: 'state', event: 'event_id',
  evidence: 'evidence', rows
}
// 单条源事件示意，内容必须来自真实事件记录：
// { event_id, recorded_at, strategy, state,
//   evidence: [{ label: '回测报告', href: registeredReportHref }], source_id }
```

默认字段名是 `time/item/state/id/evidence`。每个事件必须有唯一 ID、对象名、原始状态和明确时间；事件顺序按实际时间定位，源数组和选择索引不改动。同一对象同一时刻的多条事件垂直错开，不虚构先后顺序。不同对象分行。状态颜色只是分类，没有自动的成功/失败或进展评分。

连线是时间参照，不是状态持续时间、自动推断的迁移路径或因果关系。想表达“回测促成上线”“上线导致盈利”，必须另外提供能支持该陈述的证据；不能由这张图推断。没有停止事件也不代表状态一直持续。

每行 `evidence` 可包含最多 30 个 `{label,href}`，链接来自已登记的报告或记录。选中事件后显示可点击证据；没有链接就明确提示没有附带证据，不补造报告。允许报告内 `#fragment`、相对路径及 HTTP(S)，拒绝脚本、data、file 等 URL；运行环境的导航策略仍然生效。不要把 artifact ID 猜成网址。

时间格式和 `timezone` 规则与 bump 相同。密集事件可按对象/区间筛选后另作细图；极长事件序列受公共 12,000 高度上限约束。

## 验证用例

`examples/temporal-fixtures.json` 是明确标注的**虚构 demo**，用于零值/缺失、过滤、并列、证据链接和窄屏交互测试，不得用于任何金融结论。四图全部为 Sesame 原创 SVG 实现，没有复制 Lieflat 的受限源码或资产。

发布前用固定真实源行替换 demo，检查 390px 和桌面宽度、深浅主题、键盘选择、筛选后明细、证据链接，以及 `chart.destroy()` 后释放监听。不得用伪造补值或隐藏筛选解释图表“更顺眼”。
