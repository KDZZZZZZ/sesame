# 默认行情蜡烛图

报告里的 OHLC 使用 `candlestick`。组件直接复用行情工作台已安装的 Lightweight Charts 及同一组主题色；实体、影线、价格轴、时间轴和十字线均由默认库绘制。不要在报告里重画 SVG 蜡烛、另做空心蜡烛样式或自行拼接坐标轴。图内不重复展示 logo，统一署名位于 Sesame 设置。

## 声明图表

把下面的内容块放入 `document.sections[].blocks`，并在 `report_publish.data` 中提供同名 `fixed-ohlc` 固定绑定。字段、单位和时区按本次真实结果填写；示例不是研究方法选择。

```json
{
  "type": "chart",
  "kind": "candlestick",
  "title": "研究标的 · H4",
  "data_id": "fixed-ohlc",
  "columns": ["time", "open", "high", "low", "close"],
  "options": {
    "time": "time", "open": "open", "high": "high", "low": "low", "close": "close",
    "digits": 2, "unit": "USD/盎司"
  },
  "takeaway": "填写本图实际支持的判断。",
  "source_note": "填写来源、固定时点、原始时区与实际范围。"
}
```

Report 自动加载本地行情运行时、共享主题和交互；无需先生成临时模板或复制资产，不提交 HTML、CSS、脚本或绘图回调。单图与多图使用同一内容入口。

## 字段与行为

| 选项 | 要求 |
| --- | --- |
| `chart.rows` 或 `chart.data_id` | 固定 OHLC 原始行或绑定；单图最多 2,500 条。保留原始金额字符串，坐标使用 Number |
| `time` | 时间字段名，默认 `time`，也可用 `x`。接受 ISO 日期/时间或 Unix **秒** |
| `open/high/low/close` | 四个价格字段名，默认同名。全缺失保留时间空位，部分缺失或高低范围矛盾报错，不补零 |
| `digits` | 显示精度，默认 2，范围 0–8；不更改原始值 |
| `height` | 可选图高；省略时采用所选通用样式的 chart_height，宽度跟随容器 |
| `unit` | 数值单位，显示于 OHLC 读数旁 |
| `overlays` | 可选已计算的价格列，最多 12 项 `{field,label,group?,style:"solid"或"dashed",visible?}`；按 group 切换，保留原价格单位 |

无时区的券商日期/时间保持原墙时标签，不按浏览器时区挪动。带 offset 的时间使用实际瞬时坐标，悬停保留原始标签；报告必须说明时间口径。重复时点需要先核对来源，不静默合并。

涨跌沿用 Report 的原生行情主题，明暗主题自动更新；普通主题蓝灰不覆盖涨跌。支持拖动、缩放轴、触控缩放和十字线，鼠标滚轮保持报告页面滚动。明细由报告表格提供，也支持键盘阅读。PDF/图片由报告的统一静态导出流程捕获 Canvas，交付前检查当前版本。Report 负责视图切换和组件资源释放。

价格叠加线只读取固定数据中的已计算价格列，不识别形态、不计算指标或目标。几何边界、趋势线或其他价格结果均可按任务选择；波动值、分数和概率不能直接放到价格轴。未运行的历史验证不因图上出现更多线条而变成已验证。
