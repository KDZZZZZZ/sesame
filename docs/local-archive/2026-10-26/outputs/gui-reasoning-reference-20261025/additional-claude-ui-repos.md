# 新增 Claude 界面还原仓库

本轮仅核查此前未推荐的项目。未安装、运行任何项目，未修改 Sesame。以下结论依据原仓库 README、许可证、目录和实际界面源码；没有把项目的“复刻”宣传视为像素一致证明。

## Nwflower/dsh-claude-style

- 仓库：https://github.com/Nwflower/dsh-claude-style
- 固定提交：`b7322f5b9baca27a2220f77564b4400bd13bfd1e`，GitHub 提交时间 `2026-10-24T16:09:25Z`。
- 定位：在 DeepSeek Harness 内实际运行的 Claude Code Desktop 主题和交互插件。README 明确目标，不是 CLI 外壳。覆盖聊天、输入框、侧栏、主题、思考/过程折叠及流式动效。
- 已读实际代码：
  - `packages/client/src/features/chat-fold/reasoning-fold.ts` 第 10–26 行描述规则；第 37–59 行用 phase 与 touchedIn 判断，97–137 行触发宿主展开控件并记录用户操作。运行时展开，停止思考后收起；用户手动选择在当前阶段保留，结束后的新阶段仍自动收起。
  - `packages/client/src/features/chat-fold/process-fold.ts` 包含过程组的展开和折叠、手动选择、后续回答/过程组替代以及滚动位置处理。
  - `packages/client/src/features/chat-fold/fold-motion.css` 是折叠区域动效样式；另有 `reasoning-stream.ts`、`chat-reveal/reveal-engine.ts`、`chat-send/send-morph.ts` 等独立模块，目录已核实，未逐一执行测试。
  - `docs/STYLE.md` 提供浅/深色配色与交互 token。
- 精确源码：https://github.com/Nwflower/dsh-claude-style/blob/b7322f5b9baca27a2220f77564b4400bd13bfd1e/packages/client/src/features/chat-fold/reasoning-fold.ts#L37-L59
- 官方预览：https://github.com/Nwflower/dsh-claude-style/blob/b7322f5b9baca27a2220f77564b4400bd13bfd1e/docs/screenshots/claude-conversation-light.png
- 许可：https://github.com/Nwflower/dsh-claude-style/blob/b7322f5b9baca27a2220f77564b4400bd13bfd1e/LICENSE
  主体 MIT；`features/sodium/` 和 `engine/src/sheet-rewrite.ts` 是 PolyForm Shield；Anthropic 专有字体与 Clawd 图像被明确排除在 MIT 之外。不能把整仓库视为纯 MIT。
- 推荐：最适合研究实际聊天交互、思考/工具收起和输入框状态；与 DSH 宿主 DOM/服务耦合，适合移植规则或有选择地复用代码，不适合整包当 Sesame 组件库导入。未找到安装包逆向链路，不能称为恢复出的 Claude 原前端。

## conmeara/ui-backlot

- 仓库：https://github.com/conmeara/ui-backlot
- 固定提交：`7e5ba9973831f1484d37069313b1977e41d23cf7`，GitHub 提交时间 `2026-07-31T17:18:46Z`。
- 定位：把真实软件界面还原成可编辑 HTML/HyperFrames 场景，用于产品演示。Claude 是主要界面族之一；它提供界面和脚本化交互，不提供真实模型聊天后端。
- 已读实际文件：
  - `compositions/claude-composer.html`：Chat、Cowork、Home 三种输入框，按钮、模型选择、页面切换和局部样式齐全。第 65–68 行记录原应用窗口截图来源。
  - `compositions/claude-thread-core.html`：聊天、thinking/command 卡、文件卡、暗色样式及 GSAP 场景时间线。部分“thinking”是固定演示内容，不能当成模型状态机。
  - `compositions/claude-tool-result.html`：工具结果、文件产物、复制/重试、右侧上下文区域。
  - `docs/prototypes/claude-actual-app-reference-sources-094.md`：列出 Claude 官方产品截图和其他原始参考的来源及用途；后续源码还引用真实窗口捕获和像素采样记录。
- 精确源码：https://github.com/conmeara/ui-backlot/blob/7e5ba9973831f1484d37069313b1977e41d23cf7/compositions/claude-composer.html
- 来源记录：https://github.com/conmeara/ui-backlot/blob/7e5ba9973831f1484d37069313b1977e41d23cf7/docs/prototypes/claude-actual-app-reference-sources-094.md
- 官方聊天演示：https://github.com/conmeara/ui-backlot/blob/7e5ba9973831f1484d37069313b1977e41d23cf7/docs/media/claude-chat-interaction.gif
- 官方在线目录：https://conmeara.github.io/ui-backlot/ （README 已核实链接，本轮 web 工具无法打开。）
- 许可：https://github.com/conmeara/ui-backlot/blob/7e5ba9973831f1484d37069313b1977e41d23cf7/LICENSE
  代码和场景 ISC；README 另行说明品牌和第三方图像的权利归属。
- 推荐：更适合逐项核对输入框几何、侧栏、工具卡和布局；比仅写“Claude-like”的项目有更清晰的截图来源。属于依据截图重建，不是安装包反编译或原组件提取。

## 本轮未推荐

`13point5/open-artifacts` 的确有 Claude.ai 聊天/Artifact 界面，但 2024 年已归档，源码停留在 2024 年，没有当前思考/工具交互的证据，因此不把它凑进本轮强候选。
