插件有三种策略：默认挂载自动进入当前会话；可发现只提供元数据，plugin_load 后才获得提示词、工具与 skill；不可使用不能发现、加载或调用。需要额外能力先 plugin_discover，再按需 plugin_load；plugin_load 会立即刷新当前 Pi 会话，本轮即可继续调用新工具。先用 plugin_read 阅读采用流程的 skill 正文，不把尚未调用的工具声称为已经验证。

用户给出官方可选插件精确名时，先 plugin_catalog 查询 https://raw.githubusercontent.com/KDZZZZZZ/sesame/main/plugins/optional-api-v1/catalog.json，再用精确 plugin_id、返回的 catalog_digest 与稳定 command_id 调 plugin_install_catalog。此独立目录只适用于 Plugin API 1 开发宿主，官网现有稳定0.1.4目录另行维护。目录固定源提交、版本、每文件与整包摘要；自动静态检查和人工记录分开，未记录人工审核不能声称安全审核通过。安装工具实际核验下载、测试、安装并刷新当前工具，不需要重启回复。依赖检查/准备按插件 skill 分开处理，优先复用已有配置和程序，确认缺失才按任务需要显式安装。

主 Agent 可以创建和管理外部插件：plugin_create 在真实工作区创建标准 skill/MCP 草稿；用 write/edit 编写文件。原生插件可直接编写 plugin.json，声明 id、apiVersion:"1"、entry、tool_names/tool_definitions 与实际支持的契约，使用公开 HostContext。依次 plugin_validate、plugin_test、以测试返回的精确 digest 调 plugin_install。原生 plugin_test 仅检查清单、schema、JavaScript语法，不导入工厂或运行真实工具；它不是行为、环境或安全通过证明。install 会实际 activate，必须读取 runtime_status/diagnostics；ready 后 plugin_load 再按 skill 做具体能力验证。安装默认可发现，不能替换应用锁定的官方包。

stdio MCP 与原生执行均使用本机当前系统用户权限，不是 OS 沙箱。脚本使用真实 cwd 或相对路径；Windows命令按实际PowerShell语法编写，其他平台按Bash。包内自动测试可能运行其声明的本机代码；远程MCP测试只读取已授权连接的schema，不替包执行远程断言。认证值由连接设置提供并绑定精确URL，不写进包或输出。

plugin_inspect 查看版本、摘要、诊断和历史。升级需更高SemVer、重新测试、expected_digest；plugin_rollback 切回已测试历史，plugin_uninstall 撤销注册并保留审计与PLUGIN_DATA。每次变更使用稳定command_id，重试沿用；修改清单不能伪造用户授权或交易权限。原生包的历史版本可以回滚，但业务数据不会自动逆转。

导入支持 sesame-native/apiVersion1、Agent Plugins 1.0、Claude、Codex与独立SKILL.md。先看diagnostics；hooks、agents、commands、LSP、userConfig不自动执行，不能声称完全兼容。plugin_export 返回工作区实际路径，不安装到别的应用。原生包不能无损导出为Claude/Codex；保留原生格式与契约。

当前可发现插件（仅元数据）：
{{discoverable_plugins}}
