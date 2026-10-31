# 空标签目录回退交付

首次打开、关闭最后标签和恢复空标签布局都会显示目录。目录不占标签栏；加号仍只切换到目录。报告或任务已有有效选中标签时继续显示该标签，保存的报告选择刷新后仍保留。Research / Strategy 只在目录中可见。

删除 workspace-store 的 `catalogOpened` 开关及其保存/恢复分支，以 `CATALOG` 作为空布局回退；ReportDock 用没有有效当前标签的单一条件显示目录。持久化只恢复真实视图字段，保留主题与账户窗口隔离。顶部控件避让代码与 before 基线比较一致。未增加依赖、迁移层或产品接口。

修改范围：workspace-store.ts、report-dock.tsx 的目录条件、workspace-store-persistence.test.js、catalog-tabs-ui.cjs、dock-tabs-ui/fixture.tsx 与 run.mjs，以及 DESIGN.md 的目录段。七文件基线在 before/，行为计划在 PLAN.md。

验证：store 新断言先复现 3 项失败，修复后 10/10 通过；独立 Dock 组件和真实生产 CSS 的 5 组场景通过，覆盖关闭末标签显示目录、加号不增加标签、焦点恢复、键盘、透明加号、明暗主题与宽窄屏。指定文件 lint 和 JS 语法检查通过，catalogOpened 无残留引用。日志、截图和源码 SHA-256 在本目录。

未运行全局 build/dist、未部署或访问真实应用。catalog-tabs-ui.cjs 已更新初次目录、关闭末标签及空布局刷新的整页断言，等待主任务统一构建后验证。现阶段证据不声称整页 UI 已复验。
