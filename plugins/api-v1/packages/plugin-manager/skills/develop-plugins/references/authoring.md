# API 2 声明与实现

plugin.json 必须 apiVersion:"2"、execution:"native"（或包的实际 MCP 执行方式）、capability_manifest:"capabilities.json"。不再声明 tool_names、tool_definitions 或 createTools。

capabilities.json 包含 schemaVersion:1、apiVersion:"2"、configSchema，以及显式数组 capabilities、sources、views、services、knowledge、hooks、stateCollections、artifactSchemas。能力的 id、kind、consumers、description、inputSchema、outputSchema、execution、effects、usage、binding 都必填。usage 包含 purpose、inputs、outputs、prerequisites、limitations，可加惰性 examples（input/output）和 references。examples 只校验，不执行。

function 的 binding 是 {type:"native",name} 或 {type:"mcp",server,name}。agent 的 binding:{type:"agent"}，execution:"run"，另有 objective、instructions、allowedCalls:[{pluginId,capabilityId}]；instructions 最多128000字符。指令只规定业务工作，不定义宿主的用户沟通规则。

sources/views/services/hooks 的元素是 {id,contract,consumer:"host",configSchema,operations:{operationName:localCapabilityId}}。operation 只能引用本插件声明且 consumers 含 host 的能力。hooks 还要 event，限定 workspace.* 或宿主九类 lifecycle.*，operations.handle 必填且为 immediate JSON function。订阅能力显式 transport:"subscription"，只能为 host 独享 immediate function；返回 {id,events:AsyncIterable,close}，data.watch 自动管理绑定与取消。

stateCollections:{name,schemaVersion,schema,mode:"document"|"log",access:"private"|"workspace"}。artifactSchemas:{id,kind,schemaVersion,schema}；发布使用实际字节和固定来源引用。不要把声明中的“成功”字段作为宿主证明。

knowledge 的每项显式写 {id,kind:"reference"|"prompt"|"skill",path,description}。prompt 装载后进入模型上下文；skill 指向有合法 frontmatter 的 SKILL.md 并加入技能列表；reference 只提供按需可读资料，不因文件名而自动变成指令。知识路径必须属于包内，不能依赖 Agent 扫描未声明文件来补全用法。

安装检查会聚合缺字段、schema/example、重复ID、绑定漂移与宿主引用错误。输出可确实是宽结构时写出宽schema并解释局限；不要用虚假的固定输出掩盖差异。
