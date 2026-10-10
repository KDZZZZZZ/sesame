<p align="center"><img src="logo.png" width="112" alt="Sesame logo"></p>

# Sesame

Open Sesame. 用自然语言研究市场、安排并行研究任务，并把结果直接画到行情图上。

此公开仓库用于分发 Sesame 桌面安装包、安装说明、版本记录与开源插件。应用宿主源码在独立的私有仓库维护。

## 插件库

在 **[Sesame 插件库](https://sesame.bot/zh/plugins/)** 浏览插件，将精确名称（例如 `sesame/ict`）发给兼容的 Sesame，Agent 会按固定目录核验并在当前对话中加载。新的 [API 1 开发目录](plugins/api-v1/CATALOG.md) 有 31 个插件：9 个默认核心包、22 个按需包；要求 `>=0.2.0-0`。插件开发归档已发布，应用 0.2.0 尚未正式发行，不能用于 0.1.4。

Sesame 0.1.4 请使用[历史 26 个插件的目录](plugins/)；其版本、来源摘要和安装方式保持不变。作者保留版权，逐包许可证、自动检查、独立 Agent 审阅与人工批准分别记录，见[贡献流程](plugins/CONTRIBUTING.md)。以下下载与上手说明适用于 0.2.0。

## 下载

当前版本 **[Sesame 0.2.0](https://github.com/KDZZZZZZ/sesame/releases/tag/v0.2.0)**：

| 设备 | 安装包 | 下载大小 |
| --- | --- | --- |
| macOS 13+ · Apple Silicon（M 系列） | [DMG](https://github.com/KDZZZZZZ/sesame/releases/download/v0.2.0/Sesame-0.2.0-mac-arm64.dmg) | 254.8 MB |
| Windows x64 | [安装器](https://github.com/KDZZZZZZ/sesame/releases/download/v0.2.0/Sesame-0.2.0-win-x64.exe) | 224.5 MB |
| Linux x64 · Debian / Ubuntu 系 | [DEB](https://github.com/KDZZZZZZ/sesame/releases/download/v0.2.0/Sesame-0.2.0-linux-x64.deb) | 204.8 MB |
| Linux x64 · 其他兼容桌面发行版 | [AppImage](https://github.com/KDZZZZZZ/sesame/releases/download/v0.2.0/Sesame-0.2.0-linux-x64.AppImage) | 236.0 MB |

macOS 包为 ad-hoc 签名，未经过 Apple 公证；Windows 安装器未代码签名。系统提示处理见[安装与首次配置](INSTALL.md)。暂不提供 Intel Mac、Windows ARM 或 Linux ARM 包。本版不包含自动更新。

## 四步上手

1. **安装 Sesame。** 下载对应系统的安装包，核对发行页的 SHA256，再打开应用。
2. **配置可用模型。** 在设置中配置自己的模型供应商和凭证，先发送一条消息验证连接。
3. **按需选择插件。** 从[插件库](https://sesame.bot/zh/plugins/)复制精确 ID 发给 Sesame，例如「安装 sesame/akshare，打开 A 股行情」或「安装 sesame/mt5，复用我本机的 MT5」。
4. **开始研究。** 让 Agent 安排并行任务、调整图表、绘制指标、生成交互报告，或通过所选后端开发与回测策略。

安装包自带 9 个基础插件。MT5、Python、Wine、QMT、vn.py 等环境不随应用安装；插件优先查找和复用本机软件及配置，确实缺少时再按任务准备依赖。Sesame 本体无需另装 Node.js、Python 或浏览器。Agent 与原生插件使用当前系统用户的本机权限，报告与指标保留浏览器隔离。

## 可以怎么用

- “安装 sesame/mt5 和 sesame/akshare，把黄金和 A 股放在同一个工作台。”
- “只用 sesame/ict 标注流动性和价格结构，把判断依据画到图上。”
- “同时安排三个研究任务，分别分析趋势、波动和新闻，最后汇总成报告。”
- “用 sesame/backtrader 回测这份策略，说明成本、回撤和哪些假设还未验证。”
- “安装 sesame/judgment-evolution，把这个未来可验证判断记下来，到期复盘。”

行情、账户、回测与实盘能力取决于所选插件和实际配置。QMT 需要受支持的 Windows 环境与券商授权，当前 vn.py 和 Backtrader 插件用于回测，CCXT 插件仅提供公开现货行情。

## 从 0.1.x 升级

先备份现有用户数据，再退出旧版并替换应用。**旧原生插件不兼容 Plugin API 1，需要安装对应的新版插件。** 会话、报告与原始数据保留，旧 MT5 组已合并为按需安装的 `sesame/mt5`。完整步骤、数据目录与额外依赖见 [INSTALL.md](INSTALL.md)。

本体回归 308 通过、0 失败，12 项按平台或环境条件跳过。macOS 最终 DMG 已验证原生启动；Windows/Linux 已完成原生构建、安装包解包和包内服务导入检查，完整桌面及实际券商操作仍需对应设备验证。QMT 真实券商连接与 A 股实盘未验证。各插件的真实任务范围见发行说明；[发行文件与摘要](RELEASE-ASSETS.json)记录最终下载字节。
