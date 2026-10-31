# 按任务职责修正插件分类

状态：已实现并验证，源码尚未发布。用户于 2026-10-19 明确要求按插件在实际任务中的职责重新分类，前一版九类混合了业务主题与实现形式。

## 决策

主分类回答插件负责哪一段工作，不由 capability.kind、是否有代码、是否注册 Run 或是否包含 SKILL.md 推导。

| functionalCategory | 名称 | 判断依据 |
| --- | --- | --- |
| business | 业务流程 | 围绕完整任务组织目标、步骤、选择、验收与交接；文档指南和可执行工作流属于同一类。 |
| analysis | 专业能力 | 在给定输入和边界内提供可复用的知识判断、计算、解析或评估，不拥有完整任务的推进。 |
| integration | 资源接入 | 提供数据、搜索、终端、外部引擎或参考资源的访问、发现与适配。 |
| presentation | 交互呈现 | 组织可见的工作台、图表、报告及交互。 |
| platform | 平台管理 | 管理插件、配置、工作空间、记忆和宿主使用规则等基础能力。 |

ICT 与计算工具同属专业能力；因子研究指南与自动因子研究同属业务流程；MT5 与搜索信源同属资源接入。实现形式仍由 implementationKinds 独立描述。方法指南可以是 business / knowledge，领域知识可以是 analysis / knowledge。

## 实施顺序与保护

1. 先锁定上述代表性边界的回归，保留已有 identity、category、声明投影与来源隔离测试；逐包核对实际职责后再改映射。
2. 更新可信分类定义、56 包 policy、作者指导及生成脚手架中的分类说明。保留七个模板和既有调用接口，不按新主类搬动插件目录。
3. 同步网站词表、筛选与测试夹具；保留无新字段的已发布目录兼容，不替换公开预览、不部署。
4. 重新生成描述 inventory 和受影响的源码锁；验证分类、脚手架、来源固定、网站与发布校验。

配置声明、密钥存储、能力依赖和运行权限不从分类推导，沿用首批实现。既有工作树改动全部保留，不提交或发布。本轮不新增依赖。

## 取舍

五类按职责提供统一导航；交易、研究、策略等业务主题仍可从名称、描述和能力中查找。一个包有多种能力时按它负责的主要结果归类，并在文档说明边界；不为了分类拆包或强行改变业务实现。

## 验收记录

逐包读取职责说明后，最终为 business 7、analysis 31、integration 11、presentation 2、platform 5，共 56 包；49 包主类变化。完整映射及边界理由见[当前架构说明](../plugin-functional-architecture.md)。专业能力包括局部知识、分析与解析；资源接入包括离线参考目录和原生引擎。implementationKinds 的值保持不变，knowledge 的展示标题明确为“知识文档”。

更新了可信分类定义、policy 与 inventory、作者说明、脚手架说明、ICT README 及网站词表/筛选夹具。原方案与首批验收标注为历史记录。分类没有进入运行权限、配置依赖或安装授权逻辑。

| 验证 | 结果 |
| --- | --- |
| 新职责边界回归 | 修改前因 ICT 仍为 methods 正确失败；修改后通过，覆盖指南/工作流、知识/计算、获取/解析等边界 |
| taxonomy、脚手架、profiles、catalog compatibility、可信 CI catalog、R2 publication 组合 | 40／40 通过，无跳过；使用真实宿主 SDK loader 验证七种模板 |
| 网站全部测试 | 35／35 通过；同一 knowledge 实现类型可分别归 business 与 analysis，旧目录继续兼容 |
| 网站公开预览来源验证 | 54 条通过；preview.json、preview-source.json 与 CSS 字节未改 |
| 源码与网站双语词表 | 五个职责及五种实现类型逐项一致 |
| 公开接口和 policy 边界 | 本轮前后 112 个 plugin.json／capabilities.json 的 SHA256 相同；56 包 policy 除 functionalCategory 外所有字段相同 |
| 真实固定发布校验 | exit 0；56 包、2 个历史固定 R2 计划、v0.2.4 应用的 12 项资源；remoteChecked 为 false |
| 最终源码摘要与试点复核 | ICT README 残留修正后重新生成 optional 锁，core／optional 锁与 inventory 检查通过；profiles 与试点契约 7／7 通过 |
| 独立审查、语法及 diff | 发现的 ICT README 旧类名已修正；其余无阻塞，相关 JavaScript 语法与 diff 检查通过 |

上述测试组有交集，不能相加作为去重总数。真实固定计划校验完成后，仅追加 ICT README 的分类文字修正；固定提交和发布计划未变，最终源码锁与试点回归覆盖该修正。

最终源码锁：core `c18a8964ae4f9bafb57a70fa85ff65460d2fda5bc2f631718f9478a7a9ab3df2`，optional `ebf87576551341cf5c1b98665103bc918d2bfe0c649fdd452fcf4d598a8b6f99`。

未发布、部署或替换已安装插件；公开预览仍消费原有 54 包发布目录。新分类随正常发布与网站同步进入线上，不用本地描述 inventory 代替发布来源。
