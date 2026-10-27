# 报告文字精简与模板规则

2026-10-24。当前 Sesame 已加载 `sesame/reports 3.2.7`；《黄金下周走势研究报告》由真实 Sesame Agent 原位更新至 v11。

## 修改

- 报告提示词、写作指南、回测指南及设计指南统一要求：每句话提供结论、依据、关键数字、判断条件或下一步。
- 删除默认的质量、覆盖、局限章节安排，取消小样本一律追加免责声明的要求。正文、图注、元信息、树节点及折叠区一起精简，空泛文字不转移到折叠区。
- 有用的边界写成实际样本数、影响、确认条件与待观察事项；原有来源、数据时点、业务触发和失效条件保留。
- `report-kit.js` 的默认折叠标题由“方法、限制与来源”简化为“方法与来源”；空项继续按原行为省略。
- 插件版本、锁文件和 inventory 同步。未增加依赖或改动宿主接口。

源码在 `E:/brief2great/sesame/sesame/plugins/api-v1`。本次共 10 个文件：`packages/reports/prompt.md`、`skills/report-writing/SKILL.md`、`skills/report-writing/backtest.md`、`skills/report-design/SKILL.md`、`skills/report-design/visual-design.md`、`assets/report-kit.js`、两个版本清单，以及根目录的锁文件和 inventory。其中 skills、assets 和版本清单均位于 `packages/reports/`。

工作区已有其他修改，本次起点与终点的精确文件内容保存在 `before/` 和 `after/`，差异及哈希见 `changes.patch`、`change-index.json`。

## 当前报告

同一报告、artifact、文件及五个固定绑定保持不变。v9 删除“时效与覆盖”章节；v10 通篇清理套话；v11 仅刷新统一模板的折叠标题。独立检查确认 v11 的作者脚本及其他组件与 v10 一致。

报告保留五个分析章节、默认行情蜡烛图和四棵决策树。64 个节点、60 条分支、44 个叶子及条件关系与精简前一致；“尚未观察 / 信息不足”统一缩短为“待确认”。业务价格与连续收盘判断保留。

## 验证

- 报告模板与 inventory 的 9 项针对性测试通过。
- 锁文件、inventory、JavaScript 语法和 diff 空白检查通过。
- 正式插件接口先 test 后 update，3.2.7 为 ready；模型、任务状态与报告版本在安装前后一致，回执见 `plugin-update-3.2.7.json`。
- 通过真实数据桥在 Chromium 以 1000px 和 390px 验证 v11：没有页面溢出、数据桥诊断或运行时错误；方法区默认折叠，新标题正确；固定绑定与树结构核对通过。证据见 `published/verification.json`。
- 本次主要修改文案；PDF/PNG 导出在上一轮 v8 已验证，此次未重跑导出。

报告 HTML 与元数据见 `report-v11.html`、`report-v11.json`；桌面打开状态见 `live-verification.json`。
