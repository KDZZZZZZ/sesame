# 可靠开发与故障恢复

插件出错时，主 Agent 必须仍能检查、修改草稿和安装修复版本。不要修改运行中的应用源码、启动器、插件管理/工作区修复工具或已安装摘要目录，也不要直接改数据库以伪造安装、测试或任务成功。内部和外部 Agent 都先在独立草稿目录实现，通过版本化安装接口启用；保留原有可用版本和用户数据。

## 工具工厂

`createTools(host)` 必须同步返回整个 `tool_names` 清单，在 main/subagent 场景下名称一致。工厂只定义工具，不能读取账户、创建服务、下载依赖或调用 host 操作。`activate` 注册服务/provider，工具 handler 执行业务。主控工具写进 `main_tool_names`；受限角色任务使用 `agents.submit({tools:[...]})`。不要通过过滤工厂返回数组控制可见性。

原生 `plugin_test` 仍不导入包或执行工具。安装时的新宿主在独立进程检查导入与导出；不依赖后台服务的工厂也在此检查。需要引用已初始化服务的工厂在 activate 后立即核对主/子作用域，通过后才切换持久版本；失败恢复旧服务。初始化只做短暂注册，长数据准备/依赖安装由显式工具承担，不能阻塞应用启动。

## 异步与图表

`host.layout.inspect()` 和 `apply()` 当前同步；`host.layout.script()` 必须 `await`。所有业务结果在返回时必须已完成，不含 Promise、host 对象或活动连接。`{overlay: host.layout.script(...)}` 是错误写法，必须先 `const overlay = await ...`。遇到 `plugin_unawaited_result` 时修正调用链，不用全局 `unhandledRejection` 或空 catch 隐藏错误。失败后检查实际状态，不重复可能已生效的动作。

首次挂载指标省略 `script_id`，由宿主创建实例。读取返回布局中目标图表的 `script_ids` 保存实际 ID；再次刷新用该图表仍拥有的 ID 替换，并保存新返回的 ID。用户删除图表、删除指标或改变绑定后，旧 ID 可能失效：先 inspect 再决定重建或替换。不要自造 `my-indicator` 作为实例 ID，不要覆盖其他图表的实例。

```js
const scene = host.layout.inspect();
const chart = scene.charts.find(item => item.id === chartId);
if (!chart) throw new Error('图表已移除，先核对布局');
const replacing = savedInstanceId && chart.script_ids.includes(savedInstanceId);
const layout = await host.layout.script({
  action:'put', command_id:operationId, expected_version:scene.version,
  chart_id:chartId, ...(replacing ? {script_id:savedInstanceId} : {}),
  artifact:indicatorRef, parameters:{},
});
return {layout};
```

挂载成功仍需检查对应实例/成果/代次的真实前端回执。重复刷新不能不断新增指标。provider 查询、模型调用、成果检查等异步接口也要逐层 await；模拟 host 不得把正式异步接口改成同步返回而掩盖问题。

持久存储 `host.storage.get(collection, id, optional=false)` 默认要求记录存在；首次启动、UI 备忘等可选状态必须传第三参 `true`，缺失时返回 `null`。不要让 mock 无条件返回 `undefined`，否则会漏掉首次运行错误。测试应至少有一轮使用真实宿主接口；替换指标的 mock 也必须移除旧实例、返回新实例 ID，不能原地保留旧 ID。

存储会规范化 JSON 对象的键顺序。比较持久化前后的来源、配置、幂等输入时，用深结构相等或同一种 canonical 编码；不能用普通 `JSON.stringify(a) === JSON.stringify(b)` 判断对象相等。数组的次序仍有语义，不能一概排序。对持续任务至少覆盖真实 Store 写入、读取、关闭/重新打开、继续执行，以及实际数据变化时仍拒绝的测试；不通过删校验或改库来“修复”误报。

## 安装、更新与恢复

遵循 validate → test → 精确 digest 安装/更新 → inspect → load → 真实能力验证。静态通过、安装通过、业务通过、前端渲染通过分别记录。更新失败时新宿主恢复旧服务；响应在提交后丢失时先 inspect 当前选中版本，不盲目重复安装。启动中断的坏摘要会被隔离；内置修复插件的坏覆盖版本回退到随应用提供的版本。修复用新版本和新 digest，或显式 rollback，不删除用户记忆、资金、历史数据和交易证据。

已有安装时使用 `plugin_update`，传入 inspect 返回的 `expected_digest` 并递增 SemVer。开发阶段也应使用递增的预发布版本（例如 `0.1.1-dev.1`、`0.1.1-dev.2`），不要为了复用旧版本号先卸载再安装：这样会提前移走可用服务，失去更新失败时的连续恢复路径。未安装时才用 `plugin_install`。

同步消息钩子抛错或返回 Promise 时，宿主隔离该插件并拒绝本条未经完整处理的消息；下一条修复请求仍可发送。不要循环重试同一个坏钩子，也不要绕开凭据处理直接转发原消息。配置保护钩子的拒绝仍然生效。通过插件管理检查诊断、修好草稿后更新。

包回滚只恢复代码选择，不逆转业务数据或外部操作。不要在 `activate` 里破坏性迁移数据、重置账户、发交易、修改系统环境或调用 `process.exit`。需要新数据结构时先验证副本，再原子切换，并保留旧版本能够读取的数据和迁移恢复路径。

调用付费角色 Agent 前，先用实际执行入口检查后端、固定依赖和数据是否就绪。准备与执行必须共用同一份就绪判断，不能一边认 `receipt.json`，另一边要求未生成的文件。覆盖已有环境复用、升级后复用和首次准备；检查通过后再 `agents.submit`。下游失败时保存已生成的判断及未提交证据，由明确的恢复操作核对，不能自动再付费或重放结果未知的操作。

## 必须覆盖的故障用例

- 主 Agent 与实际受限子 Agent 都能取得并调用正确工具；角色拒绝越权工具。
- 首次挂载、连续刷新、用户删图/删指标后的重建、无效 ID 拒绝；对应真实渲染回执正确。
- 异步操作拒绝/超时后，应用仍活着，主 Agent 能继续使用检查和修复工具。
- 坏工厂、失败的 activate、失败的更新不能覆盖可用版本；重启隔离后仍能安装修复版本。
- 每个测试明确 fixture/真实历史/真实模型/真实前端分别验证了什么，不拿单元测试或空报告代替端到端结果。

宿主不具备这些恢复能力时，不要假称已受保护；先保留已验证版本，向主 Agent 交付失败证据和修复草稿。此流程不赋予修改应用本体、发版或实盘交易的新授权。
