# 专业能力插件架构对齐

范围为 `inventory-policy.json` 中 31 个 `analysis` 包：8 个知识方法、18 个 ABU 局部计算、3 个内容解析器、factor-evaluator 和 strategy-authoring。Kurumi 与其它职责包不在本次改动范围内。

## 改动前计划

1. 冻结 31 包当前的 manifest、完整 capability 声明、公开资源路径、分类和实现类型；先运行回归，再修改说明或共用实现。
2. 保留已经清楚的边界：知识包的空注册入口和按需参考；ABU 的注册、基线算法、共用证据协议和 CLI；评估器的纯计算引擎与有状态协议；SVL 的现有语言、组合、执行回放和模型判断模块。没有维护收益的模块不机械拆目录。
3. 三个内容解析器的 `parser.js` 相同，建立统一维护源和自包含副本校验，保留各自 Python 格式处理、路径、能力和成果归属。修正分类说明中已经过期的 MCP 依赖描述及知识包版本说明。
4. 在已声明的 README/Skill/reference 内补包内职责、输入和交付边界、真实配置归属；列出 31 包逐项职责及保留现状的理由。无实际密钥依赖的包不新增配置。
5. 运行独立归档、契约、知识样例、ABU 数值/CLI/宿主、解析器宿主与评估器测试。锁和 inventory 由整合者统一更新，不覆盖历史发行目录。

## 验收记录

31 包职责、模块与配置审计见[完整专业能力清单](../analysis-plugin-responsibilities.md)。实现保持所有算法、注册工厂、声明、持久状态和能力接口；没有引入依赖。ICT 已符合试点结构而保留原文件，其余包在已声明的 README/Skill/reference 中补齐维护边界。

- 修正三个解析器在 inventory policy 中过期的 MCP 描述，七个知识包的旧 API/宿主版本文字，SVL 依赖文字中的旧最低版本；六个 ABU README 的 `dataset id` 旧说明改为真实返回的完整 ArtifactRef。
- 将逐字节相同的三个 `parser.js` 纳入现有 `sync-boundary-helpers.mjs`。唯一维护源为 `scripts/shared/parser.js`，包内仍各自交付；现有四个副本加上三解析器共七个，格式专属 `server.py` 不被同步覆盖。十八个 ABU runtime 继续使用既有同步机制。
- 当前分类保持 8 个 knowledge、22 个 function、1 个 service，合计 31 包；没有把知识方法改成业务流程，也没有把解析器改成资源获取。
- 31 包都没有独立待保存配置字段。解析器的 `requires` 已绑定实际宿主进程能力；SVL 模型配置和短期 bridge token、评估器会话及 ABU 调用参数分别保持原归属。没有新增虚构配置或凭据存储。
- 31 包的 JS/MJS/CSS/HTML/SVG 呈现色值扫描未发现绿色主题；宿主与报告呈现由本轮其它实施分支处理。

### 已通过

1. 修改前冻结与独立打包：`node --import ./modules/plugins/sdk-loader.js --test ../sesame/plugins/api-v1/tests/analysis-plugin-architecture.test.js`，32/32。冻结 31 包完整 manifest/capability JSON 摘要、33 个能力和全部原路径；逐包归档、解包、摘要校验、无邻居包导入及实际注册。
2. 原数值/协议/CLI 基线：18 包 `tests/baseline.test.mjs`、`abu-packages`、`abu-capability-contracts`、`method-packages`、factor-evaluator 的 `engine/protocol`、`strategy-methods`，151/151。包括时点、预热、留出、数量单位、调用归属、并发 CAS、固定成果和不可覆盖 CLI。此次未修改这些计算实现。
3. 修改后专业包独立归档与契约、`inventory-taxonomy`、`boundary-helper-sync`，38/38；没有跳过项。parser 副本漂移被检测，同步不覆盖格式专属 Python 实现。
4. `node plugins/optional-api-v1/scripts/sync-boundary-helpers.mjs --check`，7 副本通过；`node plugins/optional-api-v1/scripts/sync-abu-runtime.mjs --check`，18 副本通过。
5. 对新增测试、共享 parser、同步器及同步测试运行 oxlint，通过；对本分支已跟踪改动运行 `git -c core.whitespace=cr-at-eol diff --check`，通过；新文档相对链接全部存在。
6. `method-host`、`abu-host`、`source-parser-transport` 合计 9/9，通过且无跳过项。匹配 Runtime 实际安装全部八个知识包并隔离加载，ICT/Price Action 分别真实执行产生 5/6 行固定教学结果；十八个 ABU 包逐包正式安装、真实计算、保存成果，重开 Runtime 后知识和结果一致。三个解析器通过真实宿主进程读取固定来源，验证 2MiB 长文本、Unicode/编码、隐藏内容、长结果引用和原样例；未重取原来源。宿主组总耗时 188.7 秒，无模型、供应商或券商调用。

宿主测试使用 `SESAME_HOST_ROOT=E:/brief2great/sesame/mt5agent` 和 `SESAME_OPTIONAL_PLUGINS_DIR=E:/brief2great/sesame/sesame/plugins/optional-api-v1/packages`，由宿主仓库通过匹配的 SDK loader 运行。

### 整合项

本分支实现和验证已完成。core/optional 开发锁和 inventory 已由主整合分支统一生成，完整 catalog 校验通过（9 个 core、47 个 optional、2 份固定发布计划）；最终 30 项分类/分发/边界测试、56 项契约与独立归档测试通过，覆盖全部 55 个非 Kurumi 包。共享 helper 7 份、ABU runtime 18 份副本校验通过。全部工作为本地源码，历史发行摘要与已安装客户端未替换。宿主方法测试验证了固定报告资源与重开读取，不把报告渲染、模型研究质量或真实外部连接算入本分支的验收结果。
