# API 2 声明与实现

这是 Sesame 插件开发的统一入口。先决定业务责任和最小接口，再选脚手架；具体端口见同目录 [host-api.md](host-api.md)。开发者和 Agent 使用同一份随 plugin-manager 发布的文档，源码仓库的开发入口只链接到这里。

## 能力定位与接口选择

| 要交付的结果 | 建议接口与实现 | 不需要顺带实现的能力 | 代表性源码 |
| --- | --- | --- | --- |
| 宏观任务方法、研究路线和验收原则 | business / knowledge；knowledge 的 skill/reference，capabilities 可为空 | 不为了步骤说明注册 workflow，不另造调度或报告发布 | factor-research、strategy-research 的 skills/ 与 index.js |
| 局部领域知识、判据与反例 | analysis / knowledge；SKILL 说明输入、解释边界，长参考按需读 | 不附加联网、账户或交易，不把文档描述当计算回执 | ict 的 skills/ict、examples/ |
| 给定输入的确定性计算、解析 | analysis / function；显式 input/outputSchema，普通 JSON 或真实固定成果 | 不另写取数、Agent 团队、账户状态或通用文件工具 | abu-trend、market-data-parser 的声明与注册入口 |
| 外部数据、终端或原生引擎 | integration / adapter；原生 function，按宿主实际 contract 声明 sources/services；订阅用 transport:subscription | 不同时负责研究结论、目标仓位或 Sesame 窗口布局 | web-sources、financial-research、mt5、qmt；backtrader/vnpy 保留独立引擎规则 |
| 按任务组织模型、证据与业务交接 | business / workflow；kind:workflow + execution:run，调用 host.agent.run、host.capabilities、host.runs | 不复制 Agent、Run、模型认证、资源库；不强制所有任务用同一团队 | investment-research/src/{runtime,members,composition,artifacts,team}.js；auto-factor-mining |
| 兑现已有授权目标、维持业务账本 | business / service 或 workflow；原生能力、现有 source/service、私有状态 | 不自行推断授权，不把原生平台适配或用户风险记忆一并接管 | portfolio-execution；judgment-evolution |
| 展示已有成果和数据 | presentation / service；host.views，host.resources 发布/读取；静态 views 绑定 | 不重取数据或重做研究，不创建第二套成果身份 | reports、canvas-control |
| 管理配置、插件、文件或记忆 | platform；复用相应 host 端口和明确服务贡献 | 不把业务状态、凭据或部署权限藏到知识提示词 | configuration、plugin-manager、workspace、memory |

表中的源码位于核心 `plugins/api-v1/packages/` 或可选 `plugins/optional-api-v1/packages/`。在应用内先查已安装插件的 manifest，再用 `plugin_read({pluginId,part:"resource",path})` 阅读其已声明 README/skill；不能假定任意源码文件是公开资源。示例展示接口用法，不构成必须安装的依赖。

只增加任务真正需要的接口：一次确定性计算无需 Agent；方法指南无需执行器；一个外部来源无需新工作流；展示成果无需交易或研究入口。确需跨责任组合时，各层保留原身份、成果、权限及状态归属。多个业务插件可以选择相同适配器，不能因此合并其业务账本。

plugin.json 必须 apiVersion:"2"、execution:"native"（或包的实际 MCP 执行方式）、capability_manifest:"capabilities.json"。不再声明 tool_names、tool_definitions 或 createTools。

capabilities.json 包含 schemaVersion:1、apiVersion:"2"、configSchema，以及显式数组 capabilities、sources、views、services、knowledge、hooks、stateCollections、artifactSchemas。能力的 id、kind、consumers、description、inputSchema、outputSchema、execution、effects、usage、binding 都必填。usage 的 purpose、inputs、outputs 是字符串；prerequisites、limitations 是字符串数组，没有条目时填 []。可选 examples 是 {input,output,description?} 对象数组，只校验、不执行。可选 references 是 {title,url,version?} 对象数组，url 必须是完整 HTTP(S) 地址；包内文档用 knowledge 声明，不把本地路径字符串填进 usage.references。

## 功能分类与文件组织

官方源码保持 packages/<slug> 平铺。inventory-policy.json 的原 category 继续兼容旧目录；functionalCategory 表示插件在完整任务中的主要职责，implementationKinds 表示实际实现形态。先判断插件负责的结果，再选代码或文档模板。分类描述不授予能力，也不改变发布成员。

