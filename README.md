<p align="center"><img src="logo.png" width="112" alt="Sesame"></p>

# Sesame

**让 Agent 在工作台中完成研究，让你看懂、监督并指导整个过程。**

Sesame 是面向量化研究与交易的 Agent 工作台。它把对话、行情图表、指标、策略、回测报告、外部工具和并行任务放进同一个工作空间：Agent 能围绕已有数据和工具持续工作，你能查看依据、追踪过程、调整方向，并检验结果。

我们相信，高集成度的工作台能同时提高 Agent 的执行效率和人的理解、监督与指导效率。实际的量化金融能力由本体接口、官方插件和外部数据及交易后端共同提供；开放的集成方式，让社区可以继续扩展新的市场、研究方法、工具和工作流。

[产品网站](https://sesame.bot/zh/) · [下载本体](https://github.com/KDZZZZZZ/sesame/releases/latest) · [插件库](https://sesame.bot/zh/plugins/) · [插件开发](plugins/api-v1/docs/README.md) · [参与贡献](CONTRIBUTING.md)

## 在同一个工作台里完成什么

| 能力 | 你可以怎样使用 |
| --- | --- |
| 市场与图表 | 接入不同数据源，打开行情、叠加指标，把分析依据直接画到图表上。 |
| 研究与协作 | 让多个 Agent 分工处理任务，调用工具和模型，再把结果汇总为可检查的报告。 |
| 策略与回测 | 使用 SVL 描述策略，通过所选引擎回测，查看策略逻辑、参数比较、收益和回撤。 |
| 账户与交易 | 通过兼容的 MT5、QMT 等插件接入账户与执行能力；具体支持范围由插件和实际环境决定。 |
| 记忆与复盘 | 保存有来源的研究记录、判断与结果，在后续任务中继续使用并复盘。 |

例如：

> 安装 sesame/mt5 和 sesame/akshare，把黄金和 A 股行情放进同一个工作台。
>
> 用 sesame/ict 标注价格结构和流动性，把每个判断的依据画在图上。
>
> 用 sesame/backtrader 回测这份策略，比较参数，并解释成本、回撤和还没有验证的假设。

当前 CCXT 插件提供公开现货行情；vn.py 和 Backtrader 插件用于回测。QMT 需要受支持的 Windows 环境和券商授权。多账户复制交易等组合工作流需要专门实现与验证，不能仅因底层接口可扩展就视为已经具备。

## 插件可以扩展到什么程度

插件可以是一个专门的研究方法，也可以连接数据源、账户、外部程序或服务，提供工具、图表指标、交互报告、策略引擎和 Agent 工作流。

- **Skill**：定义某个市场或研究方法的流程、资料与判断规则。
- **MCP**：把已有工具和外部服务接进工作台。
- **Native**：通过公开 HostContext 接口注册工具、市场与账户 provider，使用工作区、存储、模型推理、Agent 任务和生命周期能力。

插件可以按明确的工具与 provider 身份组合使用，并在自己的工作流中选择依赖的能力。统一接口提供集成基础；多数据源并用、账户选择和跨插件执行的具体行为仍需插件实现，并遵守相应接口约定。

原生插件是运行在本机的可信代码，具有当前系统用户的权限；报告与指标使用浏览器隔离环境。开发者应说明联网、文件访问、外部依赖、凭证和交易写操作。公开接口、可审查源码和明确的能力说明，是使用与扩展插件的基础。

当前源码与 R2 目录使用 Plugin API 2，要求 Sesame >=0.2.3；包含 9 个基础插件和 45 个可选插件，本次不发布 Kurumi。浏览[当前插件目录](plugins/api-v1/CATALOG.md)，将精确 ID 发给兼容的 Sesame 即可请求安装。旧版 API 1 宿主需要先升级本体。

## 下载与开始使用

当前本体版本：[Sesame 0.2.3](https://github.com/KDZZZZZZ/sesame/releases/tag/v0.2.3)。

| 平台 | 安装包 |
| --- | --- |
| macOS 13+ · Apple Silicon | [DMG](https://github.com/KDZZZZZZ/sesame/releases/download/v0.2.3/Sesame-0.2.3-mac-arm64.dmg) |
| Windows 10/11 x64 | [安装器](https://github.com/KDZZZZZZ/sesame/releases/download/v0.2.3/Sesame-0.2.3-win-x64.exe) |
| Linux x64 · Debian / Ubuntu | [DEB](https://github.com/KDZZZZZZ/sesame/releases/download/v0.2.3/Sesame-0.2.3-linux-x64.deb) |
| Linux x64 · 其他兼容桌面发行版 | [AppImage](https://github.com/KDZZZZZZ/sesame/releases/download/v0.2.3/Sesame-0.2.3-linux-x64.AppImage) |

1. 下载对应安装包，核对发行页的 SHA256，并按 [安装指南](INSTALL.md) 完成安装。
2. 在设置中配置模型供应商与凭证，发送一条消息验证连接。
3. 从插件库选择需要的数据源、交易后端或研究方法，告诉 Sesame 要完成的任务。
4. 查看图表、报告和工具结果，随时补充约束、调整任务并验证结论。

本体不需要另装 Node.js、Python 或浏览器。MT5、Python、Wine、QMT 等插件依赖按实际任务准备，优先复用本机环境。macOS 安装包尚未公证，Windows 安装包未签名；系统提示、升级备份和故障排查见 [INSTALL.md](INSTALL.md)。0.2.3 尚不包含自动更新。

## 开发自己的插件

公开仓库提供插件源码、接口文档、脚手架和验证工具；编写插件不需要私有宿主源码。先从[开发文档索引](plugins/api-v1/docs/README.md)进入：

| 你要做什么 | 阅读资料 |
| --- | --- |
| 让 Sesame 或外部编码 Agent 开发插件 | [开发 Skill](plugins/api-v1/packages/plugin-manager/skills/develop-plugins/SKILL.md) |
| 了解接口、作用域和能力限制 | [HostContext 与产品接口](plugins/api-v1/packages/plugin-manager/skills/develop-plugins/references/host-api.md) |
| 创建、测试、安装和恢复插件 | [编写与安装](plugins/api-v1/packages/plugin-manager/skills/develop-plugins/references/authoring.md) · [恢复指南](plugins/api-v1/packages/plugin-manager/skills/develop-plugins/references/recovery.md) |
| 寻找可复用的实现 | [基础插件](plugins/api-v1/packages/) · [可选插件](plugins/optional-api-v1/packages/) |
| 提交代码与了解分发规则 | [贡献流程](CONTRIBUTING.md) · [插件发布政策](plugins/api-v1/PUBLISHING.md) |

外部开发环境使用 Node.js 24+，在本仓库中生成一个独立草稿：

```sh
node plugins/api-v1/packages/plugin-manager/scripts/create-plugin.mjs --name my-research --publisher your-name --description "研究某个市场的方法" --template skill --output ../my-research
```

原生工具插件可将模板改为 `native`。完成实际功能后，在兼容的 Sesame 中执行 `plugin_validate → plugin_test → plugin_install → plugin_load`，再验证真实任务。脚手架本身不会安装依赖或自动激活插件。

这个仓库维护桌面发行、安装说明与开源插件；应用宿主在独立私有仓库维护。各插件保留自己的许可证、作者和来源。`main` 是稳定源码入口，社区通过 fork 向 `dev` 提交 PR，维护者审核后合入。GitHub Release 仅保留本体版本与安装包；插件由 R2 目录分发。详见 [本体发布流程](RELEASING.md)。
