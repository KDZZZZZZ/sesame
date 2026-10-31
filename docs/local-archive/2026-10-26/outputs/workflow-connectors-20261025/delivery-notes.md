# Sesame 前端修正记录 · 2026-10-25

## 工作流连线

撤掉分段折线及多段曲线绕行。普通连接采用用户提供的 Flowchart 示例的三次贝塞尔曲线和控制点距离公式；同层连接按水平方向应用该公式。跨层长连接保留侧面端点，使用一条连续三次曲线避开中间卡片。分叉、汇合及双向连接使用分开的端点。卡片布局、颜色、节点选择和关系高亮保持原样。

修改文件：

- `E:/brief2great/sesame/mt5agent/modules/frontend/src/features/report-dock/run-graph-layout.ts`
- `E:/brief2great/sesame/mt5agent/tests/run-graph-layout.test.js`

本地提交：`aeab697` — `fix: keep workflow connectors distinct and smooth`。提交只包含以上两个文件。

验证：13 项布局及连线测试通过；4 组真实 RunWorkspace 界面验证通过，覆盖三研究员汇总、分叉汇合、双向回连、多条跨层连接；检查了卡片位置、路径与卡片相交、选择和高亮。前端类型检查、构建及 lint 通过。lint 保留原有 event-stream.tsx Fast Refresh 警告；构建保留原有体积提示。

现有完整 `tests/run-workspace-ui.cjs` 在旧权限测试 fixture 处返回 403（缺少宿主构造的 principal/origin lineage），未修改该无关逻辑，不能声称整套工作流端到端测试通过。当前连接功能使用独立真实界面 fixture 验证，没有发起研究或交易。

## 同次前端更新中已完成的其他修正

- 英文语言下显示 `Context compacted`，进行中和中断状态也已翻译。中文仍显示原文；6 项语言切换界面验证通过。改动位于 reply-segments.tsx 与 report-runtime/locales.js，本次连线提交未包含这些有其他在途改动的文件。
- 12 种数学曲线：移除完整背景轨迹、整体旋转与呼吸，保留沿固定曲线运动的点，速度为 1.5 倍；修正随时间加速与曲线方向漂移。8 项几何/时间测试及 6 项浏览器检查通过。相关组件和测试原本属于工作区未提交文件，本次连线提交未包含。

## 当前运行验证

2026-10-25 10:23:44 UTC，当前打开的 Sesame 已加载 `/_app/index-DFrNBYtd.js`。主进程仍为 PID 33176，未重启宿主或更改插件。

- 程序：`E:/brief2great/sesame/outputs/ultra-lifecycle-status-20261025/bundle-fFCcHk/package/win-unpacked/Sesame.exe`
- 数据根目录：`E:/brief2great/sesame/mt5agent/output/desktop-run-20261023-Ghxz3z`
- 实际打开的工作流验证：4 个节点、3 条关系；卡片位置与输入草稿状态保留。
- 界面证据：`live-workflow.png`、`three-researchers-one-reviewer.png`、`branching.png`、`reciprocal.png`。
- 机器可读结果：`live-verification.json`、`graph-ui.json`。

新产物和验证数据均保存在 E 盘。
