# Sesame 安装与开始使用

版本 **0.2.3** 使用 Plugin API 2：插件明确声明能力、参数、依赖和使用说明；普通子 Agent 与多 Agent 工作流共用运行控制和可展开的成果界面。个人交易记忆区分风格、用户确认的风险红线和策略认知；账户页支持由后端提供的手动平仓能力。

[下载安装包](https://github.com/KDZZZZZZ/sesame/releases/tag/v0.2.3) · [插件目录](https://sesame.bot/zh/plugins/) · [使用文档](https://sesame.bot/zh/docs/)

## 选择安装包

| 系统 | 文件 | 安装方式 |
| --- | --- | --- |
| macOS 13+，Apple Silicon | `Sesame-0.2.3-mac-arm64.dmg` | 打开后拖入 Applications，再从 Applications 启动 |
| Windows 10/11 x64 | `Sesame-0.2.3-win-x64.exe` | 运行安装器，选择安装目录 |
| Linux x64，Debian/Ubuntu 系 | `Sesame-0.2.3-linux-x64.deb` | `sudo apt install ./Sesame-0.2.3-linux-x64.deb` |
| Linux x64，其他兼容桌面发行版 | `Sesame-0.2.3-linux-x64.AppImage` | 添加执行权限后运行；没有 FUSE 时可使用 `--appimage-extract-and-run` |

使用同一发行页的 `SHA256SUMS.txt` 核对下载文件。macOS 包采用 ad-hoc 签名、未经过 Apple 公证；Windows 包未签名。系统提示时先确认来源和校验值，再按系统提示允许打开。没有 Intel Mac 或 ARM Windows/Linux 安装包，本版不提供自动更新。

## 开始使用

1. 在用户设置中配置可用模型及凭证，发送消息验证连接。Sesame 不附赠模型额度。
2. 默认自带工作区、编排指南、数据引用、记忆、插件管理、报告、策略编写、图表控制和配置这 9 个基础插件。
3. 按任务安装需要的可选插件，例如“安装 sesame/mt5，复用本机终端并检查连接”或“安装 sesame/akshare 和 sesame/vnpy，准备 A 股研究与回测”。插件会检查已声明能力和依赖；缺少服务、凭证或运行环境时应暂停并说明需要补充的条件。

本次插件目录包含 **54 个 API 2 插件：9 个基础插件和 45 个可选插件**。Kurumi 暂不在本次发布范围内。安装插件不等于已安装其外部依赖或已连接账户。

本体不需要单独安装 Node.js、浏览器、Python 或交易终端。插件按需使用独立的 Python/Node.js 环境、终端、模型或数据服务，这些环境不随安装包分发。

| 需求 | 插件 | 额外条件 |
| --- | --- | --- |
| MT5 行情、账户、MQL5 工程、编译、回测及交易 | `sesame/mt5` | 可用终端、相应接口及券商账户 |
| A 股研究数据 | `sesame/akshare` | Python、AKShare 及上游网络 |
| VeighNa 原生 CTA 回测 | `sesame/vnpy` | Python 依赖和历史数据 |
| QMT 行情、账户及交易 | `sesame/qmt` | Windows MiniQMT/XtQuant、券商支持及授权账户 |
| 加密资产公开行情 | `sesame/ccxt` | Python、CCXT 及交易所网络 |
| Backtrader 回测 | `sesame/backtrader` | Python、Backtrader 和历史数据 |

研究方法、因子研究、组合执行和手动交易等能力分别由可选插件提供；可用范围和依赖以各插件的明确声明为准。

## 从旧版升级

退出旧 Sesame，备份用户数据，再替换应用。**0.2.3 需要 Plugin API 2 插件；API 1 插件不能继续加载。** 通过新版插件目录重新安装或更新需要的插件。不要为了升级直接删除原始配置、报告或策略；旧后端配置的发现和导入由相应插件处理。

开发期旧工作流和交易计划不提供自动兼容迁移。升级前暂停旧计划，在新版重新配置并核验依赖后再启用，不能假定旧计划可以直接恢复执行。

默认数据目录：macOS 为 `~/Library/Application Support/Sesame`，Windows 为 `%APPDATA%\Sesame`，Linux 为 `~/.config/Sesame`。更早版本可能沿用同级 `MT5Agent` 或 `mt5agent` 目录，以实际安装为准。

先核验连接，再恢复图表和交易工作。关闭 Sesame 不等于停止外部策略、撤单或平仓。个人交易风险记忆供 Agent 查询和核对；保存规则不会自动在券商端创建止损单，也不构成交易许可。

## 执行与验证范围

Agent、原生插件和本地 MCP 以当前系统用户权限执行，可以访问文件、联网和启动程序。报告与图表指标在隔离的浏览器或 Worker 中渲染。

发布构建对 Windows、Linux 和 macOS 安装包核对提取内容、插件源码锁与逐文件摘要，并验证包内服务导入。这些检查不代表已完成全部桌面交互、外部数据服务或真实券商交易验收。各插件的外部依赖和实测范围见其说明。

## English quick start

Install Sesame 0.2.3 for your operating system, configure a model, then ask Sesame to install the required plugins by their exact IDs. Nine core plugins are bundled; 45 optional API 2 plugins are published separately. Kurumi is excluded from this release. Plugin installation does not configure an external account or install every backend dependency.

Back up user data before upgrading. API 1 plugins must be replaced with API 2 versions. macOS builds are ad-hoc signed and not notarized; Windows installers are unsigned. There is no automatic updater. Package verification does not establish full desktop, market-service or broker compatibility. Trading memory is guidance for the Agent; it does not automatically place broker orders or enforce a broker-side risk limit.
