# Harness Studio：Claude 桌面视觉来源核查

结论：**测量/参照 Claude Code 桌面布局可确认；安装包逆向链路未发现。** 可作次要的布局数值、输入框和侧栏参考，推荐程度低于提供提取来源和版本依据的 OpenClaudeUI。没有依据把它介绍为 Claude 原前端组件库。

## 原仓库、版本及授权

- 原项目：[vigneshv1cky/harness-studio](https://github.com/vigneshv1cky/harness-studio)。新闻只用于定位，随后通过 [作者的 Show HN 帖](https://news.ycombinator.com/item?id=50196564) 的项目链接确认仓库。
- 核对版本：`0.3.4`，提交 [`c5bce41966303b010a97fc88ecf677ee2893e20f`](https://github.com/vigneshv1cky/harness-studio/commit/c5bce41966303b010a97fc88ecf677ee2893e20f)，GitHub API 给出的提交时间为 `2026-10-21T05:13:42Z`。HN/新闻的发布日期不是 Claude 来源版本。
- [LICENSE](https://github.com/vigneshv1cky/harness-studio/blob/c5bce41966303b010a97fc88ecf677ee2893e20f/LICENSE)：MIT，版权署名 Vignesh Murugan。
- [HARNESS_PIN.md](https://github.com/vigneshv1cky/harness-studio/blob/c5bce41966303b010a97fc88ecf677ee2893e20f/docs/HARNESS_PIN.md#L3-L8) 明确构建自 DeepSeek Harness 的 fork；固定 core 提交为 `fd1df6da2772ff836ae2dcc68d49b74c127f460f`，基于 upstream `0.2.1-rc.2`。未找到对应的 Claude Desktop 安装包版本、提取脚本、原始 bundle 或样式映射清单。

## 宣传与可验证事实

| 层次 | 核查结果 |
| --- | --- |
| 作者宣传 | Show HN 标题使用了 Reverse Engineered Claude Code Desktop。项目 README 的口径较窄：工作方式类似 Claude Code 桌面版，外观密度、字号、侧栏和缩放参照 Claude。 |
| 架构事实 | [ARCHITECTURE.md](https://github.com/vigneshv1cky/harness-studio/blob/c5bce41966303b010a97fc88ecf677ee2893e20f/docs/ARCHITECTURE.md) 描述的是 DeepSeek Harness 的 Electron/React 客户端，加自有插件与 fork 补丁。它不是从 Claude 安装包直接恢复出来的整套前端。 |
| 视觉来源证据 | compact 插件 README 说明从 Claude Code 桌面窗口测量尺寸；实际源码注释提到 Claude stylesheet 的 `--chat-body`、`--chat-leading` 和 `--chat-item-gap`，并实现具体数值。能证明作者参考了这些视觉规则，不能独立证明其提取过程或与某一 Claude 版本完全一致。 |
| 边界 | 仓库目录、架构说明、固定版本说明与 compact 源码中，本轮未找到像 OpenClaudeUI 那样的安装包逆向链路。没有将新闻的扩展描述用作技术结论。 |

## 最值得看的具体代码

统一文件：[plugins/compact/client.js](https://github.com/vigneshv1cky/harness-studio/blob/c5bce41966303b010a97fc88ecf677ee2893e20f/plugins/compact/client.js)，是依赖 Harness 宿主的样式和行为插件，不是独立 React 组件库。

| 范围 | 源码可确认的实现 |
| --- | --- |
| [输入框，第 72–99 行](https://github.com/vigneshv1cky/harness-studio/blob/c5bce41966303b010a97fc88ecf677ee2893e20f/plugins/compact/client.js#L72-L99) | 14px 圆角、24px 发送按钮、13px 图标；`+`、`/`、`@` 弹出菜单按内容定宽并限制最大宽度。 |
| [排版，第 155–166 行](https://github.com/vigneshv1cky/harness-studio/blob/c5bce41966303b010a97fc88ecf677ee2893e20f/plugins/compact/client.js#L155-L166) | 固定 768px 内容列；实际正文 CSS 为 14px 字号、20px 行高。前面的部分注释写 15/22，取值应以代码为准。 |
| [对话节奏，第 292–307 行](https://github.com/vigneshv1cky/harness-studio/blob/c5bce41966303b010a97fc88ecf677ee2893e20f/plugins/compact/client.js#L292-L307) | 对话项目间隔 10px，操作区间距 6px，过程汇总间隔与底部 padding 单独收紧；消息和输入框共用居中列。 |
| [动效，第 463–467 行](https://github.com/vigneshv1cky/harness-studio/blob/c5bce41966303b010a97fc88ecf677ee2893e20f/plugins/compact/client.js#L463-L467) | 明确禁用侧栏和布局的 transition/animation。它适合参考稳定布局，不适合作为 Claude 动效的还原来源。 |

思考和工具：compact 插件提供过程区样式覆盖，宿主有工作详情折叠设置，但本轮没有核实到从 Claude 提取的独立思考/工具展示组件。不能把它推荐为这两个组件的直接替代来源。

## 官方截图

- [浅色整体界面](https://github.com/vigneshv1cky/harness-studio/blob/c5bce41966303b010a97fc88ecf677ee2893e20f/docs/screenshots/app-light.png)
- [输入框 + 菜单](https://github.com/vigneshv1cky/harness-studio/blob/c5bce41966303b010a97fc88ecf677ee2893e20f/docs/screenshots/connectors-menu.png)
- [紧凑布局](https://github.com/vigneshv1cky/harness-studio/blob/c5bce41966303b010a97fc88ecf677ee2893e20f/docs/screenshots/compact-look.png)

截图文件路径已用 GitHub tree 核实；本轮 web 工具未成功呈现图片，因此没有声称做过像素级视觉比较。未通过下载图片绕过显示限制。

只读调查；未安装、运行、修改产品或访问本地 Claude。沿原仓库只继续核对了它明确链接的 harness-studio-core（同项目的 DeepSeek Harness fork），没有把这个 fork 充作另一个独立逆向 UI 候选。
