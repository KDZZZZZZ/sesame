# Sesame 会话展示的 GUI 参考

本次按用户纠正重新研究实际 Web GUI，不以 Codex/Claude Code 的终端界面作为视觉依据。已查看官方交互演示、操作折叠控件并读取组件源码；本次仅调研，没有再次修改 Sesame。

## 主参考：assistant-ui

| 部分 | 官方 GUI 演示 | 适合借鉴的行为 |
| --- | --- | --- |
| 思考内容 | https://www.assistant-ui.com/elements/reasoning | 独立折叠标题，内容限高滚动，流式跟随新内容，用户向上滚动后暂停跟随；支持 ghost 无框样式。 |
| 工作过程 | https://www.assistant-ui.com/elements/run-activity | 公开过程和工具放在一个折叠区，最终回答留在外面；折叠时只显示最新活动；没有内容时没有空折叠按钮。 |
| 工具分组 | https://www.assistant-ui.com/elements/tool-group | 相邻工具调用归成一组，默认折叠，显示数量和活动标识；ghost 无边框、无背景。 |

建议 Sesame 以这套 GUI 为主要参考，沿用现有字体、颜色和“结束后收起”的用户约定。其默认手动状态策略与 Sesame 的约定并非完全相同：assistant-ui 的 Reasoning 一旦手动切换就保留用户选择，结束并不强制覆盖；应用时应明确保留用户此前要求的完成收起，而不是宣称直接搬全部默认值。

源码固定版本：`assistant-ui/assistant-ui@64c0843833927e103052b41e9c2ce1783d221c68`，commit 时间 2026-10-25T00:26:53Z。MIT 许可证已核实，许可证和以下三个组件的只读副本位于 source/。

- [reasoning.tsx](https://github.com/assistant-ui/assistant-ui/blob/64c0843833927e103052b41e9c2ce1783d221c68/packages/ui/src/components/react/assistant-ui/elements/reasoning.tsx)：ghost 样式、受控/手动/流式开合、200ms 动效、限高和底部跟随。
- [run-activity.tsx](https://github.com/assistant-ui/assistant-ui/blob/64c0843833927e103052b41e9c2ce1783d221c68/packages/ui/src/components/react/assistant-ui/elements/run-activity.tsx)：过程区域与独立最终内容；折叠时的最新活动；空内容分支。
- [tool-group.aui.tsx](https://github.com/assistant-ui/assistant-ui/blob/64c0843833927e103052b41e9c2ce1783d221c68/packages/ui/src/components/react/assistant-ui/elements/tool-group.aui.tsx)：默认折叠、计数/活动状态、ghost 变体、展开时滚动锁定。

GUI 证据：reasoning-official-demo.png、run-activity-official-demo.png 和 browser-check.json。两页均是真实官网；Reasoning 已点击展开。Run activity 官网自动播放会更新折叠状态，因此截图是播放中的瞬间，未把它当作完整生命周期测试。这里展示的是官网样式，并非 Sesame 已实施的新版截图。

## 次要参考

[Vercel AI Elements Reasoning](https://elements.ai-sdk.dev/components/reasoning) 有现成流式展开、完成收起和多段合并示例。其 [Tool](https://elements.ai-sdk.dev/components/tool) 默认展开完成结果，与用户希望完成工具收起不一致，不照搬这个默认值。官方仓库声明正在迁往 shadcn/ui，因此适合参考已有实现，不建议为当前 UI 任务引入整套运行时。

实际应用 Open WebUI / LibreChat 的源码对照见 open-source-gui.md。不要把其他产品所有默认行为当成 Sesame 必须遵循的标准。
