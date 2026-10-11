# 插件编写指南

[开发 Skill](../SKILL.md) · [开放接口](host-api.md)

## 1. 内部和外部 Agent 的入口

两者创建的是同一种插件包。外部 Agent 不需要模拟 Sesame 内部工具，也不需要私有宿主代码。

| 阶段 | Sesame 内部 Agent | 外部编码 Agent |
| --- | --- | --- |
| 学习 | `plugin_read` 阅读本 Skill/引用 | 读取公开仓库的同一份 SKILL.md 与引用 |
| 创建 | `plugin_create` 或工作区写文件 | 公开 CLI 或直接写相同目录 |
| 实现 | workspace 工具及公开 HostContext | 本机编辑器/CLI，按文档编写 HostContext 插件 |
| 逻辑测试 | 固定样本与本地测试 | 相同测试；标准 MCP 可独立启动测试 |
| 宿主验收 | validate/test/install/load 后实际调用 | 有 Sesame 时交给应用内主 Agent；没有时交付待安装包和明确待验项 |
| 发布 | 经用户要求准备 PR | 经用户要求准备 PR；同一审阅协议 |

给外部 Agent 的入口可直接复制：

```text
Read https://raw.githubusercontent.com/KDZZZZZZ/sesame/main/plugins/api-v1/packages/plugin-manager/skills/develop-plugins/SKILL.md and its authoring/API references. Build a Sesame plugin for the requested feature using the public interfaces and real examples. Deliver the package, tests and a Sesame installation handoff; do not require private host source or claim unrun host checks passed.
```

### 内部创建

调用 `plugin_create`（以下为工具参数，不是 shell 命令）：

```json
{
  "command_id": "create-research-note-0001",
  "name": "research-note",
  "publisher": "your-name",
  "description": "把用户提供的研究备注整理为可追溯结论",
  "template": "native",
  "version": "0.1.0",
  "min_host": "0.2.0"
}
```

native 模板由本插件生成，路径在当前主 Agent 工作区的 plugin-drafts，重复操作沿用 command_id/参数。它只生成 echo 验证工具，接下来必须实现所需功能。`skill`、`mcp-python` 保留原有宿主模板，publisher/min_host 仅 native 使用。子 Agent 可编写与测试文件，安装/更新由主 Agent 管理。

### 外部创建

需要 Node 24 或更新版本，从公开仓库运行，无 npm 安装、模型 key 或私有 SDK 依赖：

```sh
git clone https://github.com/KDZZZZZZ/sesame.git
cd sesame
node plugins/api-v1/packages/plugin-manager/scripts/create-plugin.mjs \
  --name research-note \
  --publisher your-name \
  --description 'Turn supplied research notes into traceable conclusions' \
  --template native \
  --output ../research-note
```

这是 Bash/zsh 多行写法；PowerShell 可合为一行。`--template skill` 生成无工具的原生 Skill 包；默认 native。可选 `--version` 和 `--min-host`。输出目录必须不存在，不提供覆盖开关。CLI 输出实际路径、身份、文件清单和下一步；不会自动安装或运行插件。

外部 MCP 作者参考 [web-extract 的实际包](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/optional-api-v1/packages/web-extract)，沿用 stdio/streamable-http 的标准结构；公开 CLI 目前不生成 MCP server。独立 SKILL.md、标准 MCP 包与原生指令包都是支持的交付形式。

## 2. 生成的最小原生包

```text
research-note/
  plugin.json             身份、兼容范围、入口、工具与资源声明
  package.json            type:module、与插件一致的版本
  tools.json              与工具工厂一致的静态 JSON Schema
  index.js                createTools(host)，需要后台时再加 activate(host)
  prompt.md               触发条件和 Skill 入口
  skills/research-note/SKILL.md
  README.md               用法、验证与发布前说明
```

发布前增加作者认可的 LICENSE、PROVENANCE.md 和测试/固定样本。生成器不替作者选许可证。官方仓库打包要求 plugin.json/package.json 的 version 和 license 一致，包含 LICENSE；保留原作者与第三方来源。新增社区包使用自己的 publisher/name，不冒用 sesame 官方命名空间。

清单规则：

