# Ultra 状态、关闭与流光效果

已完成并构建；当前真实 Sesame 尚未切换，正在运行的黄金策略研究保留。

## 使用规则

- Ultra 状态由插件工作区中的 sessions.continuation/status 及 owners 指针持久保存。它按主会话隔离，跨普通消息和回复轮次延续，不依赖历史消息中是否出现 /ultra。
- 开启时，最大化有意义的并行探索是强制工作原则，继续使用既定目标、真实依赖及 max_parallel 上限。
- 点流光胶囊的 ×，或输入 /ultra off（/ultra close 同义），立即解除该强制。现有研究、Run 与订阅继续；主 Agent 恢复普通模式，仍可按需使用子 Agent 和工作流。关闭后不显示任何收敛状态。
- /ultra resume 明确重新开启原任务；/ultra status 查看状态；/ultra stop 仍是明确停止全部 Ultra 工作，和温和关闭区分。
- 刷新不丢失模式。进程重启保留目标和模式记录；被宿主标记为中断的执行不会被状态查询自动恢复，需要明确继续。
- 活动回复没有真实思考时显示“正在思考”或“正在使用工具”；实际思考/摘要优先，原曲线和计时保留。

## 实现与验证

官方 Ultra 插件升级为 1.0.2；宿主只增加状态投影、即时关闭命令与模型专用的当前模式提示。状态提示不进入用户气泡；查询失败不阻塞普通问答。

关闭代际栅栏防止较早的在途 start/resume 在关闭后偷偷重新开启。已有任务不被取消；重复查询同一异常状态不再反复写入插件状态。

- 插件及真实宿主契约：55 项通过。
- 前端逻辑：21 项通过。
- UI：Ultra 8 项、活动状态 11 项、思考展示 16 项通过；无页面异常。
- 类型检查与生产构建通过；lint 只有原有 Fast Refresh 警告，构建保留原有体积提示。
- 安装包独立验证：246 个模块文件与源码相同，58 个插件身份保留，Ultra 1.0.2 正常加载；状态接口、温和关闭及幂等通过，未发送研究/模型请求。
- 宿主命令与菜单最终整套 24 项通过（final-host-unit.log）。

## 构建与本地数据

新版程序：

E:\brief2great\sesame\outputs\ultra-lifecycle-status-20261025\bundle-fFCcHk\package\win-unpacked\Sesame.exe

沿用运行目录：

E:\brief2great\sesame\mt5agent\output\desktop-run-20261023-Ghxz3z

后续切换应使用 bundle-state.json 中的 launchEnvironment，保留当前 E 盘 user-data/workspace/pi，不以默认参数直接双击打开另一份数据。当前程序未重启、未更新其插件、未改变账户模型或研究任务。

## 本轮变更记录

- change-manifest.json：30 个本轮源文件的前后哈希。
- task.mt5agent.patch、task.sesame.patch：相对本轮开始状态的精确 diff，保留工作区既有改动。
- captured/：已验证代码快照；baseline/：修改前源文件。
- ultra-ui/：浅深色截图与 UI 检查；ultra-plugin-tests.log、final-host-unit.log、frontend-unit.log：逻辑验证；package-verification.json：打包验证。