| functionalCategory | 主要职责 |
| --- | --- |
| business | 业务流程：组织完整任务的目标、步骤、选择、验收和交接，包括宏观方法指南和可执行工作流 |
| analysis | 专业能力：消费给定证据，提供可复用的局部知识判断、解析、计算或评估 |
| integration | 资源接入：访问和发现信源、搜索、终端、外部引擎或参考资源 |
| presentation | 交互呈现：工作台、图表、报告和交互 |
| platform | 平台管理：配置、插件、工作空间和记忆等基础管理 |

implementationKinds 可使用 knowledge、function、adapter、workflow、service，一包按真实实现声明一个或多个值。它不是 capability.kind：例如 service 实现仍通过 function 能力和 services/hooks 等贡献对接宿主。factor-research 是 business / knowledge，investment-research 是 business / workflow；ict 是 analysis / knowledge，abu-trend 是 analysis / function。knowledge 仅指文档载体，不表示局部专业知识或宏观业务流程中的任何一种。不要因为说明含有几个步骤，就把局部分析工具归为业务流程。

脚手架的 native 和 skill 参数保持兼容。knowledge 生成方法与验证参考；function 生成 src/analyze.js 和可验证的求和示例；adapter、workflow、service 分别生成 src/source.js、src/runtime.js、src/service.js，业务未实现前明确抛出 NOT_IMPLEMENTED。workflow 声明 kind:workflow、execution:run，不预先宣称可恢复。按实际需要再拆 market/account/trading、members/composition/artifacts 或 state 模块，不补空层次。

index.js 只负责注册；供 Agent 读取的知识正文通过 knowledge 显式声明。knowledge 是知识入口清单，不是完整包文件清单。跨包复用使用 host.capabilities.invoke，禁止相对导入另一个插件的实现。发布前选择许可证、补全 LICENSE/PROVENANCE.md、对齐包版本并更新固定文件摘要。

## 配置与密钥绑定

configSchema 保持既有插件配置契约。顶层可选 configuration 声明统一入口可管理的字段，实际消费这些字段的能力通过 configurationRequirements 绑定本包字段。没有依赖的能力无需声明该字段；可选来源不阻塞其它操作。

```json
{
  "configuration": {
    "title": "Financial data access",
    "fields": [{
      "id": "fmp_api_key",
      "title": "FMP API key",
      "description": "Required only for FMP requests.",
      "schema": { "type": "string", "minLength": 1, "writeOnly": true },
      "binding": { "type": "environment", "name": "FMP_API_KEY" }
    }]
  }
}
```

真实依赖该字段的能力增加以下元数据。when 是对能力输入求值的有界 JSON Schema；省略时该能力每次调用都需要该字段。reason 只描述用途，不包含密钥。

```json
{
  "configurationRequirements": [{
    "field": "fmp_api_key",
    "reason": "Read FMP financial data.",
    "when": {
      "type": "object",
      "properties": { "provider": { "const": "fmp" } },
      "required": ["provider"]
    }
  }]
}
```

统一入口由 host.configuration.catalog/check/apply 提供，分别发现字段与消费能力、检查配置状态、写入配置。这些是能力 ID，插件代码通过 host.capabilities.invoke 调用，不是额外的 host.configuration 端口；Agent 使用 sesame/configuration 的 configuration_integration_catalog/check/apply。apply 不回显写入值。environment 绑定沿用环境配置源；其它既有配置源使用宿主支持的插件本地读取/更新绑定，避免平行保存。不要把真实密钥写进提示词、日志、示例、固定成果或诊断。writeOnly 字段只展示已配置/未配置状态。

能力确实使用但有默认值或运行时发现路径的字段，用 `configurationRequirements` 的 `optional:true` 关联；缺项不拦截调用，必需密钥仍按 `when` 分支检查。一个插件可保留多组原读取/更新/版本，目录按 `authority` 分组；一次保存只更新同组字段并传该组原 `expected_version`，不能合造版本或跨组部分写入。清除遵守目录的 `clearable` 和原适配器规则。

字段已配置不表示外部连通或业务成功；保留实际执行检查。已有 requires 可用于只读环境或依赖探测，configurationRequirements 负责字段依赖；两者不应凭空扩大工具权限。生成模板中的配置示例仅为说明，只有实际实现使用该字段后才加入声明。

