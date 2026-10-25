# 工作流拆分验收 · 2026-10-18

本轮完成源码修改和隔离测试，未替换用户正在运行的应用，未发布，也未执行真实交易。

## 最终分工

| 插件 | 最终职责 |
| --- | --- |
| investment-research | 独立研究；注册 analyze / report 两个原生工作流，交付固定研究成果和经理图表报告，无账户依赖 |
| trading-decision | 消费固定研究、当前账户和风险规则；仅经理 → 执行员，保留授权调度、目标冻结和回执 |
| portfolio-execution | 独立账户执行；删除旧交易包导入桥和未使用的重复 tools.json 声明 |
| auto-factor-mining | 假设、实验和独立评价，不承担账户买卖决策 |
| kurumi-replay | 固定历史数据上的模拟和复盘，不承担实时研究或实盘执行 |
| reports | 共用展示能力；经理自己制作报告，无新增报告员 |

旧 manual-trading 源码包及分析入口已删除，无兼容别名。两个新包声明、配置说明、分发 profile 和 inventory 已同步。旧用户数据和原始研究成果保留。

宿主复用现有 Agent / Run / 资源接口，新增父报告输出选项及原生工作流协作声明。真实数据引用进入所属 Agent 的资源历史：只记录已核验的固定身份，支持分页、去重和并发隔离，不保存工具私密全文。研究成果据此保留来源，不依赖模型在最终文字里抄 JSON。

报告验收只接受精确修订的正式 inspector 回执。主 Agent 修复同一父报告后，原工作流可采用新修订继续完成，不重派已完成的经理。

## 验证

| 验证 | 实际结果 |
| --- | --- |
| 交易插件最终全套 | 150/150 通过；真实宿主、确定性模型及模拟账户，无券商请求 |
| 研究插件 | 14/14 通过，含真实安装器、8 Agent、SDK 数据读取到固定成果的完整链路；最终纯 Markdown 不丢引用，成员间不串来源 |
| 宿主报告、协作与数据引用 | 39/39 通过；另有能力/资源/Run 原有回归 24 项通过 |
| 宿主能力归属与工作流 Schema | 6/6 通过 |
| 分发 profile、目录和源码锁 | 13/13 通过 |
| 执行边界、调用链和目录兼容 | 14/14 通过；与上行部分目录用例重叠，不累加为独立总数 |
| 全部源码包声明和工厂 | 56/56 通过（9 核心 + 47 可选，含 Kurumi 开发源码）；不是外部服务可用性认证 |
| 静态检查 | 改动模块语法、lint、前端类型及 diff whitespace 检查通过 |

交易最终日志：`E:/brief2great/sesame/outputs/trading-decision-final-20261018.log`。
声明校验：`E:/brief2great/sesame/outputs/workflow-split-validation-20261018/declarations.json`。

## 配置的 6.1sol 真实测试与截图

使用配置的 OpenAI `gpt-6.1-sol`，从新 `investment_research_report` 入口重生 AAPL 经理报告。输入是此前真实研究的七份成员原稿、经理原结论、完整固定来源与已修正的 ATR 结果；没有重新取新闻、重跑分析师或连接交易账户。

结果：工作流完成，只启动一个经理；12 次工具调用，其中一次读取超出文件行号后纠正。经理实际发布报告并取得该修订的 `sesame-report-inspector` rendered 回执。未把这一项测试声称为新的八人实时研究或实盘验证。

报告只展示经理综合，包含价格走势、EPS 对比两张图表及条件判断表，方法和来源可展开。截图使用 Sesame 的 mountReport / mountArtifactReport、真实主题与固定数据路由；只扩大宿主视口以完整捕获 iframe，没有重画或替换报告内容。

- 证据：`E:/brief2great/sesame/outputs/real-research-20261018/manager-report-6/evidence.json`
- 原报告 HTML：`E:/brief2great/sesame/outputs/real-research-20261018/manager-report-6/manager-report.html`
- 内部渲染截图：`E:/brief2great/sesame/outputs/real-research-20261018/manager-report-6/manager-report.png`，1440 × 3347

真实研究与组合测试脚本也已改用新研究接口和宿主 Run；不复制模型认证文件，不读取旧插件私有业务数据库。
