# 设置与插件连接

通过实际设置界面或 configuration_read 查看模型与偏好，configuration_update 使用读取的版本和稳定操作 ID。凭据使用相应安全配置入口，不在聊天回复、报告或记忆中回显。

默认配置插件不管理某个后端的账号。安装相应可选插件后，按它自己的状态、发现和配置工具选择已有连接；保留具体 provider、connection revision 与账户身份。MT5、QMT、AKShare 和 vn.py 的环境与权限分别检查，某一连接成功不证明另一后端可用。

插件的 mounted/discoverable/disabled 是工具可用策略；未安装与未加载不同。安装、加载、依赖准备、连接、回测及交易各自返回真实状态，不以一个开关或静态测试概括全部能力。被禁用的包不能绕过政策加载。

修改配置先读取现值，使用 expected_version；更新插件先读取 digest，正式测试后按 expected_digest 更新。结果不明先检查持久状态，不重复具有副作用的操作。