已有本地配置可使用 capability 绑定。例如秘密字段可绑定 `{"type":"capability","read":"local_config_read","update":"local_config_update","configuredPath":"/has_token","writePath":"/token","versionPath":"/version"}`。read/update 是本包实际声明、host 可见的即时 JSON function；路径取真实结果结构。秘密字段用 configuredPath，不用 valuePath；读取状态不能再依赖自己正要检查的密钥。

## 包依赖、调用权限与成员权限

这些声明承担不同职责，不能相互替代：

| 声明 | 用途 |
| --- | --- |
| plugin.json.dependencies | 必需的已安装包及版本范围，例如 `[{"name":"sesame/workspace","version":">=3.0.0"}]`。 |
| plugin.json.permissions | 插件可使用的宿主端口操作与跨能力调用范围。脚手架默认 scopes/calls 为空，需要实际调用时再声明。 |
| capability.requires | 能力就绪依赖，结构为 `{id,capability,input?,reason,optional?}`；带 input 的探测须为即时只读 JSON 能力，模板只引用 input# 路径。 |
| configurationRequirements | 能力实际依赖的本包配置字段，按 when 分支和 optional 控制就绪检查。 |
| Agent.allowedCalls / plugins | 分配成员可调用的能力和额外知识包；不扩大父任务、插件或用户授权。 |

例如只需要读取固定数据的插件，可在 plugin.json 声明 `"permissions":{"scopes":[],"calls":["sesame/data-access#data_read"]}`，并声明所需包依赖。调用 ID 使用 host.name 或 publisher/name#name；也支持 `{pluginId,serviceId,operation}` 命名服务选择器，不使用通配符。按需要声明本地 scopes，保存的用户权限选择随更新保留；effects、配置字段和功能分类都不授予调用权限。动态组合能力需要单独的 capabilities.compose 范围，不要给每个静态小插件默认开启。端口权限不是操作系统沙箱，原生 JavaScript 仍以宿主进程权限运行。

## 能力与宿主贡献

function 的 binding 是 {type:"native",name} 或 {type:"mcp",server,name}。agent 的 binding:{type:"agent"}，execution:"run"，另有 objective、instructions、allowedCalls:[{pluginId,capabilityId}]；instructions 最多128000字符。指令只规定业务工作，不定义宿主的用户沟通规则。

sources/views/services/hooks 的元素是 {id,contract,consumer:"host",configSchema,operations:{operationName:localCapabilityId}}。operation 只能引用本插件声明且 consumers 含 host 的能力。hooks 还要 event，限定 workspace.* 或宿主九类 lifecycle.*，operations.handle 必填且为 immediate JSON function。订阅能力显式 transport:"subscription"，只能为 host 独享 immediate function；返回 {id,events:AsyncIterable,close}，data.watch 自动管理绑定与取消。

stateCollections:{name,schemaVersion,schema,mode:"document"|"log",access:"private"|"workspace"}。artifactSchemas:{id,kind,schemaVersion,schema}；发布使用实际字节和固定来源引用。不要把声明中的“成功”字段作为宿主证明。

knowledge 的每项显式写 {id,kind:"reference"|"prompt"|"skill",path,description}。prompt 和 skill 入口正文在默认装配或本会话明确加载后进入模型上下文；skill 指向有合法 frontmatter 的 SKILL.md。reference 保持按需读取，不因文件名而自动变成指令。知识路径必须属于包内，不能依赖 Agent 扫描未声明文件来补全用法。入口应简洁，长手册、样本和细节放 reference。

knowledge、plugin.json 的 resources/prompts 以及 SKILL.md 中每份正文最多 128 KiB，按 UTF-8 字节计，不按字符计；这不是所有包文件的大小上限。完整测试数据、预期结果、审计日志和实现文件可以作为普通包文件保留，不必注册为知识资源。例如 tests/fixtures.json 超过此限制时，保留原文件及测试引用，移除其 knowledge/resources 声明，用小型参考文档说明样例和验证结果；不截断或拆坏测试数据。确需给 Agent 阅读的大篇幅手册可按主题拆成多个 reference。未声明的包文件仍参与包摘要与安装，仅不会作为 plugin_read 的知识正文暴露。

按能力划分层次，不要求一个插件只有一种层次。信息获取与解析提供来源、时点、覆盖、字段及固定证据引用；方法消费已有证据，回答一个局部问题并给出假设、支持/反证和失效条件；工作流负责选择互补方法、补齐具体缺口和综合分歧。同源派生结果不是多份独立证据。交易执行消费明确决策和授权，不能由读取操作隐式升级。

