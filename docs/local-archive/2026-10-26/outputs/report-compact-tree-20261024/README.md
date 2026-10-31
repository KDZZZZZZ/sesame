# 紧凑横向决策树：实现与验证

完成：2026-10-24。当前运行 Sesame 已装入 `sesame/reports 3.2.5`，原《黄金下周走势研究报告》更新至 v8，并打开到条件情景部分。

## 改动

- 内置 `decision-tree` 改为用户选定的第 2 版：细竖线判断节点、小圆点结果叶子、灰色曲线分支、蓝色选中路径。
- 各种宽度都保留横向树。视口支持滚轮缩放、指针拖拽、触屏捏合与平移、双击实际尺寸、键盘移动与复位。
- 可见操作仅保留缩小、放大、全貌三个小图标；没有操作教程、百分比、重复路径摘要或配置面板。
- 修复边缘节点在鼠标聚焦后开始拖动时突然跳动的问题。
- 原 rows、字段映射、onSelect、chartselect、表格联动、销毁接口保持。没有修改宿主接口或引入依赖。
- 更新组件目录、Agent 提示及设计说明，版本、inventory 和包摘要同步。

源码主要文件：`packages/reports/assets/charts-decision.js`、`tests/decision-tree.test.mjs` 及 6 个相关文档。全部 12 个变更的精确原始字节及最终字节保存在 `before/`、`after/`；差异见 `changes.patch`，哈希见 `change-index.json`。原工作区已有较多未提交工作，此处按本次起点记录差异，未覆盖原有修改。

## 实际验证

- 41 项针对性测试通过，覆盖决策树、报告模板、图表集合、导出约定、行情蜡烛、配色、inventory 和锁文件；源码语法与 diff 空白检查通过。
- 真实 Chromium 验证滚轮位置锚定、拖拽不触发行选择、键盘操作、100% 字号、双指手势、打印恢复全树、尺寸/字体变化及销毁清理。
- 独立复核确认指针移动 10px 时节点跟随 10px，无聚焦跳动；没有运行时错误。
- 使用正式插件管理接口先 test 后 update，当前插件状态 ready；安装前后模型和原任务状态一致。见 `plugin-update.json`。
- 报告由真实 Sesame Agent 发布，保持同一 report、artifact、文件及五个固定数据绑定。作者初始化代码逐字相同，新版组件与源码精确一致。
- v8 在 1000px / 390px、light / dark 四种组合中均为 4 棵树、64 个节点、60 条边、44 个叶子；无页面溢出、缺失节点或运行时错误；默认蜡烛及价格轴继续正常。
- 当前桌面报告已打开 v8，最新 Agent 回复完成且无待处理消息。见 `live-verification.json`、`published/live-report-v8.png`。
- 从当前应用实际导出 PDF（10 页）及 PNG（1000 × 13251）。PDF 场景页经 Poppler 渲染复核，完整树与原情景表保留；PDF 文本与图片内容检查通过。见 `exports/`。

## 阅读尺度

大树首先显示全貌，可在交互报告中缩放阅读。PDF 保留可缩放矢量文字；PNG 是固定宽度的全貌截图，不保留交互。

验证入口：`published/verification.json`、`exports/verification.json`、`exports/content-check.json`。