- apiVersion 为字符串 `"1"`；version 使用 SemVer；default_state 通常 discoverable；agent_scope 为 all 或 main。
- tool_names、tools.json 和 createTools 返回的名称、schema、描述一致。不要让 schema 宣称工具支持尚未实现的动作。
- prompts/skills/resources/workers 都是包内路径，资源一般不超过 128 KiB；不要包含路径逃逸、链接、node_modules、缓存、密钥或终端安装包。
- provides 只声明实际使用的产品契约。纯方法或通用工具使用 `{}`。不必为了创建插件实现五个契约。
- engines.sesame 对应真正使用的最低能力。用 tools.call 至少 0.2.1；用 inference/agents 至少 0.2.2。新字段不因为 API 主版本仍是 1 就自动兼容旧本体。

原生包是 ESM。相对 import 留在本包；Node 内置模块与公开 SDK 按需使用。SDK 路径由宿主 loader 解析，不要写一个假 npm 安装命令，或从私有应用目录导入内部对象。

## 3. Prompt、Skill 与参考资料怎么分

prompt.md 只说明什么时候用、先读哪个 Skill、不可忽略的交付约束；不要常驻塞入完整 API 文档。

SKILL.md 用 name/description frontmatter；name 对应目录名。正文包括实际触发、输入、执行步骤、输出、成功证据和失败处理。长 schema、例子、平台差异放 references/，按需阅读。`allowed-tools` 等元数据不是权限授予。

[ICT](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/optional-api-v1/packages/ict) 的 tools.json 是空数组，createTools 返回空数组，知识、固定样本与观察脚本仍构成有效插件。需要不同分析方法时分成独立插件；同一方法的重复流程优先合并，不把每本参考书复制成一个重叠插件。

## 4. 按目标复用已有实现

### 行情或账户后端

先照 [AKShare index/provider](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/optional-api-v1/packages/akshare) 写服务注册、绑定、真实查询与依赖检查，再添加所需订阅。账户参考 [MT5 providers](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/optional-api-v1/packages/mt5/backend/providers.js)。

最小行情是 search/describe 加至少一种历史或实时能力；最小账户是 listAccounts/snapshot。按真实支持项声明 capabilities，定义 Decimal、时区、分页、缺值和连接修订。用户切换品种/账户时不得把旧响应写进新绑定。配置好后复用连接；订阅关闭只释放该消费者，完整服务停用再清理资源。

准备依赖分 discover/status/prepare，先验证已有软件与配置，缺失才安装到插件私有数据目录；读取行情不得顺便安装、升级环境或交易。一个 HTTP 报价快照不等于真实 tick 流。

### 图表与指标

先读取 canvas_inspect/data_providers → market_instruments → canvas_binding → canvas_apply。绑定使用返回的来源、品种和口径，不凭显示 symbol 推导。保留用户图表锁与 expected_version。

指标沿用 [close-line 定义和代码](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/api-v1/packages/canvas-control/resources)。声明输入、参数、pane、series，再 export compute(input)，返回标准 points/markers 和就绪状态。发布 indicator 成果后由 chart_script 挂载，检查实际渲染回执。不要把宿主内部图表库对象作为插件 API。

### 报告

复用 [reports 的工具、模板与资源](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/api-v1/packages/reports)：获取数据 → 冻结 DataRef → report_template 或自行写 HTML → report_publish → report_check。

报告风格从原有 CSS/模板出发，按问题选择统计、时序、结构图等资源；自定义 HTML/SVG/交互仍可保留。所有数值来自实际固定输入与有记录的计算。把 JS/CSS/图片随成果打包，使用 window.report 的实际只读方法，不依赖临时文件或 CDN。旧设计中未实现的方法见接口参考。

### 策略、回测与交易