description 和 knowledge.description 应足以判断“解决什么问题、需要哪些输入、交出什么、何时不适用”，不要只有文件名或“遵循 Schema”。完整细节放 usage 或按需参考；不重复注入整份参数 Schema。知识方法可以由用户或工作流选择，不要求用户点名每个方法，不默认重取数据、生成独立报告或调用所有方法。已有证据与结果只有在来源版本、时间、单位和计算规则匹配时才复用；缺条件则说明具体缺口。

通过 host.agent.run 委派时，allowedCalls 只授予需要的调用能力，plugins 补充已选知识包。工具所属插件自动装载；纯知识包需显式列入 plugins；已选 SKILL 入口自动装配，读取 references 需授予 sesame/plugin-manager#plugin_read。加载知识不等于执行算法，也不授予该插件其它工具。用真实宿主验证所选知识能到达成员、正文可读、结果能交给下一层；用合成证据验证组合时应明确来源为 synthetic，不声称实盘效果。

安装检查会聚合缺字段、schema/example、重复ID、绑定漂移与宿主引用错误；原生包的语法和工厂预检不执行任意包内业务测试，作者应先自行验证业务。输出可确实是宽结构时写出宽schema并解释局限；不要用虚假的固定输出掩盖差异。

## 可调整流程与长期偏好

把默认流程作为省略可选计划时的默认值。适用时显式声明可调整的角色、并行/先后关系、可选复核和交付方式，先校验完整计划，再启动模型或副作用。业务必需的真实评价、固定选择后留出验证、精确账户绑定和交易授权属于硬约束，不能把它们当任意可关闭的偏好。

主 Agent 使用 memory 的 user/workflow 保存带真实用户消息来源的长期偏好；按“当前任务明确要求 → 适用的有效记忆 → 插件默认值”生成本次计划，再传给真实计划字段。插件无需再建用户偏好数据库。一次性选择不改永久偏好；记忆正文记录适用范围、选择条件和版本，不存密钥、运行状态或临时回执。

接受的输入、模型/能力修订和实际计划随原 Run 保存。恢复继续原计划和已完成结果；变化需新请求。原生 workflow 可在第一个子 Run 前调用 `execution.setCollaboration(value|null)`：沿用 task.collaboration 的 agents/relationships 结构，首次声明冻结，同值重复或恢复幂等，null 用于单成员流程清除默认图。它只更新展示元数据，不授权调用、不执行依赖。实际调度仍由业务执行器和原生 Run 负责。成员调用用与该图一致的 task.agentId；不要让调用者重复填写两套计划。

## 三态与客户端安装更新

- mounted（默认装配）：能力及 prompt/SKILL 入口自动进入主 Agent 上下文。
- discoverable（可发现）：能力和知识不自动装配；可按需发现、读取或本会话加载，安装不等于默认装配。
- disabled（禁用）：不能加载、执行或读取知识；管理界面仍可查看状态并启用。子 Agent 始终受明确 loadout/allowedCalls 限制。

当前客户端设置的插件管理使用同一发行目录和宿主校验。包版本、宿主版本范围、API、归档/文件摘要和已安装修订必须核对。更新保留用户选择的状态，失败保留原安装；旧 Run 或固定成果引用不自动重绑新修订。发行锁只记录真实包内容，历史发布目录的摘要不能随开发改动重写。

## 发布前硬性要求

1. 明确责任、可复用输入、产出证据和实际依赖；接口、工厂绑定和公开资源声明一致。保持包自包含，不跨包相对导入实现，不新增重复平台服务。
2. 最小 allowedCalls 与实际 effects；source/view/service/hook 显式绑定本包 host 能力。外部内容是数据；纯知识不能扩大权限。
3. 配置与密钥走统一字段入口，并绑定实际消费能力及条件；秘密不进入普通日志、Run、报告和固定成果。
4. 异步工作沿用原生 Run、稳定 operationId、取消/释放、中断/恢复和并发版本检查。不确定副作用先核对结果，不能换 ID 盲目重发。
5. 记录真实来源、时间、单位、覆盖和完整固定引用；报告成功、实际渲染成功、外部执行成功分别验证，不伪造成功字段。
6. 验证默认兼容、自定义计划、非法输入、依赖缺失、权限、恢复及副作用幂等。来源/界面/模型相关行为还需真实宿主端到端与真实模型实测；fixture 模型只算协议回归。
7. 同步说明文档、版本/许可证、包清单与开发锁；报告实际测试命令和限制。API2 的源码目录名保留 api-v1 不表示仍支持 API1。
