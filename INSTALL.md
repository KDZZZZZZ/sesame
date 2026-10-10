# Sesame 0.2.1 安装与开始使用

[下载安装包](https://github.com/KDZZZZZZ/sesame/releases/tag/v0.2.1) · [插件目录](https://sesame.bot/zh/plugins/) · [使用文档](https://sesame.bot/zh/docs/)

## 选择安装包

| 系统 | 文件 | 安装方式 |
| --- | --- | --- |
| macOS 13+，Apple Silicon（M 系列） | `Sesame-0.2.1-mac-arm64.dmg` | 打开后拖入 Applications，再从 Applications 启动 |
| Windows 10/11 x64 | `Sesame-0.2.1-win-x64.exe` | 运行安装器，选择安装目录 |
| Linux x64，Debian/Ubuntu 系 | `Sesame-0.2.1-linux-x64.deb` | 在文件所在目录运行 `sudo apt install ./Sesame-0.2.1-linux-x64.deb` |
| Linux x64，其他兼容桌面发行版 | `Sesame-0.2.1-linux-x64.AppImage` | 添加执行权限后运行；依赖发行版的 FUSE 支持，也可使用 `--appimage-extract-and-run` |

下载时可用同一发行页的 `SHA256SUMS.txt` 核对文件。当前 macOS 包是本机签名，未经过 Apple 公证；Windows 包未购买代码签名证书，首次启动可能被系统拦截。确认来源与校验值后，macOS 可在「系统设置 → 隐私与安全性」允许打开，Windows 可在 SmartScreen 中查看「更多信息」。请勿全局关闭系统安全检查。

没有 Intel Mac 或 ARM Windows/Linux 安装包。本版没有自动更新，需要手动下载并替换应用。

## 安装后还需要什么

1. **配置可用模型。** 打开用户设置，配置模型供应商和凭证，先发送一条消息验证连接。Sesame 不附赠模型额度；API 费用由模型供应商收取。
2. **告诉 Sesame 想用的数据或交易平台。** 默认自带工作区、并行研究、数据引用、记忆、插件管理、报告、策略编写、图表控制和配置这 9 个基础插件。可以先用自己的文件做研究；实时行情、账户、原生回测需要另外安装相应后端。
3. **让 Agent 检查已有环境。** 例如发送「安装 sesame/mt5，复用我本机的 MT5 并检查连接」或「安装 sesame/akshare 和 sesame/vnpy，准备 A 股行情与策略回测」。Agent 根据插件指南查找已有软件、Python 和配置，缺少时再按任务安装依赖。安装插件后立即生效，不需要重启聊天。

不需要为 Sesame 本体单独安装 Node.js、浏览器、Python 或 MT5。所选插件可能需要独立的 Python/Node.js 环境、交易终端或模型以外的服务；它们不包含在安装包内。

| 需求 | 可选插件 | 额外条件 |
| --- | --- | --- |
| MT5 行情、账户、MQL5 编译、回测及交易 | `sesame/mt5` | 已配置的 MT5、可用终端接口和券商账户；macOS 使用可运行的 MT5 环境 |
| A 股行情与研究数据 | `sesame/akshare` | 可用 Python 环境和上游网络，不提供券商交易 |
| VeighNa 原生 CTA 回测 | `sesame/vnpy` | 相应 Python 依赖和历史数据；当前插件不提供实盘网关 |
| QMT 行情、账户及显式报单/撤单 | `sesame/qmt` | Windows MiniQMT/XtQuant、券商支持和授权账户；未开户也可先做研究 |
| 加密资产公开现货行情 | `sesame/ccxt` | Python、CCXT 及相应交易所网络；当前仅公开数据，无私有账户或交易 |
| Backtrader 策略回测 | `sesame/backtrader` | Python、Backtrader 和固定历史数据；不提供实盘 |

ICT、Price Action、波浪、威科夫、道氏理论、人文分析、策略研究和因子研究等是独立方法插件。按自己需要安装，不会因选择其中一种方法而自动启用其他方法。完整的 31 个插件及各自许可证、能力范围见插件目录。

## 从 0.1.x 升级

退出旧 Sesame 后替换应用。请先备份现有用户数据目录，尤其是仍在使用的配置、报告和策略。本版保留会话、报告和原始数据，**旧原生插件不兼容 Plugin API 1**；请通过 Agent 从新版目录安装对应插件。旧 MT5 专用插件已合并为 `sesame/mt5`，不默认随应用安装。已有后端配置应由新插件发现并明确导入，不会因启动应用而静默迁移或下载交易终端。

默认数据目录是 macOS 的 `~/Library/Application Support/Sesame`、Windows 的 `%APPDATA%\Sesame`、Linux 的 `~/.config/Sesame`。更早安装可能沿用 macOS 的 `MT5Agent` 或其他系统的 `mt5agent` 同级目录；以本机实际存在的目录为准。不要删除它来完成升级。

先核验后端连接，再让 Agent 恢复所需图表。安装插件成功不等于已连接账户；关闭 Sesame 也不等于停止外部策略、撤单或平仓。

## 执行与验证范围

Agent、原生插件和本地 MCP 以当前系统用户权限执行，能够读写工作区外的文件、联网及启动程序。依赖优先复用本机配置；任务结束只清理自己拥有的临时文件和进程，不删除用户外部文件。报告和图表指标仍在隔离的浏览器/Worker 中渲染。

本次验证包括 macOS 应用启动，以及 Windows/Linux 原生构建、安装包提取和后端导入；后两者不等于已验证所有桌面环境或券商。真实模型已完成多后端图表、研究报告和原生回测；MT5 模拟账户已验证交易结果。QMT 真实 Windows 券商连接和 A 股实盘尚未验证。模型请求和上游数据可能需要重试，全部插件也不具有相同的实测范围。

## English quick start

Install the package for your operating system, configure a working model in user settings, then ask Sesame to install a plugin by its exact ID from the [plugin directory](https://sesame.bot/plugins/). Nine core plugins are included; market data, brokerage and native backtesting integrations are optional. Reuse existing local software first; plugins guide dependency setup when needed. The app itself does not require a separate Node.js, Python, Chromium or trading terminal installation.

Version 0.2.0 introduces Plugin API 1. Back up your existing data before upgrading from 0.1.x and install the corresponding new plugins; legacy native plugins are incompatible. The app preserves existing data directories. macOS builds are ad-hoc signed and not notarized; Windows installers are unsigned. Automatic updates are not included. Windows/Linux packaging checks do not constitute full desktop or broker testing.
