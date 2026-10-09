# Sesame 快速上手

新版安装包的流程只有四步：**安装 Sesame → 配置模型 → 连接已有 MT5 → 开始使用**。研究代码、绘图、本地 MCP 和隔离编译所需运行环境随应用提供，无需另装 Python、Node.js、WSL、Lima、Docker 或 Homebrew。

## 1. 安装 Sesame

从 [Sesame Releases](https://github.com/KDZZZZZZ/sesame/releases) 下载对应系统的安装包。报告检查复用 Electron 自带的浏览器内核，无需另外下载浏览器。

| 系统 | 安装方法 |
| --- | --- |
| Windows 10/11 x64 | 运行 `.exe`，按提示安装，默认仅为当前用户安装。 |
| macOS 13+，Apple Silicon | 打开 `.dmg`，将 **Sesame.app** 拖入 Applications 后打开。 |
| Linux x86_64 | Ubuntu / Debian 桌面优先使用 `.deb`：`sudo apt install ./Sesame-版本-linux-x64.deb`。其他兼容桌面可用 AppImage。 |

AppImage 添加执行权限后双击，或运行：

```sh
chmod +x Sesame-版本-linux-x64.AppImage
./Sesame-版本-linux-x64.AppImage
```

Linux 需要正常的 systemd 用户会话、cgroup v2 和可用的 user namespaces。`.deb` 安装时自动配置 Sesame 的应用隔离规则；受 AppArmor 限制的 AppImage 首次使用会请求一次系统授权，仅安装 Sesame 专用隔离组件和规则，不关闭系统安全设置。若缺少 FUSE，可用 `--appimage-extract` 解包后运行 `squashfs-root/AppRun`。

Preview 安装包尚未完成 Apple 公证和 Windows 代码签名；首次打开可能出现系统提示。请核对发布来源及 `SHA256SUMS.txt`，仅放行该应用。Intel Mac 和 Windows ARM 不在本版支持范围。

## 2. 配置模型

打开 **设置 → 模型**，选择提供商，填写 API Key，或使用支持的浏览器登录。自定义兼容接口还需填写 Base URL 和模型名称。选择可用模型后，发一句消息确认连接。

模型账号、额度和网络由你提供；密钥只填入设置表单。

## 3. 连接已有 MT5

1. 打开你已安装的 MT5，登录账户并确认行情正常。
2. 在支持 MCP 的 MT5 中打开 **工具 → 选项 → MCP**，启用本机服务。
3. 在 Sesame 的 **MT5 连接**设置中填入账户标识、地址和 MCP Key，以终端显示的配置为准。交易终端常用端口为 `22346`，MetaEditor 常用端口为 `22345`。
4. 让 Agent“检查 MT5 连接”，或开始查看行情。

Sesame 不包含 MT5 和券商账户。使用隔离编译时，应用读取已有 MetaEditor 和标准库的副本，不要求另行配置编译环境。MT5 / Wine 的原有安装由你继续使用。

## 4. 直接开始

可以让 Agent“分析这份 CSV 并画图”“研究当前品种”或“创建并编译一个 MQL5 策略”。研究代码和 MCP 直接联网，无需选择网络模式；文件、进程隔离和资源限制仍然保留。原生策略部署由目标插件根据固定源码、翻译、验证记录与当前账户状态处理；先让 Agent 核验实际支持。安装应用、研究或编译不会触发挂载。

更新时退出应用并安装新版，运行环境随应用更新，无需重跑环境安装脚本。聊天、设置和工作区保留在用户数据目录：Windows 为 `%APPDATA%\Sesame\workspace`，macOS 为 `~/Library/Application Support/Sesame/workspace`，Linux 为 `~/.config/Sesame/workspace`（遵循 `XDG_CONFIG_HOME`）；已有安装沿用原位置。

遇到问题可先问 Agent“检查模型、MT5 连接和运行环境”。更多操作可问“教我使用 Sesame”。

## 从源码开发

源码开发与旧环境维护使用仓库内的开发命令；旧版 `setup-windows.ps1`、`setup-macos.sh` 等脚本仅供相应开发环境使用，不属于新版安装包的上手步骤。开发说明见仓库 README。
