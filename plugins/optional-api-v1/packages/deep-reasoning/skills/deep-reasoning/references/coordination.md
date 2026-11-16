# 使用现有宿主执行

本包给出完整方法，不注册独立执行工具。主 Agent 是协调者，真实调用宿主 Agent / Run 能力。它不依赖其他研究工作流或编排知识插件；需要的证据和报告能力按任务从现有插件发现、加载与授予。

## 1. 准备一次，独立提交

明确 E0 后，分别提交 H、D、G，三者互不等待。每个成员只拿到同一 E0、自己的方法页及相同的交付字段；不得把另一成员临时输出、协调者偏好的结论或预制综合故事塞进首次输入。

可调用 `host_agent_run`：

```json
{
  "title": "历史类比",
  "objective": "基于共同输入独立完成 H0，返回前提引用、机制摘要、条件结论和内部核验。",
  "instructions": "这是深度推理综合研究的内部 H 阶段。只读取 sesame/deep-reasoning 的 skills/deep-reasoning/references/historical.md 和本任务的 E0；不读取 D/G 临时结论，不再次委派，不另建报告。发现缺证据时写明需核对的事实与其影响。按任务 input.delivery 返回可审核摘要。",
  "input": {
    "evidence": "替换为本次真实完整 E0 对象或成员可读的固定资源引用",
    "delivery": ["path", "version", "evidenceVersion", "applicability", "claims", "checks", "conclusion", "revisions"]
  },
  "plugins": ["sesame/deep-reasoning"],
  "allowedCalls": [{"pluginId":"sesame/plugin-manager","capabilityId":"plugin_read"}],
  "output": {"type":"none"}
}
```

上例是参数骨架，不能直接把占位文字当作证据发送。D、G 只更换角色和相应方法页，不更改共同证据。完整合成输入与三个独立请求见包内 `examples/evidence.json` 和 `examples/parallel-tasks.json`，其中数据仅用于方法验收。

`plugins` 选择知识，不授予工具；`allowedCalls` 中 `capabilityId` 使用局部 ID。参考页通过 `plugin_read({pluginId:"sesame/deep-reasoning",part:"resource",path})` 读取。上例用于已有证据分析；需要新搜索、数据读取或计算时，把确实可用且协调者可授予的相应能力加入任务。成员发现新事实须交回来源，由协调者判断是否更新共同 E0 和受影响路径。不要因给了插件名就宣称成员有全部数据能力。

`model` 省略时复用当前已配置模型。独立 Agent 不要求不同模型，不凭三份意见宣称三个独立证据来源。实在不能创建成员时，可由同一 Agent 分开完成并冻结三条分析，交付时准确说明执行方式；不要用形式化多角色对话假扮真实 Run。

## 2. 保存 Run，核验后再交接

保存每次受理回执中的真实 `run.id`。独立任务全部提交后再等结果；`host_runs_wait({runId,until:"settled"})` 等待，`host_runs_read({runId})` 读取实际状态及输出。等待超时不代表失败或取消，受理不代表完成。成员失败或中断时读取具体原因，修复可恢复依赖并恢复同一 Run；不以新任务 ID 重复已完成工作。

H0 / D0 / G0 收齐后由协调者按协议检查内部完整性，再做成对比较。有缺陷只复核对应路径。定向修订输入只含冲突主张、责任前提、拟测操作、相关固定证据和原版本，不让全部成员反复从零开始。复核版本和依据保留在本任务成果或工作文件中，供后续综合读取。

如使用 `host_capabilities_invoke` 的 `task.collaboration` 展示协作图，它只描述关系，不会自动提交、等待或传递结果。真实并行由多个实际 `host.agent.run` 调用形成；不要虚构 `host.workflow.run`、`host.graph` 或 `dependsOn` 参数。

## 3. 唯一综合与报告

协调者可以自行综合发布，也可以安排一个综合子 Agent。后者的输入要有真实 E0、已核验路径结果、实质修订及未解备选；它不重新启动全部研究。完整研究给综合 Run 绑定：

```json
{"type":"report","space":"research","path":"deep-reasoning.html"}
```

路径按本次主题使用简短文件名，单份报告不再包一层目录。它是 `host_agent_run` 的 `output`，不是 `input` 内的自定义字段。仅直接父 Run 已绑定报告且本成员是唯一交付者时可用 `target:"parent"`。内部 H / D / G 使用 `output:{type:"none"}` 的前提是它们属于这份共同报告的内部分析阶段，不是另一个独立研究交付。

给交付者显式授予 `{pluginId:"host",capabilityId:"reports.describe"}` 与 `{pluginId:"host",capabilityId:"reports.publish"}`，先调用 `host_reports_describe` 取得当前选定报告提供方的实际 schema，再按它的合同准备内容并通过 `host_reports_publish` 发布。绑定路径不会自动赋予写作工具，也不固定使用某个提供方的旧参数。

当前选择 `sesame/reports` 时，按需要授予 `components_show`、`report_check`、`report_read` 及工作区、数据能力；已有结论和固定数据通过 `components_show` 交付，需要时再查组件目录。遵循当前报告插件指导，使用统一组件与渲染，核验对应修订的文件和 rendered 回执。不把 Run completed 或一个文件名当作报告已交付。

主 Agent 最后简述发现与报告位置；有价值明确且在原授权内的下一项检验可以安排后再说明已开始什么。没有新证据或新方向时结束本轮，不因“深度”二字持续制造任务。用户明确暂停或取消时遵循宿主控制。
