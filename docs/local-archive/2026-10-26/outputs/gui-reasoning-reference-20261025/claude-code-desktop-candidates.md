# Claude Code 桌面界面候选补查

调查边界：只读核对官方仓库、README、有限组件源码与许可证；没有安装、运行项目，也没有访问 Sesame 或本地 Claude。未下载整个仓库。本轮只记录 cdesktop 之外的候选。

结论：没有找到足以证明比 cdesktop 更接近官方 Claude Desktop **Code 工作页**的完整应用复刻。以下两个项目有可核实的桌面工作界面和组件实现，但都不能称为一比一复刻。主任务另行核实的 OpenClaudeUI 直接面向 Claude Desktop 设计复用，应优先于这些通用桌面应用；本记录没有重复调查 OpenClaudeUI。

## 1Code：可复用思考与工作区行为，不是 Claude Desktop 外观复刻

- 官方仓库：[21st-dev/1code](https://github.com/21st-dev/1code)，核对提交 `9f1bc76fa4372c18c565b5a4f8daf38ae3595f0e`。
- [README](https://github.com/21st-dev/1code/blob/9f1bc76fa4372c18c565b5a4f8daf38ae3595f0e/README.md) 自称 **Cursor-like UI**；有实时工具调用、可视化差异、计划模式、工作树、集成终端、子 agent 详情侧栏。它是实际编程 GUI，不是把终端放进窗口，但没有声称还原官方 Claude Desktop Code 页。
- 官方演示资源：[整体界面 GIF](https://github.com/21st-dev/1code/blob/9f1bc76fa4372c18c565b5a4f8daf38ae3595f0e/assets/cursor-ui.gif)、[计划模式 GIF](https://github.com/21st-dev/1code/blob/9f1bc76fa4372c18c565b5a4f8daf38ae3595f0e/assets/plan-mode.gif)。已核实资源路径及 README 引用；本轮未成功通过工具播放，不能以此声称视觉相似度已确认。
- 最有用的源码：[agent-thinking-tool.tsx](https://github.com/21st-dev/1code/blob/9f1bc76fa4372c18c565b5a4f8daf38ae3595f0e/src/renderer/features/agents/ui/agent-thinking-tool.tsx)。第 44–61 行根据工具状态和对话状态判定正在流式输出，初始 `useState(isStreaming)`，从流式转为非流式时调用 `setIsExpanded(false)`。这直接证明“进行中展开、结束收起”，不是从动画猜测。
- 同文件第 78–94 行处理滚动和实际 `part.input?.text`；第 143–160 行展示文本、限制流式区域高度并处理溢出。**完成时收起是强制状态转换，不能把它描述成始终保留用户手动展开偏好。**
- 工作区结构：[details-sidebar.tsx](https://github.com/21st-dev/1code/blob/9f1bc76fa4372c18c565b5a4f8daf38ae3595f0e/src/renderer/features/details-sidebar/details-sidebar.tsx)、[agents-sidebar.tsx](https://github.com/21st-dev/1code/blob/9f1bc76fa4372c18c565b5a4f8daf38ae3595f0e/src/renderer/features/sidebar/agents-sidebar.tsx)。
- [许可证](https://github.com/21st-dev/1code/blob/9f1bc76fa4372c18c565b5a4f8daf38ae3595f0e/LICENSE)：Apache-2.0。可作为组件代码复用候选，保留适用的许可证与声明。仓库页面显示已于 2026-07-07 归档，故更适合有限源码参考。

## CodePilot：桌面助手工作区参考，当前许可证有限制

- 官方仓库：[op7418/CodePilot](https://github.com/op7418/CodePilot)，核对提交 `1ae6d76de6993377dab961eacf04927babd99eb1`。
- [README](https://github.com/op7418/CodePilot/blob/1ae6d76de6993377dab961eacf04927babd99eb1/README.md) 描述 Electron + Next.js 多模型桌面助手，具有 Code / Plan / Ask 模式、文件与浏览器工作区、分栏会话；没有一比一还原官方 Claude Code Desktop 的证据。
- 官方仓库截图：[聊天界面](https://github.com/op7418/CodePilot/blob/1ae6d76de6993377dab961eacf04927babd99eb1/apps/site/public/screenshots/en/chat-window.webp)、[文件树会话](https://github.com/op7418/CodePilot/blob/1ae6d76de6993377dab961eacf04927babd99eb1/docs/exec-plans/screenshots/chat-stabilize-smoke-5-session-with-filetree.png)。路径已核实；图片打开超时，本轮没有做像素级外观判断。
- 思考组件：[src/components/ai-elements/reasoning.tsx](https://github.com/op7418/CodePilot/blob/1ae6d76de6993377dab961eacf04927babd99eb1/src/components/ai-elements/reasoning.tsx)。第 71–73 行默认展开值为 `defaultOpen ?? isStreaming`；显式 `defaultOpen={false}` 可抑制默认打开。第 102–107 行处理流式自动展开，第 109–124 行处理结束后的定时自动收起。不能据此宣称所有调用位置默认相同，也不能宣称完整保留所有用户手动操作。
- 对话与工作区源码：[ChatView.tsx](https://github.com/op7418/CodePilot/blob/1ae6d76de6993377dab961eacf04927babd99eb1/src/components/chat/ChatView.tsx)、[MessageList.tsx](https://github.com/op7418/CodePilot/blob/1ae6d76de6993377dab961eacf04927babd99eb1/src/components/chat/MessageList.tsx)、[AgentRunPanel.tsx](https://github.com/op7418/CodePilot/blob/1ae6d76de6993377dab961eacf04927babd99eb1/src/components/layout/WorkspaceSidebar/AgentRunPanel.tsx)。
- [许可证](https://github.com/op7418/CodePilot/blob/1ae6d76de6993377dab961eacf04927babd99eb1/LICENSE)：当前为 **Business Source License 1.1**，附商业用途限制；列出的转换日期为 2029-03-16，转换后 Apache-2.0。当前不应当作无商业限制的开源代码直接搬进 Sesame。可以参考交互与布局，代码复制需先核对适用授权。

## 已排除的近名项目

| 项目 | 官方证据与排除原因 |
| --- | --- |
| [Yehonatan-Bar/ClaUI](https://github.com/Yehonatan-Bar/ClaUI) | README 明确是 VS Code 扩展；有真正的消息、工具、流式文本与 agent 层级组件，但不是官方桌面 Code 页复刻。核对提交 `78af689a37988d36e7eb46b3740b42df967c5a23`。 |
| [AlvaroFalcon/clautron](https://github.com/AlvaroFalcon/clautron) | README 与源码是 agent dashboard、任务规格、工作流和审查中心；没有足够官方截图证明接近目标。核对提交 `a202b7240d25271e23b1013a4c0b63f36c5fe41f`。 |
| [ref/claui.app](https://github.com/ref/claui.app) | README 明确使用 xterm.js 承载真实 Claude CLI；属于终端外壳，缺少目标所需的图形化对话过程组件。 |
| [joemsak/claude-code-desktop](https://github.com/joemsak/claude-code-desktop) | 项目定位是原生 macOS 终端复用器，不是官方 Code 页的图形组件复刻。 |

建议用途：把 1Code 的思考状态处理作为行为参考；CodePilot 只作次要工作区对照。外观应以主任务核实的官方本地界面及 OpenClaudeUI 为准，避免因为仓库名称含 Claude/desktop 就推断它复刻了目标页面。