复用 [strategy-authoring 的语言和方法规范](https://github.com/KDZZZZZZ/sesame/tree/main/plugins/api-v1/packages/strategy-authoring/skills/strategy-authoring/references)：Signal → TargetPortfolio → 风险调整 → 执行。后端的回测/交易函数可以自定义工具 schema，不需要新增宿主业务方法。

固定 SVL source/target/translation、参数、输入、环境与验证证据，再交给原生后端；结果发布 strategy.result/report，运行用 strategy.run，逐笔解释保留真实 trace。参考求值、原生回测、挂载成功和成交核验分别报告。超时/取消后的订单可能已经生效，必须查后端事实，不能换 operationId 自动重发。

### 事件调用模型或 Agent

固定输入、无工具的一次判断用 inference；需要研究与多轮工具循环用 agents。当前 strategy_decision 是 inference 的范例，完整 Agent 任务按接口参考的 submit/inspect/wait/cancel 实现。不要声称现有判断插件已经走完整 Agent 路径。

插件负责事件来源、时效、去重、触发频率和业务授权。逐 tick 唤醒模型通常不合适；在插件内筛选、合并事件并使用 lane/queue。把可获知时间和模型输出封存，回测消费保存的判断时间线，不能把未来资料或事后模型回答伪装成历史已知信息。

## 5. 开发测试与安装验收

| 检查 | 证明什么 | 不证明什么 |
| --- | --- | --- |
| 单元/fixture 测试 | 固定输入的转换、逻辑和失败分支 | 真实上游、券商或平台可用 |
| plugin_validate | 格式、资源、版本和摘要检查 | 工厂已经运行 |
| 原生 plugin_test | 清单、工具 schema、JS 语法 | activate、工具和依赖已正常 |
| MCP plugin_test | 已固定本机 server 的工具与声明断言；远程连接读 schema | 任意远程动作已被授权执行 |
| 安装/加载 | 实际激活结果与当前会话可见性 | 数据或交易已完成 |
| 能力验收 | 真正读取、渲染、回测或核实后端事实 | 未测平台也通过 |

有匹配宿主的维护者可以用它提供的公开 SDK loader 跑本仓库 SDK 测试；没有 loader 的外部作者可测试不依赖宿主的纯逻辑、标准 MCP 和生成的 schema，最后交给 Sesame 验收。不能复制私有宿主来“补齐”一个模拟 API 后宣布正式通过。

在公开插件仓库根目录：

```sh
npm test --prefix plugins/api-v1
npm run check --prefix plugins/api-v1
# 已取得匹配应用的 SDK loader 后：
SESAME_PLUGIN_SDK_LOADER=/absolute/path/to/sdk-loader.js npm run test:sdk --prefix plugins/api-v1
```

上述仓库命令检查已收录的包，不会自动扫描任意外部草稿。新草稿必须使用自己的逻辑测试和 Sesame 的 validate/test 流程。更改 tools.json 前核对实际工厂；修改任一包文件后，旧 digest 和旧测试回执都不能继续用于安装。

交付给 Sesame 主 Agent：实际目录或固定仓库 commit/package 路径、插件 ID/版本、最低宿主、已运行测试、尚未运行项目。随后：

1. plugin_validate(path)，修复 diagnostics。
2. plugin_test(path)，保留通过的精确 digest。
3. 未安装使用 plugin_install(path,digest,command_id)；已安装先 inspect，使用更高版本和 expected_digest 调 update。
4. 读取 runtime_status/diagnostics；成功后 plugin_load(plugin_id) 立即刷新当前会话。
5. 执行真实工具/provider/渲染检查；保留失败证据，按症状修复，不用“已安装”替代能力验收。

## 6. 发布与维护

用户要求公开时，再向插件仓库准备 PR。保留作者、许可证与来源；原生代码按当前用户权限运行，说明外部进程、网络、文件写入和数据留存。代码的发布者身份不自动获得本体内部授权。

已收录包更新包版本、tools schema、锁和实际验证记录；新增包的收录位置和分组由维护者决定。当前官方 bundle-profile 是固定集合且使用 sesame/*，**不是任意第三方包目录的通用模板**。第三方以自己的仓库/身份提交，不为了通过官方 bundle 检查改成 sesame 名称。

按 [PUBLISHING.md](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/api-v1/PUBLISHING.md) 完成最终 head 独立审阅与合并前 gate，发布不可变归档。按 [CATALOG.md](https://github.com/KDZZZZZZ/sesame/blob/main/plugins/api-v1/CATALOG.md) 核验实际下载后再选择目录版本。包发布不自动更改用户当前安装，不覆盖已有发行资产，不把自动化检查说成人工批准。

更新保留版本/摘要和插件持久数据，运行中的工具或策略可能阻止切换。回滚只切代码版本，不倒转账户或业务数据。新功能使用明确最低宿主或能力检查；方法、字段或持久数据语义有破坏性变化时给出迁移/拒绝路径。
