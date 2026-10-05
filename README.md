<p align="center"><img src="logo.png" width="112" alt="Sesame logo"></p>

# Sesame

Open Sesame. 用自然语言研究市场、安排并行研究任务，并把结果直接画到行情图上。

此公开仓库用于分发 Sesame 桌面安装包、安装说明与版本记录。应用源码在独立的私有仓库维护。

## 下载

前往 **[Releases](https://github.com/KDZZZZZZ/sesame/releases)**，选择对应设备的文件：

| 设备 | 安装包 |
| --- | --- |
| macOS 13 或更新，Apple Silicon（M 系列） | `Sesame-…-mac-arm64.dmg` |
| Windows 10/11，Intel / AMD 64 位 | `Sesame-…-win-x64.exe` |
| Linux x86_64 | `Sesame-…-linux-x64.AppImage`，或 Debian / Ubuntu 的 `.deb` |

首版是 **Preview**：没有 Apple Developer ID 公证和 Windows 代码签名；请先阅读 [安装与首次配置](INSTALL.md) 中的系统提示说明。暂不提供 Intel Mac、Windows ARM 或 Linux ARM 包。

## 安装完还要做什么？

1. **要使用 Agent：配置自己的模型账号或 API Key。** 安装包不附赠模型额度。
2. **要看实时行情和账户：安装并登录 MT5，启用其本机 MCP 连接。** 在 Sesame 的 User 设置中填入终端提供的连接信息，之后会自动连接。
3. **要让 Agent 运行研究代码、生成指标、使用本地工具插件：配置研究执行环境。** Mac 使用 Lima，Windows 使用专用 WSL，Linux 使用系统隔离工具。聊天、界面和直接连接 MT5 不依赖这套代码执行环境。

Electron、应用服务和报告检查浏览器已经随安装包提供；无需安装 Node.js / npm 来启动 Sesame。首次配置、各系统环境命令、数据位置与故障排查见 **[完整安装指南](INSTALL.md)**。

## 可以怎么用

- “打开黄金和欧元的 15 分钟图，并排显示，加入成交量和均线。”
- “同时安排三个研究任务，分别分析趋势、波动和新闻，最后汇总依据。”
- “把这个判断记下来，到期核对结果，再更新我的判断准则。”
- “教我调整图表布局、使用 @ 引用报告和 /clear 清理聊天显示。”

首次运行建议先连接模拟账户。图表数据来自所连接券商；联网、研究执行和交易权限在设置中分别控制。

每个版本附带 `SHA256SUMS.txt`。更新时下载新版覆盖安装；卸载程序不会主动清除你的工作区。实际验证范围和已知限制以该版本 Release 说明为准。
