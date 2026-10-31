# Claude 来源前端参考：核实结果

Sesame 的会话、思考折叠、工具过程和输入框，仍优先参考 OpenClaudeUI。新增项目分别覆盖生成式可视化、设计画布和新会话背景，没有核实到另一套更完整、可直接替代它的 Claude Code Desktop 会话组件库。

| 项目 | 已核实的来源与实现 | 对 Sesame 的用途 |
| --- | --- | --- |
| [OpenClaudeUI](https://github.com/Caho1/open-claude-ui) | 作者记录了 Claude 桌面资源分析与来源版本，提供实际会话组件、样式和动效。已检查 ThinkingAccordion，并在公开演示页验证进行时展开、完成后收起。MIT。 | 会话区、真实思考折叠、工具卡片、输入框与模型菜单的首选。 |
| [pi-generative-ui](https://github.com/Michaelliv/pi-generative-ui) | 作者从 Claude 会话导出的工具结果提取可视化规范，再重建流式 HTML 与图表展示。已读 [morph.ts](https://github.com/Michaelliv/pi-generative-ui/blob/main/.pi/extensions/generative-ui/runtime/morph.ts)：更新保留 DOM，新节点淡入，完成后顺序执行脚本。README 和 package.json 标注 MIT。 | 报告中的交互图表、流式可视化和 SVG 导出；并非桌面会话外壳。 |
| [BaoCut Design](https://github.com/JimLiu/baocut/tree/7aa049e82e1367da013b7aba80f0b79033fa04ad/packages/design-runtime) | 作者说明从 Claude Design 的 TypeScript 重建移植。核实了折叠组件、弹层、生成中标签、画布缩放和平移源码及应用入口。 | 决策树、自由画布、弹层和交互动效。使用 BaoCut Community License，商业软件集成另需许可；见[核实记录](baocut-design/assessment.md)。 |
| [claude-code-background](https://github.com/Henry-fan88/claude-code-background) | 作者有 [PROVENANCE](https://github.com/Henry-fan88/claude-code-background/blob/main/docs/PROVENANCE.md) 来源说明，从新会话背景分析得到时序与布局参数，重写 WebGL 字符风场。作者明确其为原创重建，并非逐像素提取。MIT。 | 欢迎页、无标签页目录或空态背景的轻量动效。 |
| [Harness Studio](https://github.com/vigneshv1cky/harness-studio) | 能确认参照 Claude 桌面的测量值和样式 token；实际架构是 DeepSeek Harness 的 fork 加插件。未找到 Claude 安装包提取或原组件映射。MIT。 | 次要布局参考，不作为已核实的完整逆向实现。见[证据](harness-studio-evidence.md)。 |

除 OpenClaudeUI 的公开思考演示交互外，本轮核实以作者原仓库、来源说明和实际源码为主，未运行这些新增项目。作者声称的“1:1”不等于已验证与本机当前 Claude 完全一致。BaoCut 的两份 README 还记录了原重建证据未迁入仓库，以及 Anthropicons 字体分发许可待确认。

当前选择：会话交互用 OpenClaudeUI 作为主要参考；报告可视化另参考 pi-generative-ui；画布与背景项目按具体需要参考。
