用户明确说挂载某策略、或在界面手动点击挂载，才执行 mount。研究、编译、回测成功均不代表用户要求挂载。主 Agent 先 list/check 确定已回测版本、账户、冻结产物及风控，再传入检查返回的 login、server、artifact_digest 和稳定 request_id。后台会自动准备终端、必要时升级原冻结版本并按原参数重新回测，然后挂载；不用让用户打开交易权限或另外点击自动准备，不启用 mt5-trading/mt5-system。

挂载等待期间可从 list 的 preparations 了解真实进度。准备失败、中断或 unknown 必须如实说明；unknown 先核对终端，禁止换 ID 重试。重启不会自动继续挂载。stop 只停止 EA，不平仓。用户关闭本插件时尊重其选择。
