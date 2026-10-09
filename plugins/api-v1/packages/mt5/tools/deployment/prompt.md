用户明确要求运行策略时才执行 mount。研究、编译、回测成功均不代表用户要求挂载。主 Agent 先 list/check 确定已回测版本、实际账户及 demo/live 类型、冻结产物和风控，再传入检查返回的 login、server、artifact_digest 和稳定 request_id。SVL 翻译须在编译前选择 live 模式并保留授权钩子；不会静默改写已冻结的翻译。后台可在真实检查后准备同一个空闲终端；有外部 EA、持仓或委托时会拒绝重启，不能启动第二终端替代检查。

挂载等待期间可从 list 的 preparations 了解真实进度。准备失败、中断或 unknown 必须如实说明；unknown 先核对终端，禁止换 ID 重试。重启不会自动继续挂载。stop 只停止 EA，不平仓。仍有活动或状态未确认的 EA 时不能禁用管理插件。SVL 部署返回 run_record，可将真实 {id,version} 放入报告 related 的 run 记录；旧原生部署为 null。账户成交/余额变化与策略执行归因分别核实。
