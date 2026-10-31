# 思考状态区与 12 种曲线加载动效

已更新当前打开的 Sesame，沿用原有 E: 数据与运行实例，宿主未重启。

## 最终显示规则

- 思考只在对话底部状态区显示，正文中不再重复出现思考块。
- 流式时显示最新真实思考内容，非流式时保留最近思考标题；没有标题则取首段首句。
- 没有思考时文字只显示本轮用时，不显示请求模型、等待模型、模型正在思考等占位文案。
- 加载曲线跟随整轮活动状态：等待、重试、调用工具、思考和正文输出期间都显示，结束后停止。修复了最初仅在思考流式期间显示曲线的遗漏。
- 计时覆盖同轮内部续接，真实用户新输入重新开始；结束后冻结，刷新能恢复。
- 删除普通/思考/详细模式菜单、默认设置、快捷键及偏好读取，固定普通展示；旧设置不再改变展示。
- 原有工具独立折叠和每轮完成后收起中间过程保留。

## 曲线

使用用户截图的 12 种：Original Thinking、Thinking Five、Thinking Nine、Rose Orbit、Rose Curve、Rose Two、Rose Three、Rose Four、Lissajous Drift、Lemniscate Bloom、Hypotrochoid Loop、Three-Petal Spiral。

每个用户轮次随机一种，流式更新、等待/工具阶段、切换标签及刷新保持一致。26px SVG 随文字颜色适配主题，支持减少动态效果、离屏/后台暂停和卸载清理。Hypotrochoid 的周期跳动已用连续参数修复。

参考 [math-curve-loaders](https://github.com/Paidax01/math-curve-loaders)，固定提交 `70f4e00a6d452532039ff7c2ccb4c379ec90c772`。按公开数学公式独立实现；原仓库未声明许可证，未打包其 gallery 程序。来源说明见项目 `THIRD_PARTY_NOTICES.md` 及本目录 `reference/`。

## 验证

- 41 项单元测试通过，包含摘要提取、真实输入边界、计时冻结、工具分组、12 款几何、随机缓存和循环连续性。
- 7 套界面检查共 71 项/场景通过：intent 16、status 9、transcript 15、completion 11、focus 3、view-settings 11、curve-loader 6。
- 最新“等待时也显示曲线”修正后重新跑了 intent 和 status，均通过。几何最终修正有连续性单测和 loader 界面检查，其余行为沿用此前通过的回归结果。
- TypeScript 和构建通过；lint 仅有原来的 `event-stream.tsx` Fast Refresh 警告；构建仅有原来的包体积提示。
- 回归测试使用受控数据，未发起模型/研究请求。真实运行实例验证了新资源、原数据和活动任务；部署时主会话仍处于无思考内容的活动状态，确实显示一条曲线和计时。

## 当前运行与留档

- 宿主 PID `10648`，更新前后一致。
- 前端 `/_app/index-DCks7g8H.js`，样式 `/_app/index-ByhA_v5A.css`。
- 页面 `http://127.0.0.1:61662/`。
- 运行目录 `E:/brief2great/sesame/mt5agent/output/desktop-run-20261023-Ghxz3z`。
- 验证保留 58 个插件、原模型与配置、历史会话和报告、暂停任务；2 个活动运行未因更新中断。
- 最后快照：主会话 active=true、live=false、curve=true；没有旧方块矩阵，没有正文思考块。

`task.patch`、`change-manifest.json` 和 `baseline/` 保存本次独立差异及修改前文件；未新建混入既有工作区改动的 Git 提交。前端备份在 `running-ui-backup-*`。测试日志、截图、部署记录均在本目录。
