<p align="center"><img src="logo.png" width="112" alt="Sesame logo"></p>

# Sesame

Open Sesame. 用自然语言研究市场、安排并行研究任务，并把结果直接画到行情图上。

此公开仓库用于分发 Sesame 桌面安装包、安装说明、版本记录与开源插件。应用宿主源码在独立的私有仓库维护。

## 插件库

在 **[Sesame 插件库](https://sesame.bot/zh/plugins/)** 浏览插件，将精确名称（例如 `sesame/ict`）发给兼容的 Sesame，Agent 会按固定目录核验并在当前对话中加载。[Sesame 0.2.0 插件目录](plugins/api-v1/CATALOG.md) 有 31 个插件：9 个默认核心包、22 个按需包，正式最低版本为 0.2.0；也接受兼容的 0.2 开发版（`>=0.2.0-0`）。从 0.1.4 升级后，请按名称重新安装所需的 API 1 插件，旧插件不能直接复用。

Sesame 0.1.4 请使用[历史 26 个插件的目录](plugins/)；其版本、来源摘要和安装方式保持不变。作者保留版权，逐包许可证、自动检查、独立 Agent 审阅与人工批准分别记录，见[贡献流程](plugins/CONTRIBUTING.md)。以下下载与上手说明适用于已发行的 0.1.4。

## 下载

前往 **[Releases](https://github.com/KDZZZZZZ/sesame/releases)**，选择对应设备的文件：

| 设备 | 安装包 |
| --- | --- |
| macOS 13 或更新，Apple Silicon（M 系列） | `Sesame-…-mac-arm64.dmg` |
| Windows 10/11，Intel / AMD 64 位 | `Sesame-…-win-x64.exe` |
| Linux x86_64 | Debian / Ubuntu 优先使用 `.deb`，其他兼容桌面可用 `.AppImage` |

当前版本是 **Preview**：没有 Apple Developer ID 公证和 Windows 代码签名；请先阅读 [安装与首次配置](INSTALL.md) 中的系统提示说明。暂不提供 Intel Mac、Windows ARM 或 Linux ARM 包。

## 四步上手

1. **安装 Sesame。** 下载对应系统的安装包并打开应用。
2. **配置模型认证。** 在设置中填写自己的 API Key，或使用提供商支持的登录方式；模型额度由你提供。
3. **连接已有 MT5。** 保持已安装的 MT5 运行并登录，在终端启用本机 MCP，把它提供的连接配置发给 Sesame，或点击“让 Sesame 连接 MT5”。
4. **直接使用。** 让 Agent 分析数据、生成图表、使用本地工具插件或编译 MQL5 策略。

研究、编译、MT5 Python 组件和 Electron 报告检查器随应用提供，无需另装 Python、Node.js、WSL、Lima 或 Homebrew。Linux `.deb` 安装时配置应用隔离规则；AppImage 在需要时请求一次系统授权，仅配置 Sesame 专用组件和规则。各系统步骤与数据位置见 **[快速上手](INSTALL.md)**。

## 可以怎么用

- “打开黄金和欧元的 15 分钟图，并排显示，加入成交量和均线。”
- “同时安排三个研究任务，分别分析趋势、波动和新闻，最后汇总依据。”
- “把这个判断记下来，到期核对结果，再更新我的判断准则。”
- “教我调整图表布局、使用 @ 引用报告和 /clear 清理聊天显示。”

首次运行建议先连接模拟账户。图表数据来自所连接券商；研究代码和 MCP 直接联网。明确要求挂载策略或点击一键挂载后，Sesame 才会准备并挂载已回测的版本；MT5 原生 MCP 需允许交易。

每个版本附带 `SHA256SUMS.txt`。更新时下载新版覆盖安装；卸载程序不会主动清除你的工作区。实际验证范围和已知限制以该版本 Release 说明为准。
