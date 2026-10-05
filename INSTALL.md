# Sesame 安装与首次配置

## 1. 安装应用

只从 [Sesame Releases](https://github.com/KDZZZZZZ/sesame/releases) 获取安装包。安装包已包含 Electron、应用服务、内置插件和报告检查所需 Chromium，不需要克隆源码，也不需要运行 npm。

| 系统 | 安装方法 |
| --- | --- |
| macOS 12+，Apple Silicon | 打开 `.dmg`，将 **Sesame.app** 拖到 Applications，再从 Applications 打开。首次需要的空闲空间建议至少 3 GB。 |
| Windows 10/11 x64 | 运行 `.exe`，选择安装目录。默认仅为当前用户安装。建议至少 3 GB 空闲空间。 |
| Linux x86_64 | Debian / Ubuntu 推荐 `sudo apt install ./Sesame-版本-linux-x64.deb`。其他发行版为 AppImage 添加执行权限后运行。需要图形桌面。 |

AppImage 示例（将文件名替换为实际版本）：

```sh
chmod +x Sesame-版本-linux-x64.AppImage
./Sesame-版本-linux-x64.AppImage
```

如果 AppImage 提示缺少 FUSE，可按发行版安装 FUSE 2 兼容库，或使用 `./Sesame-版本-linux-x64.AppImage --appimage-extract`，再运行 `./squashfs-root/AppRun`。Ubuntu / Debian 用户优先使用 `.deb`。不要以 root 运行 Sesame，也不要通过关闭 Chromium sandbox 绕过环境问题。

**首版签名状态：** 此 Preview 没有 Apple Developer ID 公证或 Windows 代码签名。macOS 可能阻止首次打开；确认来源及摘要后，在“系统设置 → 隐私与安全性”使用针对 Sesame 的“仍要打开”。Windows SmartScreen 可能显示未知发布者；确认文件后使用“更多信息 → 仍要运行”。组织管理的设备可能不允许这些操作。无需关闭系统的全局安全保护。Intel Mac 与 Windows ARM 不在本版支持范围。

文件校验：macOS / Linux 使用 `shasum -a 256 安装包路径` 或 `sha256sum 安装包路径`；Windows PowerShell 使用 `Get-FileHash 安装包路径 -Algorithm SHA256`，与同一 Release 的 `SHA256SUMS.txt` 比对。

## 2. 必需项与可选项

| 你想做什么 | 还需要准备什么 |
| --- | --- |
| 打开界面、调整已有图表布局、查看已保存内容 | 无额外开发环境 |
| 与主 Agent 对话、并行安排 subagent、使用长期记忆 | 可用模型账号 / API Key、可用额度，以及访问模型服务的网络 |
| 实时 K 线、成交量、账户和持仓 | 本机 MT5、已登录的券商账户、MT5 官方本机 MCP 连接 |
| 运行研究代码、文件工具、代码绘图、使用本地 MCP 插件 | 下文的 Lima / WSL / Linux 研究执行环境；部分任务还需要在设置中允许联网 |
| 编译 MQL5、回测策略 | 本机 MT5 / MetaEditor、研究执行环境、券商历史数据；Mac / Linux 通过 Wine 运行 MT5 |
| 自动修复终端启动配置、MT5 Python 接口 | 额外的 Windows Python / MetaTrader5 包；普通 MCP 行情连接不需要这项 |
| 实际挂载策略、交易 | 可用策略与账户，以及设置和 MT5 中明确开启的相应权限；安装应用不会自动开启交易 |

模型服务、券商账户及数据服务由用户自行准备。研究环境是额外安装，首次下载可能较大；Mac 建议额外预留 20 GB，Windows 环境安装器要求某个本地 NTFS 磁盘至少有 20 GiB 空闲空间。代理或公司网络可能需要单独配置。

## 3. 配置模型

1. 打开右上角 **User → 设置 / 模型**，选择提供商。
2. 在设置表单中填 API Key，或使用该提供商实际支持的登录方式。自定义兼容接口还需填写 Base URL 和模型名称。
3. 选择已认证且有额度的模型，再回到 Agent 窗口发送一句测试消息。

不要把密码和 API Key 发进聊天。订阅 ChatGPT 等消费产品并不自动等于所有 API 接口都有可用额度；具体取决于所选择的认证方式。遇到余额不足、更换模型或认证过期时，在这里处理。

## 4. 连接 MT5 行情与账户

1. 从 [MetaTrader 5 官网](https://www.metatrader5.com/) 或券商官方渠道安装 MT5，并在 MT5 内登录自己的账户。Mac 使用官方 macOS 发行包；Linux 需按 [官方 Linux 安装说明](https://www.metatrader5.com/en/terminal/help/start_advanced/install_linux) 配置 Wine。Sesame 不包含 MT5，也不包含券商账户。
2. 保持终端运行并确认已经显示行情。使用支持 MCP 的新版 MT5，在“工具 → 选项 → MCP”启用本机服务。
3. 打开 **Sesame → User → MT5 连接**，填入账户标识和终端提供的连接配置。交易终端常用本机端口 `22346`，MetaEditor 常用 `22345`，**以你自己的终端显示为准**。API Key 只填入对应设置框。
4. Sesame 会自动检查连接。也可以直接让主 Agent：“检查 MT5 连接并连接已配置的终端。”如果终端密钥尚未提供，Agent 会引导你填写。

只使用行情和账户查询时，交易终端连接已足够，不必为了消除状态提示而开启 MetaEditor、交易或宿主访问权限。账户的品种名称和交易时段来自券商；休市或无新成交时，图表价格不动并不代表连接故障。

**能连接但图表为空：** 核对终端账户是否与 Sesame 设置一致、品种是否属于当前券商、时间范围是否有数据。**认证失败：** 从 MT5 重新复制当前 MCP Key。**连接超时：** 检查终端是否运行、是否有阻塞登录弹窗、端口是否一致；不要将 MCP 端口公开到互联网。

## 5. 可选：启用研究代码环境

这部分供需要代码分析、文件读写、代码绘图、本地工具插件和隔离编译的用户安装。完成后退出并重新打开 Sesame，让应用重新检测。

### macOS：Lima

先按 [Homebrew 官方说明](https://brew.sh/) 安装 Homebrew，然后在终端运行安装包内的配置脚本：

```sh
bash "/Applications/Sesame.app/Contents/Resources/app/scripts/setup-macos.sh" --runtime-only
```

若你将应用放在其他位置，替换路径。脚本通过 Homebrew 安装 Lima、QEMU 和 guest agents，创建无宿主目录挂载的专用 Linux 虚拟机，在其中安装 Python、隔离工具和编译依赖，并复制本版运行模块。已有旧版研究环境会复用；无需手动创建共享目录。安装后要使用研究功能，虚拟机需保持运行。升级 Sesame 后可再次运行同一命令更新运行模块。

高级可选项：自动调整终端配置或调用 MT5 Python 接口还需要与 MT5 同一 Wine 环境中的 Windows Python。已安装并启动过官方 MT5 后，可用系统 Python 3 运行：

```sh
python3 "/Applications/Sesame.app/Contents/Resources/app/scripts/install-mt5-python.py"
```

没有 Python 3 时，可通过 Homebrew 安装 `python`。这会从 Python 官方与 PyPI 下载运行依赖，普通行情连接可跳过此步骤。

### Windows：专用 WSL

Windows 必须支持 WSL 2，BIOS / UEFI 的虚拟化功能需要开启。首次启用 Windows 功能可能需要管理员权限和重启。退出 Sesame 后，打开 PowerShell，运行安装目录中的脚本：

```powershell
& "$env:LOCALAPPDATA\Programs\Sesame\resources\app\scripts\setup-windows.ps1" -RuntimeOnly
```

如安装在其他目录，修改路径。脚本会安装或复用专用 WSL 发行版，启用 systemd，安装 Python、隔离和编译工具，并准备需要的 Windows Python / Node 运行组件。`-RuntimeOnly` 不运行 npm，也不要求源码仓库。应用下次启动会读取环境配置。

如果提示需要启用 WSL 或重启，请按提示操作，然后再次运行同一命令。若执行策略阻止脚本，请按你的组织允许的方式运行已核验的本地脚本，不要全局关闭执行策略。

WSL NAT 下，Windows 本机代理会自动改写为主机网关地址；代理也必须允许来自 WSL 虚拟网络的连接。仅绑定 Windows 回环的代理可考虑使用 Windows 11 支持的 WSL mirrored 模式。参见 [微软 WSL 网络说明](https://learn.microsoft.com/windows/wsl/networking)。

### Linux：系统隔离工具

推荐有 systemd 用户会话的 Ubuntu 24.04+ 或 Debian 13 桌面。研究执行需要 `bubblewrap`、Python 3、`libseccomp`、systemd 用户会话 / cgroup v2、可用的 user namespaces 和 `/dev/shm`；报告浏览器还需要 Chromium 的系统动态库。

`.deb` 会安装基础依赖。完整环境检查可运行：

```sh
bash /opt/Sesame/resources/app/scripts/setup-linux.sh
```

AppImage 可先用上文 `--appimage-extract` 解包，再运行 `bash squashfs-root/resources/app/scripts/setup-linux.sh`。脚本支持 Debian / Ubuntu 的 apt 环境。其他发行版按同等包名安装。编译 / 回测另需 Wine、Xvfb、Xauth 以及有效的 MT5 安装；这些并不由 AppImage 自动安装。受限容器、无 systemd 会话或禁用 user namespaces 的设备无法直接使用研究沙箱。

## 6. 网络权限与附加数据

模型聊天需要访问所选择的模型服务。**Agent 插件 → 网络权限** 决定研究工具的联网范围：受限模式通过受控公开 HTTPS 获取资料；全部网络模式允许代码和本地工具访问网络及下载依赖。按任务需要设置。

行情按需拉取并自动复用有容量限制的缓存。主 Agent 工作区、报告、策略和长期记忆会保留；subagent 的临时过程文件在任务结束时清理。重启应用不会自动重做尚未确认结果的交易或其他副作用操作。

## 7. 使用、更新与数据位置

图表、Agent、研究是水平排列的三个窗口。左右方向键平移工作区（输入时不抢键）；拖动窗口间分隔线调整其左侧窗口的宽度。图表内部滚轮优先缩放行情；图表间分隔线调整布局，双击空隙添加图表。可以直接让 Agent 添加图表、切换品种和周期、绘制指标或整理布局。

`@` 引用已有报告；`/clear` 仅清空当前可见聊天，保留实际记录与 Agent 上下文，生成期间不能使用。更多操作可直接问 Agent“教我使用 Sesame”，内置使用指南会按当前功能说明。

新安装默认把数据保存在：

- macOS：`~/Library/Application Support/Sesame/workspace`
- Windows：`%APPDATA%\Sesame\workspace`
- Linux：`~/.config/Sesame/workspace`（受 `XDG_CONFIG_HOME` 影响）

已有安装会继续使用旧数据位置，以保留聊天、密钥和研究产物。不要将工作区上传公开仓库；备份前请退出 Sesame，完整复制数据目录。卸载安装包不会主动删除工作区，Lima / WSL 环境也需另行管理。更新时先退出应用，再安装新版本；需要研究功能的 Mac 用户还应重跑本版环境脚本。当前版本使用手动下载更新。

遇到问题可先让 Agent 检查连接、模型与环境状态；提交 issue 时提供系统、架构、版本、复现步骤及脱敏错误，不要附账户密码、API Key 或完整私有聊天。
