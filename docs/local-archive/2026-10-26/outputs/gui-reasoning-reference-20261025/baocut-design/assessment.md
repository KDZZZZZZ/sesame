# BaoCut Design：Claude Design 重建前端线索核实

核实日期：2026-10-25。范围仅公开资料与源码静态检查；未安装、构建、运行项目，未操作本地 Claude 或 Sesame。

## 结论

有实际可研究的前端实现，超过截图仿制或空 README。作者仓库是 [JimLiu/baocut](https://github.com/JimLiu/baocut)，目标是 Claude Design 的画布编辑器与设计系统编辑器，不是 Claude Code Desktop 的会话、思考、工具面板。应归为“从原应用脚本重建后移植的设计编辑器参考”。

“1:1”是作者对移植过程的描述，未获得独立的完整视觉或行为验证。这里不据此称其与当前官方界面完全一致。

## 来源与版本

- 引线：[AwesomeREA case](https://awesomerea.org/cases/)，仅作为索引；下列结论核对了作者仓库。
- 固定提交：[7aa049e82e1367da013b7aba80f0b79033fa04ad](https://github.com/JimLiu/baocut/commit/7aa049e82e1367da013b7aba80f0b79033fa04ad)，2026-10-11 22:19:54 UTC，`feat(design): add designs and design systems to sessions`。
- GitHub 路径历史接口返回的 design-runtime README 历史只有上述提交。没有找到 README 所对应的原版 Claude Design 发布号。
- [design-runtime README](https://github.com/JimLiu/baocut/blob/7aa049e82e1367da013b7aba80f0b79033fa04ad/packages/design-runtime/README.md) 写明来自 `src/design-type` 的 TypeScript 重建；保留原模块结构，以 `BaoCut:` 标出宿主适配。其记录含与原脚本核对的标识符修复，并报告 20,463 个原主页面函数中 19,111 个结构指纹完全匹配，同时承认 1,019 个结构不同的最内层函数未逐项审查。这是作者报告，非本次重复验证。
- [design-system-runtime README](https://github.com/JimLiu/baocut/blob/7aa049e82e1367da013b7aba80f0b79033fa04ad/packages/design-system-runtime/README.md) 明确原重建工程的测试、工具、笔记与证据没有迁入当前仓库。

## 已核对实际代码

固定提交的 Git tree 包含 `packages/design-runtime/src/` 663 个文件、`packages/design-system-runtime/src/` 253 个文件；不是只根据文档判断。

| 代码 | 已看到的实现 | Sesame 可参考用途 |
| --- | --- | --- |
| [Collapsible](https://github.com/JimLiu/baocut/blob/7aa049e82e1367da013b7aba80f0b79033fa04ad/packages/design-runtime/src/cds/components/collapsible.tsx) | 基于 Base UI 的折叠根节点、触发器、面板；箭头旋转、面板高度过渡、减少动态效果偏好 | 思考/工具折叠的基础动效与无框触发器；这里没有会话分组策略 |
| [Working label animation](https://github.com/JimLiu/baocut/blob/7aa049e82e1367da013b7aba80f0b79033fa04ad/packages/design-runtime/src/canvas/working-label-animation.tsx) | requestAnimationFrame 驱动标签位置、弹性跟随、扫动与停留；ResizeObserver 和 reduced-motion 处理 | 画布生成中状态的细节动效；不是 reasoning streaming 规则 |
| [Menu popup](https://github.com/JimLiu/baocut/blob/7aa049e82e1367da013b7aba80f0b79033fa04ad/packages/design-runtime/src/cds/menu/popup.tsx) | 弹层焦点、被动打开、鼠标/键盘输入与滚动条交互 | 插件/模型/命令菜单的成熟交互细节 |
| [Design-system popover](https://github.com/JimLiu/baocut/blob/7aa049e82e1367da013b7aba80f0b79033fa04ad/packages/design-system-runtime/src/ui/popover.tsx) | 弹层定位、焦点恢复、滚动渐隐、移动 sheet、覆盖态缩放与淡入 | 设置、选择器、层叠弹出面板 |
| [Canvas pan/zoom](https://github.com/JimLiu/baocut/blob/7aa049e82e1367da013b7aba80f0b79033fa04ad/packages/design-runtime/src/canvas/pan-zoom.tsx) | 保持指针锚点的缩放、视口平移、滚轮与触摸手势判别 | 报告决策树、自由画布的视口交互参考 |
| [Design editor main](https://github.com/JimLiu/baocut/blob/7aa049e82e1367da013b7aba80f0b79033fa04ad/apps/design-editor/src/main.ts) / [Design-system editor main](https://github.com/JimLiu/baocut/blob/7aa049e82e1367da013b7aba80f0b79033fa04ad/apps/design-system-editor/src/main.ts) | 导入运行时 CSS，安装 BaoCut host shim，实际调用两套 createRuntime 入口 | 证明组件接入真实编辑器入口；本次未验证运行结果 |

画布运行时采用两阶段安装、统一 runtime 绑定表，许多变量仍是 Dynamic。它不是可直接安装的独立组件库，抽取单个文件还需要拆除较多运行时耦合。

## 许可事实

[固定提交 LICENSE](https://github.com/JimLiu/baocut/blob/7aa049e82e1367da013b7aba80f0b79033fa04ad/LICENSE) 是 BaoCut Community License 1.0，2026-10-07，标明 source-available。允许个人研究、内部业务使用和内容创作；将代码用于向外提供的商业软件、SDK 或服务，条款列为需要单独书面商业许可。它不是 MIT/Apache 的无额外商业限制授权。

两份运行时 README 都写明保留了 Anthropicons 内嵌字体，分发许可待确认、以后替换。依赖的第三方许可证不等于对所有重建材料的整体授权。本次仅记录作者公开条款，没有对其权利链做独立审计。

## 本地证据

本目录保存 GitHub 仓库元数据、固定提交信息、完整路径树、README 路径历史、两份 README、LICENSE，以及 `source/` 内七个已读取源码文件。均为公开文本，未保存字体或二进制包。
