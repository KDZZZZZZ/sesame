# 行情宽视窗历史回填修复

依据 `chart-viewport-before.json/png`：黄金 H1 图表 500 根，1172px 图窗（1112px 绘图区），左侧大量空白。来源“不证明历史区间完整”的提示本身不是拒绝渲染的原因。

## 根因与最小改动

- `mt5agent/modules/frontend/src/features/trading/price-chart.tsx:135`：原代码只要右侧仍跟随最新，就给缓存发送 `onWindow(null)`，丢失宽视窗左侧范围；`getVisibleRange()` 又会裁到已加载时间。现在使用已有绘图坐标转换，在原绘图时钟内保留逻辑边界（包括空白区），最新跟随和实际视窗范围各自保留。更新数据后安排一次合并的 rAF 范围通知，涵盖之前被 `updating` 屏蔽的重排。自动回填不依赖最近 1.5 秒的鼠标/键盘手势。
- `mt5agent/modules/frontend/src/features/canvas/use-chart-data.ts:128`：原历史加载遇第一张非空页即停止，未确认视窗缓冲是否够用。现在继续到已有 `needsEarlier()` 为 false，保留每次最多 8 页的边界，以及原取消、series/scope、时间 authority、分页和缓存预算守卫。8 页有数据但仍不足时明确提示“历史视窗尚未填满”，避免误称“没有 K 线”。
- 独立复核发现并复现了“最新”按钮边界：最新 500 根数据引用不变时，没有 React 数据更新必然清除 `latestRequested`，此后缩放通知会被拦截。按钮现在显式触发既有 `chart-data` 更新来完成跳转，无需等新 tick。新增回归实际点击按钮，并断言数组引用未变、后续宽视窗仍成功回填。
- 未修改缓存淘汰算法、来源描述、订阅健康状态、冻结资料、绘图绑定或宿主接口。

## 红绿与验证

新增 `tests/chart-viewport-history-electron.test.js` 使用真实 Electron、Lightweight Charts 和 `useChartData`，仅接入隔离 fixture：

- 修前：500 根尾部设置逻辑范围 `{from:-600,to:505}` 后，实际 `onWindow` 为 null，目标断言失败。
- 修后：宽视窗持续补足多页实际墙时历史，保留来源不完整提示、右端时间和缩放宽度。
- 缩回最新再展开已有缓存，不增加 provider 查询。
- 无鼠标手势的窗口宽度变化会补足显示范围。
- 8 个空页后停止，没有无限重试。
- 每个请求保留原 instrument/spec 和 wall-time authority；不使用当前 UTC 猜券商时间。

验证通过：

- 新视窗 Electron 回归 1/1（包括“最新”按钮反例的最终重跑 25.898s，fixture 使用独立 Vite cacheDir）。
- 完整 chart-data-lifecycle Electron 回归 1/1（116.353s）：超过两万根历史、多图共享请求、隐藏取消、64MB 预算、不完整来源和指标预热。驱动增加最多 4 次手势用于跨越已经缓存的数据，原 >20k 目标和预算断言保持。
- chart-data-cache + cold chart-data-history 19/19。
- price-chart-render-ui：颜色、逐 tick 更新、窗格/缩放保持、扩展时间轴等通过。
- `npx tsc -b modules/frontend`、两变更源文件 oxlint、`git diff --check`、新测试 `node --check` 通过。

范围：仅本地源码和隔离测试。没有构建、部署、读取活动子库、修改真实画布或执行行情业务。

独立变更包：`chart-viewport-delta/chart-viewport-only.patch`（SHA256 `740cef87b616e12f5be8527bb5586e66f52f368749f2049e21d869d92e6966db`），仅本轮两源码与两测试；`git apply --reverse --check` 已通过。`manifest.json` 说明基线是按本轮精确 hunk 反向重建的修改前共享脏文件，而非 Git HEAD，并提供 before/after 完整快照与规范化 LF 摘要，保留所有此前绘图、缓存与来源恢复改动。
