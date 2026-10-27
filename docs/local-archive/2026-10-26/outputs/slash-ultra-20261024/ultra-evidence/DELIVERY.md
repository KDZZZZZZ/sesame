# Ultra 官方插件交付

2026-10-24，`sesame/ultra` 1.0.0 源码冻结。插件包 14 文件，另有 2 个独立宿主契约测试，共 16 个源码文件。包内包含原创 MIT LICENSE 与 PROVENANCE.md。这个子任务未修改宿主、其他插件、发行锁、inventory 或真实应用，未访问真实模型、行情、账户或执行交易；主任务的真实模型集成验证另见下文。

提供 `ultra_start/status/dispatch/wait/resume/stop/finish` 和宿主内部 `ultra_cycle`、`ultra_before_turn`、`ultra_after_turn`，共 10 个 native 能力。目标与分支通过公共 state CAS 持久化，真实 native workflow/Agent/Run 完成通知负责被动续办。主 Agent 在真实主会话中派发原工作流，保留现有 main-only 入口限制。周期通过 runs.watch、具体时间或声明来源订阅等待，无空轮询。

本次增强让主 Agent 每轮对照原目标找缺口、探索新方法/数据/验证、更新优先级、登记新分支和补空闲槽位，分支执行期间继续搜寻并排队下一批工作。公开 afterAgentTurn hook 在所属 main 真实结束一轮后观察状态：先通过公开 host.sessions.query 确认主会话 idle 且无 activeResponseId，排队通知或仍在进行的回复不创建重复探索；终态及明确等待在查询前直接返回。空闲后优先补已经登记的可执行工作，没有活动周期或明确等待时创建真实探索周期；规划包含已有结果、失败、真实 Run 和上轮计划。每次 hook 最多补一批即时工作，然后登记真实周期，避免占用回调太久。

调度异常保护的指纹仅包含实质方法/结果/错误、可用能力版本、真实观察和可信新输入，不把改写计划或更新时间当进展。若同一方案再次被遗漏执行则保留成果并报告 CONTINUATION_STALLED，既不宣称完成，也不要求新批准；新方法直接派发、新验证结果或依赖变化可继续。正常探索无总轮数上限。停止、完成、明确等待及真正依赖中断都不会被 after-turn hook 擅自重启。

分支稳定键、参数指纹、精确能力修订与 operationId 在调用前保留。执行通道根据已声明交易副作用及 Agent 精确工具清单串行，独立研究仍可并行。循环没有默认总轮数限制；等待输入显式保留原因；重复失败的分支不自动重新派发，未知外部结果要求核验原操作。所有领域交易授权、命令幂等与实际账户行为由既有插件承担。

stop 保存停止边界，取消登记 Run 及子树，执行明确登记的领域 stop。宿主尚未确认实际退出时保留 stopping；外部已成交事实不会回滚。beforeAgentTurn 只记可信人类输入 ID/计数，旧 automation/delegation 或人类消息重放不能重新启动已停 Ultra。已核对真实宿主：Runtime.accept 的 source 是原始来源会话 ID，PluginRegistry 原样传入 lifecycle；任意非空 source 都视为非人类输入。新增 source:'conv_child_research_123' 回归先复现 authority 从 1 错误增长到 2，修复后停止状态与 authority 均保持不变。resume 复用原 Run 和原定时时点，不重新执行已完成分支。

验证：36/36 tests，0 failed，0 skipped；33 项运行真实插件实现与确定性端口夹具，3 项使用实际宿主契约。包契约覆盖 inspectPackage、validateCapabilityManifest 和 native binding；生命周期契约实际执行 PluginRegistry.afterTurn → lifecycleService → lifecycleCall，并使用宿主 schema worker 与 createCapabilities 绑定，验证 input 投影和真实 main owner 身份。新增完整实际 Runtime、CapabilityService、HostContextV2、RunService 与插件安装/挂载链，只有模型推理使用确定性替身；回调返回后 cycle/planner 保持 running、signal 未 abort，释放后真实 Run 完成；实际 queued/working 会话不会增加探索 Run。宿主契约测试留在包外，符合构建器禁止包内跨目录 import 的规则。另有 oxlint 与全部 9 个 JS/MJS 源码的 node --check。只读 buildLock 验证通过全部 49 个 optional 包，Ultra 包 14 文件。`verification.json` 含命令、退出码、16 文件 SHA-256；`tests.log` 为完整结果；`package-lock-validation.json` 为包规约验证。验证脚本从测试输出与包文件自动计算计数，避免手写数字过期。代码是 JS，未引入 TypeScript 工程或新依赖。

当前 Ultra treeDigest：`sha256:b840733ab9a256a6a3df5cb50cfa45af20af6a464153c43d99ea95e9b561d8eb`。未写全局 lock，主任务负责最终组包锁与集成。

主任务已用 OpenAI gpt-6.1-sol 完成先前版本的隔离工作区 smoke，证据：`../real-model-JF2Lzq/evidence.json`，状态 passed。实际 planner、两个并行 Agent 分支和监督周期完成后，主 Agent 经自动通知执行 ultra_finish，无额外继续消息。该 smoke 使用 source 判断修复与本次 after-turn 增强前已冻结的包，只证明先前正常启动与续接链。后续 `../real-model-nGeuWe/evidence.json` 暴露额外探索 Run 被回调正常返回错误取消的问题；主任务已修复宿主成功回调的信号生命周期，本包补全真实队列空闲检查。最新实现由上述 36 项测试验证，最新真实模型集成由主任务另行运行和记录。

机制边界：现有主会话限定的业务 Run 与监督周期分别是实际根 Run，宿主可能分别发完成通知；常驻 prompt 要求以 Ultra 持久状态去重，不能把通知数量当作任务数量。没有增加消息入站权限或私有宿主访问。该实现不代替领域工作流内部的工具重试控制。
