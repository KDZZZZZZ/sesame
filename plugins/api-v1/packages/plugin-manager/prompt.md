插件有三种策略：默认挂载自动进入当前会话；可发现只提供元数据，plugin_load 后才获得提示词、工具与 skill；不可使用不能发现、加载或调用。需要额外能力先 plugin_discover，再按需 plugin_load；plugin_load 会立即刷新当前 Pi 会话，本轮即可继续调用新工具。先用 plugin_read 阅读采用流程的 skill 正文，不把尚未调用的工具声称为已经验证。

用户给出官方或可选插件精确名时，先 plugin_catalog 查询 https://raw.githubusercontent.com/KDZZZZZZ/sesame/main/plugins/api-v1/catalog.json。统一目录固定已发布 development release、源提交、每文件与整包摘要，包含原生包和四个标准MCP包；只适用于匹配的 Plugin API 1 宿主，官网稳定0.1.4目录另行维护。自动静态检查、具名Agent审阅记录与人类批准分开，不能把未记录人工批准说成安全认证。

缺失包以精确 plugin_id、返回的 catalog_digest 与稳定 command_id 调 plugin_install_catalog，默认 action:install。已有同版本同摘要会明确返回 already-installed，不重测或覆盖；已有不同版本不能悄悄安装替换。先 plugin_inspect 获取当前 digest，再按用户更新目标显式传 action:update、expected_digest。工具会固定下载→每文件和tree校验→正式 plugin_test→plugin_update，宿主仍检查 expected_digest、更高版本、运行状态和原有迁移授权。原生检查不执行工厂；MCP测试会执行已固定的本地服务器和声明断言。返回后检查 runtime_status/diagnostics；允许加载时立即 plugin_load 刷新当前会话，禁用插件仍禁用。低版本请走显式 rollback，不改catalog绕过版本规则。一次操作重试沿用 command_id 和全部固定参数；目录变化先重新查询，用户另行决定后使用新操作ID。依赖准备按插件 skill 单独处理，先检查并复用已有配置和程序，仅为任务显式准备缺失依赖。

主 Agent 可以创建和管理外部插件：plugin_create 在真实工作区创建标准 skill/MCP 草稿；用 write/edit 编写文件。原生插件可直接编写 plugin.json，声明 id、apiVersion:"1"、entry、tool_names/tool_definitions 与实际支持的契约，使用公开 HostContext。依次 plugin_validate、plugin_test、以测试返回的精确 digest 调 plugin_install。原生 plugin_test 仅检查清单、schema、JavaScript语法，不导入工厂或运行真实工具；它不是行为、环境或安全通过证明。install 会实际 activate，必须读取 runtime_status/diagnostics；ready 后 plugin_load 再按 skill 做具体能力验证。新装包默认可发现；支持官方独立升级的宿主允许使用 plugin_update 显式固定新版本。旧式受保护内置插件仍由宿主拒绝，目录不能绕过该边界。

stdio MCP 与原生执行均使用本机当前系统用户权限，不是 OS 沙箱。脚本使用真实 cwd 或相对路径；Windows命令按实际PowerShell语法编写，其他平台按Bash。包内自动测试可能运行其声明的本机代码；远程MCP测试只读取已授权连接的schema，不替包执行远程断言。认证值由连接设置提供并绑定精确URL，不写进包或输出。

plugin_inspect 查看版本、摘要、诊断和历史。升级需更高SemVer、重新测试、expected_digest；plugin_rollback 切回已测试历史，plugin_uninstall 撤销注册并保留审计与PLUGIN_DATA。每次变更使用稳定command_id，重试沿用；修改清单不能伪造用户授权或交易权限。原生包的历史版本可以回滚，但业务数据不会自动逆转。

导入支持 sesame-native/apiVersion1、Agent Plugins 1.0、Claude、Codex与独立SKILL.md。先看diagnostics；hooks、agents、commands、LSP、userConfig不自动执行，不能声称完全兼容。plugin_export 返回工作区实际路径，不安装到别的应用。原生包不能无损导出为Claude/Codex；保留原生格式与契约。

当前可发现插件（仅元数据）：
{{discoverable_plugins}}
