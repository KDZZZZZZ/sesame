# Claude 桌面 GUI 参考：本地观察与开源组件

核对日期：2026-10-25。仅调研与界面观察，未修改 Sesame 产品代码。

## 推荐参考

[Open Claude UI](https://github.com/Caho1/open-claude-ui) 提供 Claude Desktop 设计分析和 React/CSS 参考实现；仓库页面显示约 1.4k stars，许可证为 MIT。它是组件与分析资料，不能据此称为完整 Claude Code Desktop 的一比一应用。

- [会话与输入演示](https://openclaudeui.com/docs/components/conversation)：思考折叠、输入框、斜杠指令、模型菜单和工具卡片。
- [2.0 组件演示](https://openclaudeui.com/docs/components/v2)：输入框底栏和模型强度选择。
- [思考源码](https://github.com/Caho1/open-claude-ui/blob/main/code-examples/ThinkingAccordion.tsx)：展开值为 `isThinkingLive || userExpanded`，生成时展示正文；初始用户展开值为 false，因此完成后回到折叠。不是用“请求模型”等状态字符串拼出正文。
- [许可证](https://github.com/Caho1/open-claude-ui/blob/main/LICENSE)。

独立浏览器已实际打开演示，切换“已完成”后标题变成 Thought for 8.4s，正文网格收起。截图与运行结果保存在 `open-claude-ui/`。这验证的是演示组件，不是官方桌面的完整动态过程。

## 本地 Claude Code 实际观察

运行版本：3.6556.2。通过 computer-use 查看当前已有会话，未发送新请求，临时展开和展示模式均已恢复。

- 正文无重复 Agent 头像，用户消息右对齐浅灰气泡。
- 已完成的连续工具按阶段压成一行灰色摘要；点击后才展开浅色细边框圆角列表，列表内工具可继续展开。
- 输入框低矮且呈胶囊形，`+` 在左侧，模式、模型和强度选择放在下方。
- 回复末尾使用小号操作图标，包括复制。
- 顶部标题菜单提供 Normal / Thinking / Verbose。
- 现有历史切到 Thinking 未出现可辨认的真实思考正文，不能声称核实了本地思考卡或自动收起过程。

## 对 Sesame 的适用判断

采用本地 CC 的紧凑分组与排布作为视觉依据，Open Claude UI 用于参考实现、尺寸和过渡。其分析版本以 2.x 为主，与本地 3.x 有差异；演示中的常驻卡片外框和复制引用按钮不能直接当成本地最新样式。

此前 cdesktop 属于完整工作台布局参考，Open Claude UI 更直接对应本次组件样式与交互需求。真正的逐像素一致仍需在实现后逐项对照本地界面验证。
