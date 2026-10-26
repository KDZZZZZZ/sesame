# 宿主 Agent 与 Run 调用参考

本指南不提供工具。普通 Agent 和工作流使用同一套宿主 Run 生命周期，工具是否可用以当前工具列表和明确授予的能力为准。

| 能力 ID | Agent 工具名 | 输入与结果 |
| --- | --- | --- |
| `host.agent.run` | `host_agent_run` | `title/instructions/objective/input/allowedCalls` 定义任务，返回受理的 Run 引用。`plugins` 选择知识包，`model` 和 `output` 可选。 |
| `host.runs.list` | `host_runs_list` | 用 `sessionId/parentRunId/capabilityId/status` 等筛选运行，返回分页概要；不创建任务。 |
| `host.runs.read` | `host_runs_read` | `runId` 读取真实状态；可用 `include/cursor/limit` 读取消息、调用、事件、输出和资源。 |
| `host.runs.wait` | `host_runs_wait` | `runId` 配合 `until:"settled"` 等待最终结果；`until:"changed"`、`afterVersion` 用于观察变化。返回等待原因与最新 Run。 |
| `host.runs.interrupt` | `host_runs_interrupt` | `reason` 说明阻碍；子 Agent 省略 `runId` 时暂停自身，主 Agent 操作其他任务需指定 `runId`。 |
| `host.runs.resume` | `host_runs_resume` | `runId/interruptIds` 明确选择已处理的中断，`response` 提供解决信息；恢复同一个 Run。 |
| `host.runs.message` | `host_runs_message` | `runId/text` 向现有运行发送补充信息，不能代替明确的恢复操作。 |
| `host.runs.cancel` | `host_runs_cancel` | `runId` 和可选 `reason` 请求取消；以后续读取的真实状态确认收尾。 |
| `host.resources.read` | `host_resources_read` | 工具输入平铺为 `ref/part` 及可选 `entry/offset/length/encoding`，读取任务允许的固定资源；不扩大资源范围。 |

`instructions` 给出相关能力、因果明确的原则与约束，`objective` 给出可核验目标；不要让子任务重新猜测已经知道的输入或依赖。`allowedCalls` 使用 `{pluginId,capabilityId}`，其中 `capabilityId` 是局部 ID，例如 `{pluginId:"sesame/data-access",capabilityId:"data_query"}`。每个 Agent 自动拥有 host_runs_read / host_runs_wait / host_runs_interrupt / host_resources_read 四项基础能力；`allowedCalls:[]` 不授予业务工具、再次委派、恢复或取消权限。

`plugins` 只选择知识，不授予工具；工具所属插件会自动加入。选中包的 SKILL 入口正文直接可见，方法参考文件通过获授的 plugin_read 按需读取。纯知识无须虚构执行结果，未选中或被禁用的包不能借读取或再次委派加载。

`model` 省略时复用宿主配置，显式选择需使用 `host#models` 返回的 `{provider,id,configurationDigest}`。需要幂等操作标识时，通过 `host.capabilities.invoke`（工具 `host_capabilities_invoke`）向 `host.agent.run` 传递 `input` 和 `operationId`；不要把 `operationId` 塞入 Agent 任务输入或以新 ID 重启未确认的动作。

研究阶段、数据量大或复杂的分析任务，以及明确要求报告或指定报告路径的任务，必须传 `output:{type:"report",space:"research",path:"comparison.html"}`，也可用 `space:"strategy"`。工作流调用将同样的交付声明放入宿主调用选项 `task.output`。这是该 Run 的报告交付位置，正文标题由最终报告内容决定；宿主自动创建缺失父目录。单文件报告直接使用文件路径，不另包一层任务目录。直接父 Run 已绑定报告且本子任务负责共同交付时，可用 `output:{type:"report",target:"parent"}` 复用该文件。日常问答和其他不需要报告的简单任务可省略 `output` 或使用 `{type:"none"}`；这不适用于应交付报告的研究或复杂分析。已绑定 none 却需要交付报告时向所属 Agent 报告不匹配，不自行改绑定。

报告负责 Agent 的 `allowedCalls` 需包含实际写作、发布与核验能力。现有组合为 `sesame/reports` 的 `report_template`、`report_publish`、`report_check`、`report_read`，`sesame/workspace` 的 `read`、`write`、`edit`，读取固定数据的 `sesame/data-access#data_read` 和读取设计/方法资料的 `sesame/plugin-manager#plugin_read`；按 `{pluginId,capabilityId}` 逐项授予。绑定 output 只声明交付位置，不自动授予工具。遵循 reports 的统一视觉规则，发布后核验精确修订的实际 rendered 回执和最终文件路径。

受理返回的 `run.id` 是后续控制和读取的身份；只有 `completed` 的 `run.output` 才是最终结果，包含 `text/sessionId/model/turns/toolCalls`。等待超时只结束本次等待，不取消任务；`changed` 可因细小进度提前返回，不适合反复轮询最终成果。依赖缺失时暂停并报告具体需求，等待返回 `reason:"interrupted"` 后由主 Agent 核验并处理具体阻碍；已授权范围内可修复的依赖不要求新的用户回复。恢复前从同一 Run 读取待处理中断，明确选择实际解决的 `interruptIds`，是否需要用户输入遵循宿主控制契约，不默认把一个答复套到全部中断。正常结束由宿主收尾，无需另行完成调用；取消不回滚已发生的外部副作用，结果未知时读取 Run 与对应后端状态。

完成通知携带原 Run 身份，主 Agent 读取真实结果并核对报告文件当前路径、发布状态与该版本渲染回执，向用户简要汇报阶段发现、主要边界及报告位置。不能仅凭 Run completed 宣称报告可见；未交付时说明具体诊断并处理可修复的阻碍，不重做已完成的研究。若还有能推进原问题、价值明确且在已有授权内的下一阶段，实际创建对应 Run 后再说明已经在进行什么，不能把计划说成已启动。没有独立工作时可结束回复等待下一次完成通知，无需反复轮询来唤醒自己；通知不提供新的用户要求或权限，仍尊重明确暂停和取消。
