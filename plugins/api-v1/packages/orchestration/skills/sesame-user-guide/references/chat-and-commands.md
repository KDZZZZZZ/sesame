# 聊天、报告引用与命令

## 输入与历史

用自然语言说目的即可，无需记工具名。Enter 发送，Shift+Enter 换行；输入法选字时不会意外发送。短输入保持椭圆，内容换行时按需长高，过长时在输入框内滚动。

生成中仍可输入：Enter 或发送按钮把后续要求加入队列，当前回复完成后按顺序处理；输入框上方可查看队列、取消未开始的消息，或点闪电让某条立即处理。输入框旁的闪电按钮或 ⌘/Ctrl+Enter 会停止当前回复，先处理刚输入的要求，其他排队消息保留。只有输入框为空时，发送按钮才变成停止按钮。停止和抢占不会撤销已经完成的操作。主会话的停止和抢占不会自动停止其他 subagent；结束整个子任务时，其下级任务及其队列也会停止。

聊天向上滚动会按需加载更早记录。页面没有 Import CSV 按钮；需要分析本机数据时，提供普通文件的绝对路径，让 Agent 导入副本，或提供公开数据网址。没有内容时显示 Open Sesame；它和 Whisper your wish… 保持英文。

## @ 引用的是什么

`@` 打开 **Research / Strategy 报告选择器**，输入报告名称片段筛选；不是 @某个 Agent、@品种 或通用 @文件 命令。

1. 输入 `@`，切换 Research / Strategy 分类，选择需要的报告。
2. 用 ↑/↓ 选候选，Enter 或 Tab 插入，Esc 关闭列表。列表打开时，Alt+←/→ 切换分类；也可鼠标点选。
3. 在引用后写具体问题，如“`@欧元研究 把结论中的支撑区画到当前行情图，并解释依据`”。可在一条消息里引用多份报告进行比较。

发送时会附带报告 ID 和当时的最新版本，Agent 可准确读取证据。正在生成的报告有状态标记，完整结果以发布后的版本为准；先等完成通常更合适。列表为空时，检查分类或先让 Agent 生成报告。输入一个不存在的名称不会创建报告或绑定真实引用。

## / 命令：区分清屏与 skill 调用

| 写法 | 实际效果 | 条件 |
| --- | --- | --- |
| `/clear` | 清空本会话用户可见的聊天投影，回到 Open Sesame；不删除实际聊天记录、模型上下文、长期记忆、报告或图表。 | 单独一条消息（前后空格可省略）；生成、排队或停止处理中不可用。它不发送给模型，也不停止任务。 |
| `/skill:名称 你的要求` | 把当前已加载 skill 的说明带给 Agent，让它按这个流程处理要求。 | 名称必须与本会话已加载 Skills 一致；不是执行系统命令，不自动启用被禁用的插件。 |

`/clear 请忘记之前的内容` **不是** `/clear` 命令。想让 Agent 忘记一条长期记忆，请明确说是哪条，或去“记忆与工作区”处理；清屏不能代替遗忘。清屏后更早记录仍保存在数据中，但不再由当前可见历史继续翻出。

可直接使用：

```text
/skill:sesame-user-guide 带我用三步上手，并告诉我怎么拖动图表
/skill:analyze-data 比较这两份已有研究的结论与数据质量
/skill:configure-application 检查当前模型与偏好配置
```

当前没有斜杠菜单或补全列表，也没有产品内置 `/help`、`/new`、`/model`、`/reset`。未知命令会作为普通文本交给 Agent，不应声称已执行特殊操作。用户可以直接问“现在可用的 /skill 命令有哪些”。

## 官方 skill 名称参考

下面列出官方默认与可选插件中的 skill 名称，不代表全部已安装或加载。回答“现在可用什么”前必须检查当前插件状态与本会话加载情况，不能把本表整张当成可执行清单。默认挂载通常可直接调用；可发现插件需要先让 Agent 按需加载；不可使用的不列为可用命令。

| 插件 / skill 名称 | 用户用途 |
| --- | --- |
| sesame/orchestration / `sesame-user-guide` | 产品上手与操作说明。 |
| sesame/configuration / `configure-application` | 读取模型与通用偏好设置，核对版本后修改。具体后端连接由相应插件管理。 |
| sesame/memory / `manage-memory` | 整理长期偏好、研究结论和纠错经验。 |
| sesame/data-access / `analyze-data` | 依据数据分析问题。 |
| sesame/reports / `report-writing`、`report-design`、`interactive-report` | 把研究写成可阅读、可交互的报告。 |
| sesame/mt5 / `mt5-official` | 按当前终端支持情况使用 MT5。 |
| sesame/strategy-authoring / `strategy-authoring` | 编写 SVL 源、检查图与固定输入演算，再交给目标插件翻译和验证。 |
| sesame/mt5 / `native-ea`、`visual-state-machines` | 管理原生 MQL5 和既有可视化工程；真实身份保持可追溯。 |
| sesame/quantskills-catalog / `quantskills-catalog` | 查找量化方法和已有技能目录。 |
| sesame/web-extract / `web-extract` | 提取网页正文。 |
| sesame/rss-collect / `rss-collect` | 整理 RSS/Atom 订阅内容。 |
| sesame/market-data-parser / `market-data-parser` | 整理支持格式的市场数据。 |

外部插件还可能增加 skill。不是每个插件都有 skill；内部工具名也不是 `/命令`。配置助手只对主 Agent 开放；本指南随会话协作插件提供。subagent 的实际可用列表仍以其已加载插件和作用域为准。

维护依据：`composer.tsx`、`mention-editor.tsx`、`lib/mentions.ts`、`message-history.js`；`runtime.js` 将用户文本交给 Pi 的 `session.prompt`，已安装 Pi SDK 的 skill 展开使用 `/skill:`，`PluginRegistry.loader` 仅提供本会话活动的 Skills，不加载 CLI 内置命令或模板。
