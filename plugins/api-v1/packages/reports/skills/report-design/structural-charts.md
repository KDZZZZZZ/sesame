# 关系与结构图

可选资产 `assets/charts-structure.js` 在 `assets/editorial-charts.js` 之后内联。它注册 `treemap`、`threads`、`flow`、`network-circular`、`network-force`，共用原版无框图表、主题与点击/键盘选择。只按研究问题选择必要的图形。

```js
const rows = await reportKit.rows('fixed-links');
const nodes = await reportKit.rows('fixed-nodes');
const chart = SesameCharts.chart(container, {
  kind: 'network-circular', rows, nodes,
  onSelect(row, index) { showExactRecord(row); }
});
// 容器不再使用时释放观察器、事件及拖动。
chart.destroy();
```

`rows` 与可选 `nodes` 必须从报告声明的固定绑定读取，或是可复算且已注明的派生记录。不要把示例数据当市场观测，也不要根据名称、距离、排列顺序猜测连接。`examples/structural-fixtures.json` 中所有值都是 `demo`。

点击或 Enter/Space 选择原记录；Escape 或「显示全部」恢复完整视图。`onSelect(row,index)` 的 row 保留原对象和精确数值字符串。树图叶子、交易链路、流向和网络的边返回 `rows` 索引；网络节点来自独立的 `nodes`，返回 `index:-1`。有两个数据绑定时按实际 ID 展示明细，不能把节点索引映射到边表。

## 非负层级构成：treemap

用于总敞口、资金分配或其他非负总额。正负收益、净头寸等有符号量改用条形图；空头敞口用正的绝对敞口配合 `side:'short'`，不要把负数取绝对值而不披露定义。

```js
SesameCharts.chart(container, { kind:'treemap', rows, unit:'USD' });
// 固定 rows 的结构：
// {id:'portfolio', parentId:null, label:'Gross exposure', value:'100'}
// {id:'long', parentId:'portfolio', label:'Long', side:'long', value:'70'}
// {id:'short', parentId:'portfolio', label:'Short', side:'short', value:'30'}
```

叶子必须提供非负 `value`；父节点的 `value` 可省略，若提供必须与全部子叶之和精确相等。面积只累计叶子，父节点不重复贡献面积；树枝按层级相邻排布，完整路径在选择提示中显示。`side` 为 `long` / `short` / `neutral`，可从父节点继承；图例明确区分，零叶子在折叠记录列表内可选，不伪造面积。全零数据明确说明合计为零。

字段映射可用 `id`、`parent`、`value`、`label`、`side`（默认分别是同名字段，父字段默认 `parentId`）。ID 必须唯一；父节点必须存在；拒绝环和超过 32 层的层级。最多 2,500 行，密集组合应先按明确口径聚合或筛选。

## 可追溯交易记录：threads

每一行是一条实际记录的信号 → 委托 → 成交链路。同一委托的多个部分成交各占一行，行 ID 独立，保留原生 signal/order/fill ID。

```js
SesameCharts.chart(container, {
  kind:'threads', rows,
  stageLabels:['Signal','Order','Fill']
});
// {recordId:'route-1', signalId:'signal-8', orderId:'order-42', fillId:'fill-91'}
// {recordId:'route-2', signalId:'signal-9', orderId:'order-43', fillId:null}
```

三个阶段字段都必须出现，尚无或没有关联记录的阶段显式为 `null`；缺口两端不补线。手工委托可将 `signalId` 设为 null，未成交委托可将 `fillId` 设为 null；整条路线全为 null 不接受。ID 只作追踪依据，不暗示时间间隔或成交量；额外数量、时间、决策说明保留在原记录明细里。

映射字段是 `id`（默认 `recordId`）、`signal`、`order`、`fill`（后三者默认 `signalId/orderId/fillId`）。`stageLabels` 必须恰好三个。最多 200 条路线，按实际批次或用户筛选范围分图；图高随记录增加，手机也保留完整路线。

## 守恒的同批次流向：flow

`rows` 是实际边，`nodes` 是显式节点。只能比较同一批次、同一单位的流量；不可混用净值、敞口、成交额等不同定义。费用、流出或其他终点需要有真实记录并建为 sink，不为了让图通过而补出一条差额边。

```js
SesameCharts.chart(container, {kind:'flow', rows:links, nodes, unit:'USD'});
// nodes:
// {id:'capital',label:'Capital',role:'source'}
// {id:'allocation',label:'Allocation',role:'transit'}
// {id:'sleeve',label:'Sleeve',role:'sink'}
// links:
// {id:'transfer-1',source:'capital',target:'allocation',value:'100.10',batch:'batch-1'}
// {id:'transfer-2',source:'allocation',target:'sleeve',value:'100.10',batch:'batch-1'}
```

所有边的 `batch` 必须相同，金额非负且有观测值。`source` 节点只有出边，`sink` 只有入边；默认 `transit` 必须有入边和出边，且十进制金额精确守恒（`0.1 + 0.2 = 0.3` 可通过）。拒绝循环、自环、未定义端点和不平衡中转。零边保留为细虚线并明确为零。

可映射 `id/source/target/value/batch`，节点字段可映射 `nodeId/nodeLabel/role`，默认 `id/label/role`。最多 100 个节点、2,500 条边。宽屏从左到右，窄屏从上到下；线宽按金额，点击突出真实边，不推断分流之后每一笔资金的去向。

## 有依据的网络：network-circular / network-force

两种布局使用完全相同的实际节点和边。环形适合固定节点集合的比较；力导向适合探索关系群组，其几何距离没有统计量意义。

```js
SesameCharts.chart(container, {
  kind:'network-force', rows:links, nodes, directed:false
});
// nodes: {id:'factor-a',label:'Trend'}
// links: {id:'observed-a-b',source:'factor-a',target:'factor-b',weight:'0.42',sign:-1}
```

`weight` 为观测到的非负幅度，`sign` 必须是数字 `-1/0/1`，分别表示负向、中性、正向；符号与权重的具体统计定义、窗口、样本量由报告说明。若原数据是有符号相关系数，可在有依据的派生数据中明确计算幅度和 sign；组件不会自行算相关性或生成边。

线粗细区分权重，颜色与负向虚线区分符号；零权重也为虚线，准确值见提示。`directed:true` 显示箭头，否则表示无向关系。每条边必须有唯一 ID，允许同端点的多个实际边并分开绘制；自环须在派生数据中明确排除。节点最多 100 个、边最多 500 条；孤立节点会保留。

可映射 `id/source/target/weight/sign`、`nodeId/nodeLabel`。力导向使用确定性的有限次求解，不启动常驻模拟；节点可拖动，松手即停，销毁或重画时释放指针监听。拖动只改变布局，永远不修改记录或边权重。点击节点突出实际相邻边与节点，点击边突出它和两个端点。
