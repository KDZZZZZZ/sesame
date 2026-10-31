# 工作台边界滚动与尺寸调整

本地提交：`25422e6` — `fix: reveal workspace resize edges with held-arrow overscroll`

- 方向键在内容范围内自由滚动；到达正常边界时停住。短按多次不会进入空白，持续长按才允许越界。
- 四向额外留白为 160px，松键保持当前位置，返回内容时不再吸附。
- 行情图顶部、底部可以拖动调整整体高度；报告最右侧边界可以移入窗口再拖动宽度。沿用现有布局保存和手势锁定逻辑。
- 输入框、菜单、树、标签和尺寸分隔线保留自己的方向键行为；图表滚轮交互保留。
- 普通刷新、场景更新和视口变化不将留白中的位置强行吸回；初次打开仍保持原有内容对齐。

## 验证

- 25 项滚动与图表布局单元测试通过。
- 11 组真实前端交互测试通过，包含实际尺寸保存、宽屏三栏、快速拖动、取消、延迟加载与恢复、减少动态效果模式。浏览器异常、外部请求、模型请求和交易请求均为 0。
- 前端 TypeScript/Vite 构建通过；lint 无错误，仅保留原有 event-stream.tsx Fast Refresh 警告。
- UI 测试及运行窗口均确认加载 `/_app/index-DZkCK9ZE.js`，SHA-256 `b2146950ceef21a49315adda6882efd00838d738520384c64db609e12208fe35`。

## 已更新的运行窗口

- PID：33176；仅更新并刷新前端，后端进程继续运行。
- 原数据目录：`E:/brief2great/sesame/mt5agent/output/desktop-run-20261023-Ghxz3z`。
- 更新前后逻辑滚动位置均为横向 1135.333px、竖向 0px；未发送研究请求或变更插件。
- 证据：`ui-result.json`、`live-verification.json`、`live-workspace.png`；初次打开定位回归的复现另存 `default-alignment-regression.json`。

变更文件限于工作台滚动、图表高度手势、布局高度及相应测试。canvas.css 仅提交两条高度拖动光标规则；其他已有本地修改保持未提交。
