# 报告导航测试适配

仅修改 `mt5agent/tests/` 下的五个既有测试：`report-navigation-ui.cjs`、`report-library-ui.cjs`、`report-task-navigation-ui.cjs`、`report-export-ui.cjs`、`ui.cjs`。进入目录和从报告返回目录时，使用真实用户入口“打开目录”，然后选择 Research / Strategy；英文流程使用 Open catalog。不依赖目录占据标签栏。

原业务断言保留。基于实际页面诊断更新一处过时的精确引用文案为 `@Published artifact snapshot · v1`；DOM 证实它直接显示在 message-body 内，未被折叠。新建文件夹后等待提交弹窗关闭，再执行下一项 F2 操作，修复测试中的异步时序假设。未修改产品代码。

验证结果：五文件 `node --check` 与 oxlint 通过。`report-navigation-ui` 在首轮目录入口构建通过；统一前端构建包含“目录不占标签”、透明加号、顶部控件避让及思考过程后，`report-library-ui` 和 `report-task-navigation-ui` 完整通过。后两项均无页面脚本错误，任务回归覆盖 main / agent / workflow 的报告和工作过程切换、重复打开、刷新保留和无额外窗口。首轮加号被全局控件拦截的日志保留，最终重跑正常点击通过，没有使用 force 绕过。

全部 fixture 和临时文件使用 E 盘 TEMP/TMP，没有真实模型、账户或交易请求。按任务范围未执行完整 `ui.cjs` 或 Electron 导出测试；两者已做入口适配及静态校验。

`verification.json` 记录五文件 SHA-256、运行范围和日志；`report-reference-diagnostic.json` 是标题问题的实际 DOM 证据；`report-library-*.png` 和 `task-*.png` 是最终截图。首轮失败及诊断日志保留，不作为最终通过证据。
