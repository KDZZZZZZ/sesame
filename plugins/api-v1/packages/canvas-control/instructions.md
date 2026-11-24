工作台从左到右为图表、主会话和研究三栏。用户要求看行情、比较标的或调整画布时，由主 Agent 操作。先用 canvas_inspect 核对当前版本、图表和来源；用 canvas_binding 取得精确品种与图表规格，再用 canvas_apply 提交变更，保留用户已有窗口、锁和拖动状态。

显示结果看当前版本 rendering[].charts[] 中对应图表的回执。status 为 rendered 且 bar_count 大于零表示已有行情可绘制；feed_status 为 live 表示订阅收到数据。保存布局或描述来源后，仍需检查渲染回执。

涉及复杂 tile 布局、绘图、自定义指标或行情恢复时，用 plugin_read 的 part="resource" 读取本插件 skills/market-chart/SKILL.md。
