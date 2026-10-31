import { writeFileSync } from 'node:fs';
const charts = [];
const add = (kind, title, caption, spec) => charts.push({ id: kind, title, caption, spec: { kind, ...spec } });
add('stream', '资金逐步从债券转向股票', '演示数据 · 色带厚度表示资金量。', {
  x: 'month', series: 'asset', value: 'amount', xType: 'category', unit: '万元',
  rows: [[20,48,12],[24,46,14],[30,42,15],[38,38,16],[44,32,16],[52,26,18],[58,24,20],[64,22,20]].flatMap((values,i) => values.map((amount,j) => ({ month: `${i+1}月`, asset: ['股票','债券','现金'][j], amount }))),
});
add('stacked-rungs', '四个账户的资金分别放在哪里', '演示数据 · 柱顶是总额，颜色区分资产。', {
  x: 'account', series: 'asset', value: 'amount', unitValue: 1, unit: '万元',
  rows: [[18,11,7],[14,9,5],[9,7,6],[5,4,2]].flatMap((values,i) => values.map((amount,j) => ({ account: `账户${i+1}`, asset: ['股票','债券','现金'][j], amount }))),
});
add('dot-heatmap', '消息集中在午间和尾盘', '演示数据 · 圆越大，消息越多。', {
  x: 'hour', y: 'day', value: 'count', unit: '条消息',
  rows: [[2,5,12,18,11,14,9,3],[1,4,8,16,12,18,13,4],[0,5,11,24,18,16,11,2],[2,3,9,15,16,14,13,3],[1,5,14,20,22,18,8,1]].flatMap((values,i) => values.map((count,j) => ({ day: ['周一','周二','周三','周四','周五'][i], hour: `${j+9}时`, count }))),
});
add('funnel', '从 4,200 只股票缩到 310 只候选', '演示数据 · 条件由本次任务决定。', {
  x: 'stage', value: 'count', unit: '只',
  rows: [['起始股票',4200],['成交活跃',1900],['估值合适',960],['财务合适',540],['候选名单',310]].map(([stage,count]) => ({stage,count})),
});
add('category-links', '24 只候选股票，分别属于哪些行业', '演示数据 · 左侧是名单，右侧是行业和数量。', {
  item: 'stock', group: 'sector',
  rows: [['消费',6],['科技',5],['金融',4],['医药',4],['能源',3],['工业',2]].flatMap(([sector,n]) => Array.from({length:n},() => ({sector}))).map((row,i) => ({stock:`股票${String(i+1).padStart(2,'0')}`, ...row})),
});
add('outcome-tally', '100 段相似历史，后来发生了什么', '演示数据 · 同一段历史可以出现多个结果。', {
  x: 'outcome', value: 'count', total: 'samples', unitValue: 1, overlap: true,
  rows: [['第5天收盘高于起点',61],['期间回撤超过3%',26],['先跌后涨',42],['回到起点附近',35]].map(([outcome,count]) => ({outcome,count,samples:100})),
});
add('paired-rungs', '调整前后，五类资产分别占多少', '演示数据 · 浅蓝为调整前，蓝色为调整后。', {
  x: 'asset', before: 'before', after: 'after', unitValue: 1, unit: '万元',
  rows: [['股票',31,38],['债券',22,27],['黄金',16,22],['商品',13,16],['现金',6,9]].map(([asset,before,after]) => ({asset,before,after})),
});
add('rank-race', '哪些行业的基金规模领先', '演示数据 · 可播放或选择年份，颜色始终对应同一行业。', {
  time: 'year', item: 'sector', value: 'amount', unit: '亿元',
  rows: [[42,38,30,26,18,14],[44,48,32,30,20,15],[49,58,36,33,23,19],[55,72,40,38,27,24],[62,86,46,43,35,29]].flatMap((values,i) => values.map((amount,j) => ({year:String(2022+i),sector:['消费','科技','金融','医药','能源','工业'][j],amount}))),
});
add('spectrum', '这套方案更偏成长，换手较低', '演示数据 · 大点是当前方案，小点是三个对照方案。', {
  label: 'plan', focus: '当前方案',
  dimensions: [
    {field:'risk',min:0,max:100,left:'低波动',right:'高波动'},
    {field:'growth',min:0,max:100,left:'价值',right:'成长'},
    {field:'concentration',min:0,max:100,left:'分散',right:'集中'},
    {field:'turnover',min:0,max:100,left:'低换手',right:'高换手'},
  ],
  rows: [['当前方案',74,80,40,22],['方案甲',22,35,65,58],['方案乙',48,50,25,80],['方案丙',60,67,82,40]].map(([plan,risk,growth,concentration,turnover])=>({plan,risk,growth,concentration,turnover})),
});
add('tick-donut', '股票占 37%，其余分散配置', '演示数据 · 一格表示 1%，四类资产合计 100%。', {
  x:'asset',value:'weight',unitValue:1,unit:'%',
  rows: [['股票',37],['债券',28],['黄金',21],['现金',14]].map(([asset,weight])=>({asset,weight})),
});
const barcodeRows = Array.from({length:90},(_,i)=>({day:new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10),amount:Math.round(38+Math.abs(Math.sin(i*.77))*55+Math.abs(Math.cos(i*.17))*26)}));
for(const [i,amount] of [[14,199],[44,208],[76,197]])barcodeRows[i].amount=amount;
add('barcode', '三次成交明显放大，其余较平稳', '演示数据 · 每点是一天的成交额，标出三次高点。', {
  x:'day',value:'amount',xType:'time',unit:'亿元',highlights:[14,44,76].map(i=>barcodeRows[i].day),rows:barcodeRows,
});
add('bubble-ledger', '科技与医药的项目逐年增加', '演示数据 · 圆面积表示项目数，虚线表示资料不完整。', {
  x:'sector',y:'year',value:'count',status:'coverage',event:'event',unit:'项',
  rows: Array.from({length:8},(_,i)=>['银行','消费','科技','医药','能源','工业'].map((sector,j)=>({
    year:2019+i,sector,count:i===0&&j===2?null:Math.round(4+(i+1)*(j===2?4:j===3?3:1.2)+Math.sin(i+j)*3),
    coverage:i===0&&j===2?'missing':i===7&&j===4?'partial':'observed',
    event:({2:'演示项目扩展',5:'演示统计范围更新',7:'能源资料尚未齐全'})[i]??'',
  }))).flat(),
});
writeFileSync(new URL('../examples/composition-fixtures.json', import.meta.url), JSON.stringify({ provenance: {kind:'demo', note:'全部为虚构展示数据，不是研究结论。'}, charts }, null, 2) + '\n');
console.log(`Built ${charts.length} fictional composition fixtures.`);
