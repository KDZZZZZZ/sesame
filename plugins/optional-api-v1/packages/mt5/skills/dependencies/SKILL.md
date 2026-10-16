---
name: dependencies
description: 先发现并复用 MT5、MCP、Windows Python 和 Wine，真实缺失时按需下载到插件私有目录，再核验所选编译或账户能力。
---

先调用 `mt5_dependencies`，参数 `{"action":"inspect"}`。MT5 程序、Windows Python、Wine 和虚拟机镜像不随 Sesame/插件安装；工具、原生适配代码、SDK 头文件与本指南随插件提供。`private_directory` 是此插件可持久保存下载和安装记录的目录，`scripts` 是当前已安装包的可信脚本路径。

## 先复用，再安装

1. 检查返回的 `discovered`、`settings` 和已有脱敏 `connections`；有 Terminal/MetaEditor MCP 配置时先用 `mt5_catalog` 查看各连接的当前目录，用 `mt5_connect` 核验绑定账户。MCP 能力可独立于本机安装存在，不为已有远程 MCP 额外启动第二个本机终端。
2. 本机路径不唯一或缺失时，用 `host_files` 的发现、读取和命令工具检查用户已有安装。Windows 查已安装应用与 `%APPDATA%/MetaQuotes/Terminal/*/origin.txt` 的安装/数据目录关系；macOS 查 MetaTrader 应用及其现有 Wine prefix；Linux 查现有 Wine prefix。读取已有配置时不把密码/token写回工具参数、报告或长期记忆。
3. 对已确认的安装调用 `mt5_dependencies configure`，传新的稳定 `command_id`、刚读到的 `expected_version` 和 `changes`。可分别指定 `terminal_directory`、`data_directory`、Windows `python.exe`、非 Windows 的 `wine` 绝对路径和 `wine_prefix`。编译使用本机 MetaEditor。配置不会覆盖文件、更改账户、下载软件或启动终端；运行中构建、Tester、持久 EA 的依赖不能被改指向别处。
4. 只有确认缺失的组件才下载。使用 `host_files_mkdir` 创建返回的 `private_directory`，用 `host_files_run` 的 `argv` 数组、真实 `cwd` 和有界 `timeout` 执行安装脚本；不要通过字符串拼接 shell。下载和记录放在该目录内；不要把第三方程序拷进插件源码或应用安装目录。安装器由本插件提供或来自下列官方来源，先核对来源、摘要或签名，再执行必要安装步骤。没有适用安装权限时说明实际失败条件，不转为模拟结果。
5. 安装后保存准确路径，再 `inspect` 带 `probe:true`。这只核对本机依赖路径，不能代替真实编译、Python IPC、终端账户或交易授权验证。

`null` 清除某个显式路径配置，随后重新发现；不能借此猜测切到另一个账户。保留运行中的用户终端、prefix、EA、持仓、挂单和历史配置。不因上游重装建议删除用户 prefix。

## 按需下载 MT5

- Windows：从 [MetaTrader 官方下载页](https://www.metatrader5.com/en/download) 或用户已使用的券商官方下载终端。保留原有账户安装；下载后检查 Windows Authenticode 的有效签名和发行者，使用官方安装器选择用户可写的新路径。已有可用终端无需重装。
- macOS：官方程序通过其附带 Wine 运行。[官方 macOS 指南](https://www.metatrader5.com/en/terminal/help/start_advanced/install_mac) 给出应用与 prefix。缺少安装器时，在主机执行返回的 `scripts['install-mt5-macos.sh']`，参数 `--directory <private_directory>/downloads`。此脚本只从固定 MetaQuotes HTTPS 地址下载，核验 Developer ID Installer 与 Gatekeeper，保留 SHA256，返回 PKG 路径；不会安装、启动、替换或关闭终端。之后按任务需要使用官方向导完成安装及首次初始化，准确记录其实际路径。不要为了安装依赖关闭已运行终端。
- Linux：平台通过 Wine 运行，见 [官方 Linux 指南](https://www.metatrader5.com/en/terminal/help/start_advanced/install_linux)。先复用已有 Wine；需要下载时先把官方脚本保存到插件私有 downloads、读取并核对来源再运行。系统包管理器所需权限由实际系统决定，失败如实返回。下载或启动终端不代表券商登录或交易许可。

## Windows Python 与 MetaTrader5 SDK

原生 MCP 不要求 Python IPC。插件本机编译/Tester 使用 Windows Job 进程控制器来只管理本次创建的进程树，Python IPC 另需官方 MetaTrader5 包。Windows x64 Python 可在 Windows 本机或非 Windows 的既有 Wine 中运行；不能把 `/usr/bin/python3` 配置成这里的 Windows `python`。

优先复用可用的 Windows Python，并通过只读 `version`/目录检查验证官方包。需要新安装时，用主机上已有的 Python 3.9+ 执行返回的 `scripts['install-mt5-python.py'] --directory <private_directory>/python`。它从 Python.org/PyPI 的固定 URL 获取固定版本，逐包核对 SHA256 与大小，拒绝危险压缩路径和已被修改的目标目录，以同目录原子重命名完成安装；不运行下载的代码，不调用全局 pip，不改已有 Wine prefix。保留安装清单与第三方许可证。没有主机 Python 时先从 [Python 官方下载页](https://www.python.org/downloads/) 安装适用主机解释器来运行下载脚本，或者使用已有更新的 Windows Python 配置，无需改本体。

当前兼容组合为 CPython 3.12.10 Windows x64、NumPy 1.26.4、MetaTrader5 5.0.6231；这是可重复的兼容组合，不宣称是各项目最新安全版本。已验证可用的更新 Python/SDK 可直接配置复用，不降级替换用户安装。参考 [MQL5 Python 安装说明](https://www.mql5.com/en/book/advanced/python/python_install) 与包内固定下载清单。第三方许可证仍各自适用。

完成后 `configure` 的 `python` 指向返回的 `python.exe`。验证时先确认现有终端和账户，用 `mt5_catalog server:python` 读取 schema，再用 `mt5_python` 调实际只读版本/账户查询。文件存在不等于 IPC 就绪；初始化可能触发官方 SDK 寻找或启动终端，必须沿用已选路径，不靠自动登录猜测账户。

## 本机编译

优先发现 `mt5_catalog server:metaeditor`。现有官方 MCP 可以用 `mt5_edit` 和它的真实方法/schema 编译原生编辑器文件，不杜撰方法名。独立工程的 `mt5_compile` 固定源码 revision、标准库、MetaEditor 摘要，按本机命令行 `/compile`、`/include`、`/log` 编译，核对真实 UTF-16 日志与 EX5 摘要。官方语义见 [MetaEditor 命令行](https://www.metatrader5.com/en/metaeditor/help/beginning/integration_ide)。编译完成不执行 EA。

默认 native 不要求 Lima、WSL、容器、系统 OS 沙箱或编译镜像。临时 Wine prefix 与 Windows Job 用于区分并清理本次进程，不是任意策略执行的安全沙箱；不会调用用户 prefix 的 wineserver 终止命令。成功结果保留实际 backend 与清理回执；清理未确认则保留现场并返回 `runtime_cleanup_failed`。

最终执行一次实际 `mt5_compile` 并查看诊断，随后有需要才发起真实 Tester。账户、行情、原生回测和交易权限分别验证；不可用能力不通过假数据或空成功结果替代。
