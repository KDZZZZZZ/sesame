# 本地研究、报告与修改记录归档 · 2026-10-26

该归档与宿主、插件、网站的 `feat/local-20261026` 源码快照配套。保留本地实际研究报告、阶段分析、设计/提示词审阅、测试总结及报告必要配套；原文件留在本机。

## 从这里开始

- [研究报告体系：Trading Central、Autochartist 与 Sesame](outputs/研究报告体系-Trading-Central-Autochartist与Sesame-20261026.md)
- [同一研究的交互网页版](outputs/研究报告体系-Trading-Central-Autochartist与Sesame-20261026.html)
- [244个业务字段的CSV](outputs/研究报告体系-Trading-Central-Autochartist与Sesame-20261026-字段字典.csv)
- [发布-dev-本地差异与测试修改汇总](outputs/发布-dev-本地差异与测试修改汇总-20261021.md)
- [未推送改动与构建覆盖](outputs/未推送改动与构建覆盖-20261025.md)
- [默认插件提示词逐文件摘要](outputs/默认插件-提示词逐文件摘要-20261026.md)
- [宿主系统提示词中文版审阅稿](outputs/Sesame-宿主系统提示词-中文版审阅稿-20261026.md)
- [使用帮助时效核对](outputs/使用帮助时效核对-20261026.md)

## 文件组织

`outputs/` 保留原成果的相对目录；`research/` 保存独立研究笔记。历史报告按当时版本保存，日期和结果不改写成当前事实。GitHub直接阅读Markdown；HTML下载后在浏览器查看。

本次归档 **572 个文件，30.80 MiB**。完整路径、文件大小、源/归档SHA-256及改写记录见 [manifest.json](manifest.json)。

运行数据库、账户配置/密钥、原始会话/界面日志、浏览器与依赖缓存、安装包、构建快照和第三方源码副本不纳入公共仓库。文档中的具体账户/订单等标识与本机用户配置路径已在归档副本中替换；研究或测试结论保持原意。

部分历史文档保留 `E:/...` 的源码行号与证据链接，它们是原开发机定位信息，不能在GitHub直接打开；相对报告链接及本次研究的旁路核对笔记保留。已收录报告所引用的本地图片/脚本；不自动上传未引用的原始截图或运行数据。

## 复现本次报告

`outputs/build-research-catalog-20261026.py` 与 `verify-research-catalog-20261026.py` 使用归档相对路径；报告生成依赖仓库内现有reports主题/模板，Python需要markdown、BeautifulSoup。渲染检查另需Playwright和本机Edge。脚本不会调用模型、行情或交易。

`archive_documents.py --workspace-root <原本地工作区>` 可按相同筛选/脱敏规则重新建立归档；它不改原文件，不执行Git提交或推送。归档是一次快照，后续重建前应重新审阅新增文档。

## 分类索引


### 顶层研究与汇总 · 33

- [20261015-dev-resource-cleanup-pr.md](<outputs/20261015-dev-resource-cleanup-pr.md>)
- [Autochartist-官方核对-20261026.md](<outputs/Autochartist-官方核对-20261026.md>)
- [Sesame-Agent-基础提示词-20261022.txt](<outputs/Sesame-Agent-基础提示词-20261022.txt>)
- [Sesame-Agent-基础提示词-中文译文-20261022.txt](<outputs/Sesame-Agent-基础提示词-中文译文-20261022.txt>)
- [Sesame-Agent-基础提示词-助手探索版-20261022.txt](<outputs/Sesame-Agent-基础提示词-助手探索版-20261022.txt>)
- [Sesame-Agent-基础提示词-助手探索版-中文-20261022.txt](<outputs/Sesame-Agent-基础提示词-助手探索版-中文-20261022.txt>)
- [Sesame-Agent-系统提示词目录-20261026.md](<outputs/Sesame-Agent-系统提示词目录-20261026.md>)
- [Sesame-宿主系统提示词-中文版审阅稿-20261026.md](<outputs/Sesame-宿主系统提示词-中文版审阅稿-20261026.md>)
- [Sesame-提示词与真实回复复测记录-20261022.md](<outputs/Sesame-提示词与真实回复复测记录-20261022.md>)
- [Sesame-研究字段能力核对-20261026.md](<outputs/Sesame-研究字段能力核对-20261026.md>)
- [Trading-Central-非技术领域核对-20261026.md](<outputs/Trading-Central-非技术领域核对-20261026.md>)
- [build-research-catalog-20261026.py](<outputs/build-research-catalog-20261026.py>)
- [dev同步与启动修复-20261025.md](<outputs/dev同步与启动修复-20261025.md>)
- [general-analysis-and-writing-method-20261018.md](<outputs/general-analysis-and-writing-method-20261018.md>)
- [prompt-audit-20261020.md](<outputs/prompt-audit-20261020.md>)
- [release-feature-audit-20261020.md](<outputs/release-feature-audit-20261020.md>)
- [research-catalog-body-20261026.md](<outputs/research-catalog-body-20261026.md>)
- [trading-decision-validation-20261018.md](<outputs/trading-decision-validation-20261018.md>)
- [update-default-guide-summary-20261026.py](<outputs/update-default-guide-summary-20261026.py>)
- [verify-research-catalog-20261026.py](<outputs/verify-research-catalog-20261026.py>)
- [使用帮助时效核对-20261026.md](<outputs/使用帮助时效核对-20261026.md>)
- [发布-dev-本地差异与测试修改汇总-20261021.md](<outputs/发布-dev-本地差异与测试修改汇总-20261021.md>)
- [未推送改动与构建覆盖-20261025.md](<outputs/未推送改动与构建覆盖-20261025.md>)
- [研究报告体系-Trading-Central-Autochartist与Sesame-20261026-字段字典.csv](<outputs/研究报告体系-Trading-Central-Autochartist与Sesame-20261026-字段字典.csv>)
- [研究报告体系-Trading-Central-Autochartist与Sesame-20261026-字段字典.json](<outputs/研究报告体系-Trading-Central-Autochartist与Sesame-20261026-字段字典.json>)
- [研究报告体系-Trading-Central-Autochartist与Sesame-20261026-核验.json](<outputs/研究报告体系-Trading-Central-Autochartist与Sesame-20261026-核验.json>)
- [研究报告体系-Trading-Central-Autochartist与Sesame-20261026.html](<outputs/研究报告体系-Trading-Central-Autochartist与Sesame-20261026.html>)
- [研究报告体系-Trading-Central-Autochartist与Sesame-20261026.md](<outputs/研究报告体系-Trading-Central-Autochartist与Sesame-20261026.md>)
- [默认插件-提示词逐文件摘要-20261026.md](<outputs/默认插件-提示词逐文件摘要-20261026.md>)
- [默认插件-整理后提示词计数-20261026.json](<outputs/默认插件-整理后提示词计数-20261026.json>)
- [默认插件指南整理与接口核对-20261026.md](<outputs/默认插件指南整理与接口核对-20261026.md>)
- [默认插件指南整理计划-20261026.md](<outputs/默认插件指南整理计划-20261026.md>)
- [personal-trading-methodology-2026-10-16.md](<research/personal-trading-methodology-2026-10-16.md>)

### agent-collaboration-visual-references · 8

- [agentprism-sequence.png](<research/agent-collaboration-visual-references/assets/agentprism-sequence.png>)
- [agentprism-tree.png](<research/agent-collaboration-visual-references/assets/agentprism-tree.png>)
- [autogen-team.jpg](<research/agent-collaboration-visual-references/assets/autogen-team.jpg>)
- [eigent-workforce.png](<research/agent-collaboration-visual-references/assets/eigent-workforce.png>)
- [sim-inspector.png](<research/agent-collaboration-visual-references/assets/sim-inspector.png>)
- [sim-trace.png](<research/agent-collaboration-visual-references/assets/sim-trace.png>)
- [index.html](<research/agent-collaboration-visual-references/index.html>)
- [orchestration.html](<research/agent-collaboration-visual-references/orchestration.html>)

### architecture-remediation-20261022 · 1

- [整改与验证记录.md](<outputs/architecture-remediation-20261022/整改与验证记录.md>)

### binance-backend-20261024 · 1

- [PLAN.md](<outputs/binance-backend-20261024/PLAN.md>)

### binance-mcp-20261024 · 1

- [RESULT.md](<outputs/binance-mcp-20261024/RESULT.md>)

### binance-review-20261024 · 1

- [review.md](<outputs/binance-review-20261024/review.md>)

### black-sesame-comic-loop-20261025 · 1

- [README.md](<outputs/black-sesame-comic-loop-20261025/README.md>)

### black-sesame-loop-20261025 · 2

- [README.md](<outputs/black-sesame-loop-20261025/README.md>)
- [generation-brief.md](<outputs/black-sesame-loop-20261025/generation-brief.md>)

### bugfix-release-20261022 · 1

- [RESULTS.md](<outputs/bugfix-release-20261022/RESULTS.md>)

### capsule-workbench-20261024 · 7

- [delivery.md](<outputs/capsule-workbench-20261024/delivery.md>)
- [DELIVERY.md](<outputs/capsule-workbench-20261024/navigation-evidence/DELIVERY.md>)
- [plan.md](<outputs/capsule-workbench-20261024/plan.md>)
- [implementation.md](<outputs/capsule-workbench-20261024/reasoning/implementation.md>)
- [test-output.txt](<outputs/capsule-workbench-20261024/reasoning/test-output.txt>)
- [implementation.md](<outputs/capsule-workbench-20261024/tabs/implementation.md>)
- [delivery.md](<outputs/capsule-workbench-20261024/thinking/delivery.md>)

### chart-rate-limit-history-20261022 · 1

- [before-summary-RESULTS.md](<outputs/chart-rate-limit-history-20261022/before-summary-RESULTS.md>)

### claude-conversation-validation · 2

- [verification.md](<outputs/claude-conversation-validation/transcript-modes/transcript/verification.md>)
- [transcript-source-map.md](<outputs/claude-conversation-validation/transcript-source-map.md>)

### claude-intent-association-20261025 · 2

- [delivery.md](<outputs/claude-intent-association-20261025/delivery.md>)
- [plan.md](<outputs/claude-intent-association-20261025/plan.md>)

### claude-intent-streaming-20261025 · 2

- [delivery.md](<outputs/claude-intent-streaming-20261025/delivery.md>)
- [plan.md](<outputs/claude-intent-streaming-20261025/plan.md>)

### claude-reply-completion-20261025 · 2

- [delivery.md](<outputs/claude-reply-completion-20261025/delivery.md>)
- [plan.md](<outputs/claude-reply-completion-20261025/plan.md>)

### claude-transcript-rules-20261025 · 2

- [delivery.md](<outputs/claude-transcript-rules-20261025/delivery.md>)
- [plan.md](<outputs/claude-transcript-rules-20261025/plan.md>)

### codex-activity-ui-20261025 · 2

- [delivery.md](<outputs/codex-activity-ui-20261025/delivery.md>)
- [plan.md](<outputs/codex-activity-ui-20261025/plan.md>)

### codex-tui-reference-20261025 · 1

- [transcript-evidence.md](<outputs/codex-tui-reference-20261025/transcript-evidence.md>)

### config-import-recovery-20261023 · 2

- [plan.md](<outputs/config-import-recovery-20261023/plan.md>)
- [result.md](<outputs/config-import-recovery-20261023/result.md>)

### conversation-display-20261024 · 6

- [DELIVERY.md](<outputs/conversation-display-20261024/catalog/DELIVERY.md>)
- [PLAN.md](<outputs/conversation-display-20261024/catalog/PLAN.md>)
- [delivery.md](<outputs/conversation-display-20261024/delivery.md>)
- [plan.md](<outputs/conversation-display-20261024/plan.md>)
- [delivery.md](<outputs/conversation-display-20261024/reasoning/delivery.md>)
- [reference.md](<outputs/conversation-display-20261024/reference.md>)

### data-recovery-20261017 · 1

- [RECOVERY.md](<outputs/data-recovery-20261017/RECOVERY.md>)

### decision-tree-references-20261024 · 1

- [style-preview.html](<outputs/decision-tree-references-20261024/style-preview.html>)

### default-guide-split-20261026 · 1

- [整理与验证记录.md](<outputs/default-guide-split-20261026/整理与验证记录.md>)

### evaluator-review-20261024 · 1

- [review.md](<outputs/evaluator-review-20261024/review.md>)

### factor-evaluator-expansion-20261024 · 2

- [README.md](<outputs/factor-evaluator-expansion-20261024/README.md>)
- [RESEARCH.md](<outputs/factor-evaluator-expansion-20261024/RESEARCH.md>)

### factor-evaluator-integration-20261024 · 2

- [plan.md](<outputs/factor-evaluator-integration-20261024/plan.md>)
- [交付与测试记录.md](<outputs/factor-evaluator-integration-20261024/交付与测试记录.md>)

### gui-reasoning-reference-20261025 · 8

- [additional-claude-ui-repos.md](<outputs/gui-reasoning-reference-20261025/additional-claude-ui-repos.md>)
- [assessment.md](<outputs/gui-reasoning-reference-20261025/baocut-design/assessment.md>)
- [claude-code-desktop-candidates.md](<outputs/gui-reasoning-reference-20261025/claude-code-desktop-candidates.md>)
- [claude-derived-ui-comparison.md](<outputs/gui-reasoning-reference-20261025/claude-derived-ui-comparison.md>)
- [harness-studio-evidence.md](<outputs/gui-reasoning-reference-20261025/harness-studio-evidence.md>)
- [open-claude-ui-assessment.md](<outputs/gui-reasoning-reference-20261025/open-claude-ui-assessment.md>)
- [open-source-gui.md](<outputs/gui-reasoning-reference-20261025/open-source-gui.md>)
- [recommendation.md](<outputs/gui-reasoning-reference-20261025/recommendation.md>)

### host-interface-design-20261015 · 9

- [Sesame本体接口能力清单-2026-10-15.md](<outputs/host-interface-design-20261015/Sesame本体接口能力清单-2026-10-15.md>)
- [agent-contract-shapes.md](<outputs/host-interface-design-20261015/agent-contract-shapes.md>)
- [agent-ports.md](<outputs/host-interface-design-20261015/agent-ports.md>)
- [data-contract-shapes.md](<outputs/host-interface-design-20261015/data-contract-shapes.md>)
- [host-ports.md](<outputs/host-interface-design-20261015/host-ports.md>)
- [state-contract-shapes.md](<outputs/host-interface-design-20261015/state-contract-shapes.md>)
- [usage-agent-ports.md](<outputs/host-interface-design-20261015/usage-agent-ports.md>)
- [usage-data-ports.md](<outputs/host-interface-design-20261015/usage-data-ports.md>)
- [usage-ui-state-ports.md](<outputs/host-interface-design-20261015/usage-ui-state-ports.md>)

### inflight-command-timeline-20261025 · 1

- [verification.md](<outputs/inflight-command-timeline-20261025/verification.md>)

### information-sources-20261018 · 9

- [PLAN.md](<outputs/information-sources-20261018/PLAN.md>)
- [REPORT.md](<outputs/information-sources-20261018/REPORT.md>)
- [financial-audit.md](<outputs/information-sources-20261018/financial-audit.md>)
- [investment-source-research.md](<outputs/information-sources-20261018/investment-source-research.md>)
- [market-audit.md](<outputs/information-sources-20261018/market-audit.md>)
- [mt5-plugin-audit.md](<outputs/information-sources-20261018/mt5-plugin-audit.md>)
- [transport-audit.md](<outputs/information-sources-20261018/transport-audit.md>)
- [transport-plan.md](<outputs/information-sources-20261018/transport-plan.md>)
- [verification.md](<outputs/information-sources-20261018/verification.md>)

### installed-app-update-20261025-black-sesame · 1

- [替换结果.md](<outputs/installed-app-update-20261025-black-sesame/替换结果.md>)

### installed-app-update-20261026 · 1

- [continue-pa-request.txt](<outputs/installed-app-update-20261026/continue-pa-request.txt>)

### investment-research-dev-20261019 · 1

- [pr-body.md](<outputs/investment-research-dev-20261019/pr-body.md>)

### latest-thought-status-20261025 · 2

- [delivery.md](<outputs/latest-thought-status-20261025/delivery.md>)
- [plan.md](<outputs/latest-thought-status-20261025/plan.md>)

### live-plugin-qa-20261020 · 84

- [README.md](<outputs/live-plugin-qa-20261020/binding-retry-delta/README.md>)
- [head-patch-stat.txt](<outputs/live-plugin-qa-20261020/binding-retry-delta/head-patch-stat.txt>)
- [chart-viewport-fix.md](<outputs/live-plugin-qa-20261020/chart-viewport-fix.md>)
- [commit-attachments-message.txt](<outputs/live-plugin-qa-20261020/commit-attachments-message.txt>)
- [commit-binding-message.txt](<outputs/live-plugin-qa-20261020/commit-binding-message.txt>)
- [commit-ccxt-message.txt](<outputs/live-plugin-qa-20261020/commit-ccxt-message.txt>)
- [commit-export-base-message.txt](<outputs/live-plugin-qa-20261020/commit-export-base-message.txt>)
- [commit-pagination-message.txt](<outputs/live-plugin-qa-20261020/commit-pagination-message.txt>)
- [commit-references-message.txt](<outputs/live-plugin-qa-20261020/commit-references-message.txt>)
- [commit-reportResume-message.txt](<outputs/live-plugin-qa-20261020/commit-reportResume-message.txt>)
- [compaction-audit.md](<outputs/live-plugin-qa-20261020/compaction-audit.md>)
- [daily-effect-audit-findings.md](<outputs/live-plugin-qa-20261020/daily-effect-audit-findings.md>)
- [daily-effect-audit-followup-findings.md](<outputs/live-plugin-qa-20261020/daily-effect-audit-followup-findings.md>)
- [daily-effect-audit.md](<outputs/live-plugin-qa-20261020/daily-effect-audit.md>)
- [daily-notes-effect-audit.md](<outputs/live-plugin-qa-20261020/daily-notes-effect-audit.md>)
- [daily-state-effects-audit.md](<outputs/live-plugin-qa-20261020/daily-state-effects-audit.md>)
- [daily-strategy-effect-audit.md](<outputs/live-plugin-qa-20261020/daily-strategy-effect-audit.md>)
- [demo-permission-efficiency.md](<outputs/live-plugin-qa-20261020/demo-permission-efficiency.md>)
- [drawing-retest-audit.md](<outputs/live-plugin-qa-20261020/drawing-retest-audit.md>)
- [evidence-guide.md](<outputs/live-plugin-qa-20261020/evidence-guide.md>)
- [QA20261020 模拟交易闭环验收报告-v1.pdf](<outputs/live-plugin-qa-20261020/exports-after-fix/QA20261020 模拟交易闭环验收报告-v1.pdf>)
- [QA20261020 跨市场观察研究报告-v3.pdf](<outputs/live-plugin-qa-20261020/exports-market-expanded/QA20261020 跨市场观察研究报告-v3.pdf>)
- [QA20261020 跨市场观察研究报告-v3.txt](<outputs/live-plugin-qa-20261020/exports-market-expanded/QA20261020 跨市场观察研究报告-v3.txt>)
- [QA20261020 跨市场观察研究报告-v2.pdf](<outputs/live-plugin-qa-20261020/exports-market/QA20261020 跨市场观察研究报告-v2.pdf>)
- [黄金与BTC：证据与方法对照研究报告-v3.pdf](<outputs/live-plugin-qa-20261020/exports-methods-evidence-final-fixes-repaired/黄金与BTC：证据与方法对照研究报告-v3.pdf>)
- [黄金与BTC：证据与方法对照研究报告-v3.txt](<outputs/live-plugin-qa-20261020/exports-methods-evidence-final-fixes-repaired/黄金与BTC：证据与方法对照研究报告-v3.txt>)
- [黄金与BTC：证据与方法对照研究报告-v3.pdf](<outputs/live-plugin-qa-20261020/exports-methods-evidence-repaired/黄金与BTC：证据与方法对照研究报告-v3.pdf>)
- [黄金与BTC：证据与方法对照研究报告-v3.txt](<outputs/live-plugin-qa-20261020/exports-methods-evidence-repaired/黄金与BTC：证据与方法对照研究报告-v3.txt>)
- [QA20261020 量化方法实验研究报告-v1.pdf](<outputs/live-plugin-qa-20261020/exports-methods-quant-final-fixes/QA20261020 量化方法实验研究报告-v1.pdf>)
- [QA20261020 量化方法实验研究报告-v1.txt](<outputs/live-plugin-qa-20261020/exports-methods-quant-final-fixes/QA20261020 量化方法实验研究报告-v1.txt>)
- [QA20261020 量化方法实验研究报告-v1.pdf](<outputs/live-plugin-qa-20261020/exports-methods-quant/QA20261020 量化方法实验研究报告-v1.pdf>)
- [QA20261020 量化方法实验研究报告-v1.txt](<outputs/live-plugin-qa-20261020/exports-methods-quant/QA20261020 量化方法实验研究报告-v1.txt>)
- [QA20261020 模拟交易闭环验收报告-v1.pdf](<outputs/live-plugin-qa-20261020/exports/QA20261020 模拟交易闭环验收报告-v1.pdf>)
- [factor-input-path-audit.md](<outputs/live-plugin-qa-20261020/factor-input-path-audit.md>)
- [market-health-audit.md](<outputs/live-plugin-qa-20261020/market-health-audit.md>)
- [message-ingress-receipt-audit.md](<outputs/live-plugin-qa-20261020/message-ingress-receipt-audit.md>)
- [mt5-2.1.4-prepared.md](<outputs/live-plugin-qa-20261020/mt5-2.1.4-prepared.md>)
- [mt5-connection-diagnosis.md](<outputs/live-plugin-qa-20261020/mt5-connection-diagnosis.md>)
- [mt5-python-precondition-audit.md](<outputs/live-plugin-qa-20261020/mt5-python-precondition-audit.md>)
- [new-demo-r2-audit.md](<outputs/live-plugin-qa-20261020/new-demo-r2-audit.md>)
- [plugin-results-summary.md](<outputs/live-plugin-qa-20261020/plugin-results-summary.md>)
- [abu-research.txt](<outputs/live-plugin-qa-20261020/prompts/abu-research.txt>)
- [cache-retest.txt](<outputs/live-plugin-qa-20261020/prompts/cache-retest.txt>)
- [chart-post-update.txt](<outputs/live-plugin-qa-20261020/prompts/chart-post-update.txt>)
- [cold-history-retest.txt](<outputs/live-plugin-qa-20261020/prompts/cold-history-retest.txt>)
- [daily-integrated.txt](<outputs/live-plugin-qa-20261020/prompts/daily-integrated.txt>)
- [demo-ipc-recovery.txt](<outputs/live-plugin-qa-20261020/prompts/demo-ipc-recovery.txt>)
- [demo-permission-test.txt](<outputs/live-plugin-qa-20261020/prompts/demo-permission-test.txt>)
- [demo-retry.txt](<outputs/live-plugin-qa-20261020/prompts/demo-retry.txt>)
- [demo-trade-retest.txt](<outputs/live-plugin-qa-20261020/prompts/demo-trade-retest.txt>)
- [demo-trade.txt](<outputs/live-plugin-qa-20261020/prompts/demo-trade.txt>)
- [evidence-methods.txt](<outputs/live-plugin-qa-20261020/prompts/evidence-methods.txt>)
- [market-workbench.txt](<outputs/live-plugin-qa-20261020/prompts/market-workbench.txt>)
- [message-ingress.txt](<outputs/live-plugin-qa-20261020/prompts/message-ingress.txt>)
- [methods-parallel.txt](<outputs/live-plugin-qa-20261020/prompts/methods-parallel.txt>)
- [new-demo-binding-r2-corrected.txt](<outputs/live-plugin-qa-20261020/prompts/new-demo-binding-r2-corrected.txt>)
- [new-demo-binding-r2.txt](<outputs/live-plugin-qa-20261020/prompts/new-demo-binding-r2.txt>)
- [new-demo-time-audit-r2.txt](<outputs/live-plugin-qa-20261020/prompts/new-demo-time-audit-r2.txt>)
- [new-demo-trading-r2.txt](<outputs/live-plugin-qa-20261020/prompts/new-demo-trading-r2.txt>)
- [qa-cleanup.txt](<outputs/live-plugin-qa-20261020/prompts/qa-cleanup.txt>)
- [qa-interference-recovery.txt](<outputs/live-plugin-qa-20261020/prompts/qa-interference-recovery.txt>)
- [source-extract-check.txt](<outputs/live-plugin-qa-20261020/prompts/source-extract-check.txt>)
- [strategy-report-ui-feedback.txt](<outputs/live-plugin-qa-20261020/prompts/strategy-report-ui-feedback.txt>)
- [strategy-workflow.txt](<outputs/live-plugin-qa-20261020/prompts/strategy-workflow.txt>)
- [team-final-wording-r2.txt](<outputs/live-plugin-qa-20261020/prompts/team-final-wording-r2.txt>)
- [team-judgment-r2.txt](<outputs/live-plugin-qa-20261020/prompts/team-judgment-r2.txt>)
- [team-report-host-fix-hold-r2.txt](<outputs/live-plugin-qa-20261020/prompts/team-report-host-fix-hold-r2.txt>)
- [team-report-host-fix-resume-r2.txt](<outputs/live-plugin-qa-20261020/prompts/team-report-host-fix-resume-r2.txt>)
- [team-review.txt](<outputs/live-plugin-qa-20261020/prompts/team-review.txt>)
- [workflows-parallel.txt](<outputs/live-plugin-qa-20261020/prompts/workflows-parallel.txt>)
- [workspace-plugin.txt](<outputs/live-plugin-qa-20261020/prompts/workspace-plugin.txt>)
- [qa-efficiency-observations.md](<outputs/live-plugin-qa-20261020/qa-efficiency-observations.md>)
- [qa-ledger.md](<outputs/live-plugin-qa-20261020/qa-ledger.md>)
- [qa-next-coverage.md](<outputs/live-plugin-qa-20261020/qa-next-coverage.md>)
- [remaining-coverage-plan.md](<outputs/live-plugin-qa-20261020/remaining-coverage-plan.md>)
- [report-data-namespace-audit.md](<outputs/live-plugin-qa-20261020/report-data-namespace-audit.md>)
- [reports-3.0.4-prepared.md](<outputs/live-plugin-qa-20261020/reports-3.0.4-prepared.md>)
- [run-release-effect-audit.md](<outputs/live-plugin-qa-20261020/run-release-effect-audit.md>)
- [scenarios.md](<outputs/live-plugin-qa-20261020/scenarios.md>)
- [source-effect-audit.md](<outputs/live-plugin-qa-20261020/source-effect-audit.md>)
- [strategy-report-render-audit.md](<outputs/live-plugin-qa-20261020/strategy-report-render-audit.md>)
- [svl-entry-effect-audit.md](<outputs/live-plugin-qa-20261020/svl-entry-effect-audit.md>)
- [target-plugin-acceptance.md](<outputs/live-plugin-qa-20261020/target-plugin-acceptance.md>)
- [verify-message-ingress.md](<outputs/live-plugin-qa-20261020/verify-message-ingress.md>)

### live-plugin-qa-ccxt-recovery-20261020 · 1

- [README.md](<outputs/live-plugin-qa-ccxt-recovery-20261020/README.md>)

### live-plugin-qa-export-electron-20261020 · 1

- [README.md](<outputs/live-plugin-qa-export-electron-20261020/README.md>)

### live-plugin-qa-export-fix-20261020 · 1

- [README.md](<outputs/live-plugin-qa-export-fix-20261020/README.md>)

### live-plugin-qa-final-fixes-20261020 · 1

- [HARNESS-REVIEW.md](<outputs/live-plugin-qa-final-fixes-20261020/HARNESS-REVIEW.md>)

### live-plugin-qa-final-fixes-retry-20261020 · 1

- [RETRY-HANDOFF.md](<outputs/live-plugin-qa-final-fixes-retry-20261020/RETRY-HANDOFF.md>)

### live-plugin-qa-history-fix-20261020 · 1

- [README.md](<outputs/live-plugin-qa-history-fix-20261020/README.md>)

### live-plugin-qa-indicator-history-20261020 · 1

- [HANDOFF.md](<outputs/live-plugin-qa-indicator-history-20261020/HANDOFF.md>)

### live-plugin-qa-methods-export-20261020 · 5

- [README.md](<outputs/live-plugin-qa-methods-export-20261020/README.md>)
- [README.md](<outputs/live-plugin-qa-methods-export-20261020/fragmentation-probe/README.md>)
- [static-product-handoff.md](<outputs/live-plugin-qa-methods-export-20261020/static-product-handoff.md>)
- [after.txt](<outputs/live-plugin-qa-methods-export-20261020/static-product-red-green/after.txt>)
- [before.txt](<outputs/live-plugin-qa-methods-export-20261020/static-product-red-green/before.txt>)

### live-plugin-qa-r3-20261021 · 18

- [PLAN.md](<outputs/live-plugin-qa-r3-20261021/PLAN.md>)
- [QA20261020 团队与判断复核研究报告-v4.pdf](<outputs/live-plugin-qa-r3-20261021/exports-team-v4/QA20261020 团队与判断复核研究报告-v4.pdf>)
- [IMPLEMENTATION.md](<outputs/live-plugin-qa-r3-20261021/factor-input/IMPLEMENTATION.md>)
- [README.md](<outputs/live-plugin-qa-r3-20261021/factor-input/README.md>)
- [input-tests.txt](<outputs/live-plugin-qa-r3-20261021/factor-input/input-tests.txt>)
- [lint-results.txt](<outputs/live-plugin-qa-r3-20261021/factor-input/lint-results.txt>)
- [manifest-canonical-lint.txt](<outputs/live-plugin-qa-r3-20261021/factor-input/manifest-canonical-lint.txt>)
- [manifest-canonical-red.txt](<outputs/live-plugin-qa-r3-20261021/factor-input/manifest-canonical-red.txt>)
- [manifest-canonical-tests.txt](<outputs/live-plugin-qa-r3-20261021/factor-input/manifest-canonical-tests.txt>)
- [package-tests.txt](<outputs/live-plugin-qa-r3-20261021/factor-input/package-tests.txt>)
- [product-red-test.txt](<outputs/live-plugin-qa-r3-20261021/factor-input/product-red-test.txt>)
- [schema-results.txt](<outputs/live-plugin-qa-r3-20261021/factor-input/schema-results.txt>)
- [test-results.txt](<outputs/live-plugin-qa-r3-20261021/factor-input/test-results.txt>)
- [README.md](<outputs/live-plugin-qa-r3-20261021/mt5-fast-prepare/README.md>)
- [HANDOFF.md](<outputs/live-plugin-qa-r3-20261021/portfolio-fast-prepare/HANDOFF.md>)
- [README.md](<outputs/live-plugin-qa-r3-20261021/quote-time/README.md>)
- [mcp-trading-setting-audit.md](<outputs/live-plugin-qa-r3-20261021/quote-time/mcp-trading-setting-audit.md>)
- [order-check-audit.md](<outputs/live-plugin-qa-r3-20261021/quote-time/order-check-audit.md>)

### live-plugin-qa-r4-20261021 · 1

- [VERIFIED.md](<outputs/live-plugin-qa-r4-20261021/VERIFIED.md>)

### live-plugin-qa-r5-20261021 · 5

- [VERIFIED.md](<outputs/live-plugin-qa-r5-20261021/VERIFIED.md>)
- [README.md](<outputs/live-plugin-qa-r5-20261021/ccxt-diagnostics/README.md>)
- [HANDOFF.md](<outputs/live-plugin-qa-r5-20261021/report-disclosure/HANDOFF.md>)
- [preview-fixed.html](<outputs/live-plugin-qa-r5-20261021/report-disclosure/preview-fixed.html>)
- [report.html](<outputs/live-plugin-qa-r5-20261021/report-disclosure/published-v1/report.html>)

### live-plugin-qa-r6-20261021 · 3

- [CONTENT-VERIFIED.md](<outputs/live-plugin-qa-r6-20261021/CONTENT-VERIFIED.md>)
- [VERIFIED.md](<outputs/live-plugin-qa-r6-20261021/VERIFIED.md>)
- [model-retry-audit.md](<outputs/live-plugin-qa-r6-20261021/model-retry-audit.md>)

### live-plugin-qa-r7-20261021 · 1

- [VERIFIED.md](<outputs/live-plugin-qa-r7-20261021/VERIFIED.md>)

### live-plugin-qa-r8-20261021 · 1

- [VERIFIED.md](<outputs/live-plugin-qa-r8-20261021/VERIFIED.md>)

### live-plugin-qa-real-pdf-acceptance-20261020 · 3

- [README.md](<outputs/live-plugin-qa-real-pdf-acceptance-20261020/README.md>)
- [market-raw.txt](<outputs/live-plugin-qa-real-pdf-acceptance-20261020/market-raw.txt>)
- [quant-raw.txt](<outputs/live-plugin-qa-real-pdf-acceptance-20261020/quant-raw.txt>)

### live-plugin-qa-report-attachments-20261020 · 1

- [README.md](<outputs/live-plugin-qa-report-attachments-20261020/README.md>)

### live-plugin-qa-report-attachments-dynamic-20261020 · 1

- [README.md](<outputs/live-plugin-qa-report-attachments-dynamic-20261020/README.md>)

### live-plugin-qa-resume-fix-20261020 · 1

- [README.md](<outputs/live-plugin-qa-resume-fix-20261020/README.md>)

### live-plugin-qa-resume-fix-20261020-v2 · 1

- [README.md](<outputs/live-plugin-qa-resume-fix-20261020-v2/README.md>)

### live-plugin-qa-source-recovery-layout-20261020 · 1

- [HANDOFF.md](<outputs/live-plugin-qa-source-recovery-layout-20261020/HANDOFF.md>)

### live-plugin-qa-ui-followup-20261020 · 1

- [README.md](<outputs/live-plugin-qa-ui-followup-20261020/README.md>)

### live-trading-charts-20261021 · 13

- [RESULTS.md](<outputs/live-trading-charts-20261021/RESULTS.md>)
- [VERIFIED.md](<outputs/live-trading-charts-20261021/cancel-guidance/VERIFIED.md>)
- [VERIFIED.md](<outputs/live-trading-charts-20261021/order-check-diagnostics/VERIFIED.md>)
- [baseline-paths.txt](<outputs/live-trading-charts-20261021/order-check-diagnostics/baseline-paths.txt>)
- [VERIFIED.md](<outputs/live-trading-charts-20261021/order-numeric-types/VERIFIED.md>)
- [baseline-paths.txt](<outputs/live-trading-charts-20261021/order-numeric-types/baseline-paths.txt>)
- [VERIFIED.md](<outputs/live-trading-charts-20261021/pending-status-fix/VERIFIED.md>)
- [paths.txt](<outputs/live-trading-charts-20261021/pending-status-fix/paths.txt>)
- [pending-orders.txt](<outputs/live-trading-charts-20261021/prompts/pending-orders.txt>)
- [pending-python.txt](<outputs/live-trading-charts-20261021/prompts/pending-python.txt>)
- [pending-status-acceptance.txt](<outputs/live-trading-charts-20261021/prompts/pending-status-acceptance.txt>)
- [workflow-execution.txt](<outputs/live-trading-charts-20261021/prompts/workflow-execution.txt>)
- [contract-source-gap.md](<outputs/live-trading-charts-20261021/workflow-execution/contract-source-gap.md>)

### local-manager-only-report-20261017 · 1

- [report.html](<outputs/local-manager-only-report-20261017/report.html>)

### local-report-presentation-20261017 · 1

- [report.html](<outputs/local-report-presentation-20261017/report.html>)

### market-layout-schema-20261026 · 1

- [修复记录.md](<outputs/market-layout-schema-20261026/修复记录.md>)

### mt5-permissions-schema-20261022 · 1

- [RESULTS.md](<outputs/mt5-permissions-schema-20261022/RESULTS.md>)

### mt5-quote-clock-fix-20261021 · 13

- [VERIFIED.md](<outputs/mt5-quote-clock-fix-20261021/VERIFIED.md>)
- [commit-message.txt](<outputs/mt5-quote-clock-fix-20261021/commit-message.txt>)
- [execution-clock-map-mt5-fast-prepare.md](<outputs/mt5-quote-clock-fix-20261021/execution-clock-map-mt5-fast-prepare.md>)
- [README.md](<outputs/mt5-quote-clock-fix-20261021/host-fixture/README.md>)
- [VERIFIED.md](<outputs/mt5-quote-clock-fix-20261021/js-sidecar/VERIFIED.md>)
- [baseline-paths.txt](<outputs/mt5-quote-clock-fix-20261021/js-sidecar/baseline-paths.txt>)
- [latency-audit.md](<outputs/mt5-quote-clock-fix-20261021/live-trade-cycle/latency-audit.md>)
- [matrix-before-final.md](<outputs/mt5-quote-clock-fix-20261021/matrix-before-final.md>)
- [matrix-before.md](<outputs/mt5-quote-clock-fix-20261021/matrix-before.md>)
- [official-ftmo-time-evidence-factor-path-audit.md](<outputs/mt5-quote-clock-fix-20261021/official-ftmo-time-evidence-factor-path-audit.md>)
- [VERIFIED.md](<outputs/mt5-quote-clock-fix-20261021/order-receipt-fix/VERIFIED.md>)
- [baseline-paths.txt](<outputs/mt5-quote-clock-fix-20261021/order-receipt-fix/baseline-paths.txt>)
- [commit-message.txt](<outputs/mt5-quote-clock-fix-20261021/order-receipt-fix/commit-message.txt>)

### mt5-terminal-diagnosis-20261022 · 1

- [RESULTS.md](<outputs/mt5-terminal-diagnosis-20261022/RESULTS.md>)

### mt5-trading-permissions-20261021 · 4

- [PLAN.md](<outputs/mt5-trading-permissions-20261021/PLAN.md>)
- [README.md](<outputs/mt5-trading-permissions-20261021/README.md>)
- [commit-core-message.txt](<outputs/mt5-trading-permissions-20261021/commit-core-message.txt>)
- [README.md](<outputs/mt5-trading-permissions-20261021/commit-delta/README.md>)

### nasdaq-argument-20261019 · 19

- [manager-conclusion.md](<outputs/nasdaq-argument-20261019/run-1/manager-conclusion.md>)
- [manager-report-offline.html](<outputs/nasdaq-argument-20261019/run-1/manager-report-offline.html>)
- [manager-report.html](<outputs/nasdaq-argument-20261019/run-1/manager-report.html>)
- [manager-summary.md](<outputs/nasdaq-argument-20261019/run-1/manager-summary.md>)
- [member-bear.md](<outputs/nasdaq-argument-20261019/run-1/member-bear.md>)
- [member-bull.md](<outputs/nasdaq-argument-20261019/run-1/member-bull.md>)
- [member-fundamentals.md](<outputs/nasdaq-argument-20261019/run-1/member-fundamentals.md>)
- [member-manager.md](<outputs/nasdaq-argument-20261019/run-1/member-manager.md>)
- [member-market.md](<outputs/nasdaq-argument-20261019/run-1/member-market.md>)
- [member-news.md](<outputs/nasdaq-argument-20261019/run-1/member-news.md>)
- [member-risk.md](<outputs/nasdaq-argument-20261019/run-1/member-risk.md>)
- [member-sentiment.md](<outputs/nasdaq-argument-20261019/run-1/member-sentiment.md>)
- [qa-1-bull-fundamentals.md](<outputs/nasdaq-argument-20261019/run-1/qa-1-bull-fundamentals.md>)
- [qa-2-bull-market.md](<outputs/nasdaq-argument-20261019/run-1/qa-2-bull-market.md>)
- [qa-3-bear-news.md](<outputs/nasdaq-argument-20261019/run-1/qa-3-bear-news.md>)
- [qa-session-fundamentals-run_fa393e4b-c784-499f-8f72-2a0df708787b.md](<outputs/nasdaq-argument-20261019/run-1/qa-session-fundamentals-run_fa393e4b-c784-499f-8f72-2a0df708787b.md>)
- [qa-session-market-run_a9c50c75-fc7c-4fad-9612-a90d2f2d0323.md](<outputs/nasdaq-argument-20261019/run-1/qa-session-market-run_a9c50c75-fc7c-4fad-9612-a90d2f2d0323.md>)
- [qa-session-news-run_5aac3e98-0a4e-4dc1-a819-77fc234719e1.md](<outputs/nasdaq-argument-20261019/run-1/qa-session-news-run_5aac3e98-0a4e-4dc1-a819-77fc234719e1.md>)
- [validation.md](<outputs/nasdaq-argument-20261019/validation.md>)

### nasdaq-default-causal-20261018 · 14

- [prompt-change.md](<outputs/nasdaq-default-causal-20261018/prompt-change.md>)
- [manager-conclusion.md](<outputs/nasdaq-default-causal-20261018/run-1/manager-conclusion.md>)
- [manager-report.html](<outputs/nasdaq-default-causal-20261018/run-1/manager-report.html>)
- [manager-summary.md](<outputs/nasdaq-default-causal-20261018/run-1/manager-summary.md>)
- [member-bear.md](<outputs/nasdaq-default-causal-20261018/run-1/member-bear.md>)
- [member-bull.md](<outputs/nasdaq-default-causal-20261018/run-1/member-bull.md>)
- [member-fundamentals.md](<outputs/nasdaq-default-causal-20261018/run-1/member-fundamentals.md>)
- [member-manager.md](<outputs/nasdaq-default-causal-20261018/run-1/member-manager.md>)
- [member-market.md](<outputs/nasdaq-default-causal-20261018/run-1/member-market.md>)
- [member-news.md](<outputs/nasdaq-default-causal-20261018/run-1/member-news.md>)
- [member-risk.md](<outputs/nasdaq-default-causal-20261018/run-1/member-risk.md>)
- [member-sentiment.md](<outputs/nasdaq-default-causal-20261018/run-1/member-sentiment.md>)
- [validation-plan.md](<outputs/nasdaq-default-causal-20261018/validation-plan.md>)
- [validation.md](<outputs/nasdaq-default-causal-20261018/validation.md>)

### nasdaq-default-qa-20261018 · 14

- [manager-conclusion.md](<outputs/nasdaq-default-qa-20261018/run-2/manager-conclusion.md>)
- [manager-report.html](<outputs/nasdaq-default-qa-20261018/run-2/manager-report.html>)
- [manager-summary.md](<outputs/nasdaq-default-qa-20261018/run-2/manager-summary.md>)
- [member-bear.md](<outputs/nasdaq-default-qa-20261018/run-2/member-bear.md>)
- [member-bull.md](<outputs/nasdaq-default-qa-20261018/run-2/member-bull.md>)
- [member-fundamentals.md](<outputs/nasdaq-default-qa-20261018/run-2/member-fundamentals.md>)
- [member-manager.md](<outputs/nasdaq-default-qa-20261018/run-2/member-manager.md>)
- [member-market.md](<outputs/nasdaq-default-qa-20261018/run-2/member-market.md>)
- [member-news.md](<outputs/nasdaq-default-qa-20261018/run-2/member-news.md>)
- [member-risk.md](<outputs/nasdaq-default-qa-20261018/run-2/member-risk.md>)
- [member-sentiment.md](<outputs/nasdaq-default-qa-20261018/run-2/member-sentiment.md>)
- [qa-1-bull-fundamentals.md](<outputs/nasdaq-default-qa-20261018/run-2/qa-1-bull-fundamentals.md>)
- [qa-2-bear-news.md](<outputs/nasdaq-default-qa-20261018/run-2/qa-2-bear-news.md>)
- [validation.md](<outputs/nasdaq-default-qa-20261018/validation.md>)

### nasdaq-downstream-qa-20261019 · 33

- [manager-instructions.md](<outputs/nasdaq-downstream-qa-20261019/run-3/manager-instructions.md>)
- [manager-report.html](<outputs/nasdaq-downstream-qa-20261019/run-3/manager-report.html>)
- [manager-summary.md](<outputs/nasdaq-downstream-qa-20261019/run-3/manager-summary.md>)
- [member-bear.md](<outputs/nasdaq-downstream-qa-20261019/run-3/member-bear.md>)
- [member-bull.md](<outputs/nasdaq-downstream-qa-20261019/run-3/member-bull.md>)
- [member-fundamentals.md](<outputs/nasdaq-downstream-qa-20261019/run-3/member-fundamentals.md>)
- [member-manager.md](<outputs/nasdaq-downstream-qa-20261019/run-3/member-manager.md>)
- [member-market.md](<outputs/nasdaq-downstream-qa-20261019/run-3/member-market.md>)
- [member-news.md](<outputs/nasdaq-downstream-qa-20261019/run-3/member-news.md>)
- [member-risk.md](<outputs/nasdaq-downstream-qa-20261019/run-3/member-risk.md>)
- [member-sentiment.md](<outputs/nasdaq-downstream-qa-20261019/run-3/member-sentiment.md>)
- [qa-1-bull-fundamentals.md](<outputs/nasdaq-downstream-qa-20261019/run-3/qa-1-bull-fundamentals.md>)
- [qa-2-bull-market.md](<outputs/nasdaq-downstream-qa-20261019/run-3/qa-2-bull-market.md>)
- [qa-3-bear-news.md](<outputs/nasdaq-downstream-qa-20261019/run-3/qa-3-bear-news.md>)
- [qa-4-risk-fundamentals.md](<outputs/nasdaq-downstream-qa-20261019/run-3/qa-4-risk-fundamentals.md>)
- [manager-instructions.md](<outputs/nasdaq-downstream-qa-20261019/run-5/manager-instructions.md>)
- [manager-report-offline.html](<outputs/nasdaq-downstream-qa-20261019/run-5/manager-report-offline.html>)
- [manager-report.html](<outputs/nasdaq-downstream-qa-20261019/run-5/manager-report.html>)
- [manager-summary.md](<outputs/nasdaq-downstream-qa-20261019/run-5/manager-summary.md>)
- [member-bear.md](<outputs/nasdaq-downstream-qa-20261019/run-5/member-bear.md>)
- [member-bull.md](<outputs/nasdaq-downstream-qa-20261019/run-5/member-bull.md>)
- [member-fundamentals.md](<outputs/nasdaq-downstream-qa-20261019/run-5/member-fundamentals.md>)
- [member-manager.md](<outputs/nasdaq-downstream-qa-20261019/run-5/member-manager.md>)
- [member-market.md](<outputs/nasdaq-downstream-qa-20261019/run-5/member-market.md>)
- [member-news.md](<outputs/nasdaq-downstream-qa-20261019/run-5/member-news.md>)
- [member-risk.md](<outputs/nasdaq-downstream-qa-20261019/run-5/member-risk.md>)
- [member-sentiment.md](<outputs/nasdaq-downstream-qa-20261019/run-5/member-sentiment.md>)
- [qa-1-bull-fundamentals.md](<outputs/nasdaq-downstream-qa-20261019/run-5/qa-1-bull-fundamentals.md>)
- [qa-2-bull-market.md](<outputs/nasdaq-downstream-qa-20261019/run-5/qa-2-bull-market.md>)
- [qa-3-bear-news.md](<outputs/nasdaq-downstream-qa-20261019/run-5/qa-3-bear-news.md>)
- [qa-4-risk-fundamentals.md](<outputs/nasdaq-downstream-qa-20261019/run-5/qa-4-risk-fundamentals.md>)
- [qa-5-manager-fundamentals.md](<outputs/nasdaq-downstream-qa-20261019/run-5/qa-5-manager-fundamentals.md>)
- [validation.md](<outputs/nasdaq-downstream-qa-20261019/validation.md>)

### nasdaq-manager-thesis-20261019 · 11

- [manager-conclusion.md](<outputs/nasdaq-manager-thesis-20261019/run-2/manager-conclusion.md>)
- [manager-instructions.md](<outputs/nasdaq-manager-thesis-20261019/run-2/manager-instructions.md>)
- [manager-report-offline.html](<outputs/nasdaq-manager-thesis-20261019/run-2/manager-report-offline.html>)
- [manager-report.html](<outputs/nasdaq-manager-thesis-20261019/run-2/manager-report.html>)
- [manager-summary.md](<outputs/nasdaq-manager-thesis-20261019/run-2/manager-summary.md>)
- [manager-conclusion.md](<outputs/nasdaq-manager-thesis-20261019/run-3/manager-conclusion.md>)
- [manager-instructions.md](<outputs/nasdaq-manager-thesis-20261019/run-3/manager-instructions.md>)
- [manager-report-offline.html](<outputs/nasdaq-manager-thesis-20261019/run-3/manager-report-offline.html>)
- [manager-report.html](<outputs/nasdaq-manager-thesis-20261019/run-3/manager-report.html>)
- [manager-summary.md](<outputs/nasdaq-manager-thesis-20261019/run-3/manager-summary.md>)
- [validation.md](<outputs/nasdaq-manager-thesis-20261019/validation.md>)

### nasdaq-research-20261018 · 26

- [BAMLH0A0HYM2.csv](<outputs/nasdaq-research-20261018/history/BAMLH0A0HYM2.csv>)
- [DFII10.csv](<outputs/nasdaq-research-20261018/history/DFII10.csv>)
- [DGS10.csv](<outputs/nasdaq-research-20261018/history/DGS10.csv>)
- [NASDAQ100.csv](<outputs/nasdaq-research-20261018/history/NASDAQ100.csv>)
- [NASDAQCOM.csv](<outputs/nasdaq-research-20261018/history/NASDAQCOM.csv>)
- [VIXCLS.csv](<outputs/nasdaq-research-20261018/history/VIXCLS.csv>)
- [auxiliary-six-features-candidates.csv](<outputs/nasdaq-research-20261018/history/auxiliary-six-features-candidates.csv>)
- [history-brief.md](<outputs/nasdaq-research-20261018/history/history-brief.md>)
- [history-method.md](<outputs/nasdaq-research-20261018/history/history-method.md>)
- [main-five-features-candidates.csv](<outputs/nasdaq-research-20261018/history/main-five-features-candidates.csv>)
- [sensitivity-no-vix-candidates.csv](<outputs/nasdaq-research-20261018/history/sensitivity-no-vix-candidates.csv>)
- [primary-sources.md](<outputs/nasdaq-research-20261018/primary-sources.md>)
- [question-frozen.md](<outputs/nasdaq-research-20261018/question-frozen.md>)
- [question.md](<outputs/nasdaq-research-20261018/question.md>)
- [recovery-note.md](<outputs/nasdaq-research-20261018/recovery-note.md>)
- [manager-report.html](<outputs/nasdaq-research-20261018/run-2/manager-report.html>)
- [manager-summary.md](<outputs/nasdaq-research-20261018/run-2/manager-summary.md>)
- [member-bear.md](<outputs/nasdaq-research-20261018/run-2/member-bear.md>)
- [member-bull.md](<outputs/nasdaq-research-20261018/run-2/member-bull.md>)
- [member-fundamentals.md](<outputs/nasdaq-research-20261018/run-2/member-fundamentals.md>)
- [member-manager.md](<outputs/nasdaq-research-20261018/run-2/member-manager.md>)
- [member-market.md](<outputs/nasdaq-research-20261018/run-2/member-market.md>)
- [member-news.md](<outputs/nasdaq-research-20261018/run-2/member-news.md>)
- [member-risk.md](<outputs/nasdaq-research-20261018/run-2/member-risk.md>)
- [member-sentiment.md](<outputs/nasdaq-research-20261018/run-2/member-sentiment.md>)
- [纳指三个月研究.md](<outputs/nasdaq-research-20261018/run-2/纳指三个月研究.md>)

### plugin-composition-20261018 · 4

- [REPORT.md](<outputs/plugin-composition-20261018/REPORT.md>)
- [integration-verification.md](<outputs/plugin-composition-20261018/integration-verification.md>)
- [manager-summary.md](<outputs/plugin-composition-20261018/manager-summary.md>)
- [real-data-readiness.md](<outputs/plugin-composition-20261018/real-data-readiness.md>)

### plugin-discovery-routing-20261024 · 1

- [README.md](<outputs/plugin-discovery-routing-20261024/README.md>)

### plugin-inventory-20261014 · 1

- [Sesame插件总表-含Dev-2026-10-14.md](<outputs/plugin-inventory-20261014/Sesame插件总表-含Dev-2026-10-14.md>)

### plugin-push-preflight-20261025 · 1

- [result.md](<outputs/plugin-push-preflight-20261025/result.md>)

### plugin-release-dev3 · 6

- [RELEASE.md](<outputs/plugin-release-dev3/RELEASE.md>)
- [final-agent-review.md](<outputs/plugin-release-dev3/final-agent-review.md>)
- [plan-pr.md](<outputs/plugin-release-dev3/plan-pr.md>)
- [release-pr.md](<outputs/plugin-release-dev3/release-pr.md>)
- [site-pr.md](<outputs/plugin-release-dev3/site-pr.md>)
- [source-pr.md](<outputs/plugin-release-dev3/source-pr.md>)

### push-dev-20261025 · 4

- [unit-results.txt](<outputs/push-dev-20261025/desktop-lifecycle/unit-results.txt>)
- [host-pr.md](<outputs/push-dev-20261025/host-pr.md>)
- [plugins-pr.md](<outputs/push-dev-20261025/plugins-pr.md>)
- [validator-pr.md](<outputs/push-dev-20261025/validator-pr.md>)

### real-research-20261018 · 47

- [comparison-baseline.md](<outputs/real-research-20261018/comparison-baseline.md>)
- [manager-report.html](<outputs/real-research-20261018/manager-report-5/manager-report.html>)
- [manager-response.md](<outputs/real-research-20261018/manager-report-5/manager-response.md>)
- [manager-report.html](<outputs/real-research-20261018/manager-report-6/manager-report.html>)
- [manager-response.md](<outputs/real-research-20261018/manager-report-6/manager-response.md>)
- [AAPL真实资料与多方法组合研究 · bear.md](<outputs/real-research-20261018/run-3/AAPL真实资料与多方法组合研究 · bear.md>)
- [AAPL真实资料与多方法组合研究 · bull.md](<outputs/real-research-20261018/run-3/AAPL真实资料与多方法组合研究 · bull.md>)
- [AAPL真实资料与多方法组合研究 · fundamentals.md](<outputs/real-research-20261018/run-3/AAPL真实资料与多方法组合研究 · fundamentals.md>)
- [AAPL真实资料与多方法组合研究 · manager.md](<outputs/real-research-20261018/run-3/AAPL真实资料与多方法组合研究 · manager.md>)
- [AAPL真实资料与多方法组合研究 · market.md](<outputs/real-research-20261018/run-3/AAPL真实资料与多方法组合研究 · market.md>)
- [AAPL真实资料与多方法组合研究 · news.md](<outputs/real-research-20261018/run-3/AAPL真实资料与多方法组合研究 · news.md>)
- [AAPL真实资料与多方法组合研究 · risk.md](<outputs/real-research-20261018/run-3/AAPL真实资料与多方法组合研究 · risk.md>)
- [AAPL真实资料与多方法组合研究 · sentiment.md](<outputs/real-research-20261018/run-3/AAPL真实资料与多方法组合研究 · sentiment.md>)
- [REPORT.md](<outputs/real-research-20261018/run-3/REPORT.md>)
- [manager-summary.md](<outputs/real-research-20261018/run-3/manager-summary.md>)
- [member-bear.md](<outputs/real-research-20261018/run-3/member-bear.md>)
- [member-bull.md](<outputs/real-research-20261018/run-3/member-bull.md>)
- [member-fundamentals.md](<outputs/real-research-20261018/run-3/member-fundamentals.md>)
- [member-manager.md](<outputs/real-research-20261018/run-3/member-manager.md>)
- [member-market.md](<outputs/real-research-20261018/run-3/member-market.md>)
- [member-news.md](<outputs/real-research-20261018/run-3/member-news.md>)
- [member-risk.md](<outputs/real-research-20261018/run-3/member-risk.md>)
- [member-sentiment.md](<outputs/real-research-20261018/run-3/member-sentiment.md>)
- [review-partial.md](<outputs/real-research-20261018/run-3/review-partial.md>)
- [review-sources.md](<outputs/real-research-20261018/run-3/review-sources.md>)
- [AAPL真实资料与多方法组合研究 · bear.md](<outputs/real-research-20261018/run-4/AAPL真实资料与多方法组合研究 · bear.md>)
- [AAPL真实资料与多方法组合研究 · bull.md](<outputs/real-research-20261018/run-4/AAPL真实资料与多方法组合研究 · bull.md>)
- [AAPL真实资料与多方法组合研究 · fundamentals.md](<outputs/real-research-20261018/run-4/AAPL真实资料与多方法组合研究 · fundamentals.md>)
- [AAPL真实资料与多方法组合研究 · manager.md](<outputs/real-research-20261018/run-4/AAPL真实资料与多方法组合研究 · manager.md>)
- [AAPL真实资料与多方法组合研究 · market.md](<outputs/real-research-20261018/run-4/AAPL真实资料与多方法组合研究 · market.md>)
- [AAPL真实资料与多方法组合研究 · news.md](<outputs/real-research-20261018/run-4/AAPL真实资料与多方法组合研究 · news.md>)
- [AAPL真实资料与多方法组合研究 · risk.md](<outputs/real-research-20261018/run-4/AAPL真实资料与多方法组合研究 · risk.md>)
- [AAPL真实资料与多方法组合研究 · sentiment.md](<outputs/real-research-20261018/run-4/AAPL真实资料与多方法组合研究 · sentiment.md>)
- [REPORT.md](<outputs/real-research-20261018/run-4/REPORT.md>)
- [TEST-PLAN.md](<outputs/real-research-20261018/run-4/TEST-PLAN.md>)
- [manager-summary.md](<outputs/real-research-20261018/run-4/manager-summary.md>)
- [member-bear.md](<outputs/real-research-20261018/run-4/member-bear.md>)
- [member-bull.md](<outputs/real-research-20261018/run-4/member-bull.md>)
- [member-fundamentals.md](<outputs/real-research-20261018/run-4/member-fundamentals.md>)
- [member-manager.md](<outputs/real-research-20261018/run-4/member-manager.md>)
- [member-market.md](<outputs/real-research-20261018/run-4/member-market.md>)
- [member-news.md](<outputs/real-research-20261018/run-4/member-news.md>)
- [member-risk.md](<outputs/real-research-20261018/run-4/member-risk.md>)
- [member-sentiment.md](<outputs/real-research-20261018/run-4/member-sentiment.md>)
- [review-composition.md](<outputs/real-research-20261018/run-4/review-composition.md>)
- [review-sources.md](<outputs/real-research-20261018/run-4/review-sources.md>)
- [schema-worker-fix.md](<outputs/real-research-20261018/schema-worker-fix.md>)

### release-0.2.3 · 18

- [application-agent-review-comment.md](<outputs/release-0.2.3/application-agent-review-comment.md>)
- [application-pr-body.md](<outputs/release-0.2.3/application-pr-body.md>)
- [clean-history-final-agent-review.md](<outputs/release-0.2.3/clean-history-final-agent-review.md>)
- [clean-history-publication-pr.md](<outputs/release-0.2.3/clean-history-publication-pr.md>)
- [clean-history-source-pr.md](<outputs/release-0.2.3/clean-history-source-pr.md>)
- [host-dev-sync-pr-body.md](<outputs/release-0.2.3/host-dev-sync-pr-body.md>)
- [host-final-pr-description.md](<outputs/release-0.2.3/host-final-pr-description.md>)
- [host-persistence-review-reply.md](<outputs/release-0.2.3/host-persistence-review-reply.md>)
- [host-pin-review-reply.md](<outputs/release-0.2.3/host-pin-review-reply.md>)
- [host-source-pr.md](<outputs/release-0.2.3/host-source-pr.md>)
- [manual-plan-review-reply.md](<outputs/release-0.2.3/manual-plan-review-reply.md>)
- [native-build-failure-diagnosis.md](<outputs/release-0.2.3/native-build-failure-diagnosis.md>)
- [plugin-bootstrap-pr.md](<outputs/release-0.2.3/plugin-bootstrap-pr.md>)
- [plugin-check-restoration-pr.md](<outputs/release-0.2.3/plugin-check-restoration-pr.md>)
- [plugin-final-agent-review.md](<outputs/release-0.2.3/plugin-final-agent-review.md>)
- [plugin-publication-pr.md](<outputs/release-0.2.3/plugin-publication-pr.md>)
- [plugin-source-pr.md](<outputs/release-0.2.3/plugin-source-pr.md>)
- [release-notes.md](<outputs/release-0.2.3/release-notes.md>)

### release-0.2.4-20261017 · 22

- [CONFIGURATION-WAIT-REPAIR.md](<outputs/release-0.2.4-20261017/CONFIGURATION-WAIT-REPAIR.md>)
- [HOST-VERIFICATION.md](<outputs/release-0.2.4-20261017/HOST-VERIFICATION.md>)
- [NATIVE-CI-39051008871-DIAGNOSIS.md](<outputs/release-0.2.4-20261017/NATIVE-CI-39051008871-DIAGNOSIS.md>)
- [NATIVE-CI-39053516020-DIAGNOSIS.md](<outputs/release-0.2.4-20261017/NATIVE-CI-39053516020-DIAGNOSIS.md>)
- [NATIVE-CI-39055913876-DIAGNOSIS.md](<outputs/release-0.2.4-20261017/NATIVE-CI-39055913876-DIAGNOSIS.md>)
- [NATIVE-CI-39057554832-DIAGNOSIS.md](<outputs/release-0.2.4-20261017/NATIVE-CI-39057554832-DIAGNOSIS.md>)
- [NATIVE-CI-39059008826-PREPARED.md](<outputs/release-0.2.4-20261017/NATIVE-CI-39059008826-PREPARED.md>)
- [NATIVE-CI-REMEDIATION.md](<outputs/release-0.2.4-20261017/NATIVE-CI-REMEDIATION.md>)
- [NATIVE-CI-SIMPLIFICATION.md](<outputs/release-0.2.4-20261017/NATIVE-CI-SIMPLIFICATION.md>)
- [application-draft-pr.md](<outputs/release-0.2.4-20261017/application-draft-pr.md>)
- [application-final-pr.md](<outputs/release-0.2.4-20261017/application-final-pr.md>)
- [host-ci-simplification-pr.md](<outputs/release-0.2.4-20261017/host-ci-simplification-pr.md>)
- [host-configuration-wait-pr.md](<outputs/release-0.2.4-20261017/host-configuration-wait-pr.md>)
- [host-pr.md](<outputs/release-0.2.4-20261017/host-pr.md>)
- [plugin-readonly-verification.md](<outputs/release-0.2.4-20261017/plugin-readonly-verification.md>)
- [plugin-semantic-review-final.md](<outputs/release-0.2.4-20261017/plugin-semantic-review-final.md>)
- [plugins-plan-pr.md](<outputs/release-0.2.4-20261017/plugins-plan-pr.md>)
- [plugins-source-pr.md](<outputs/release-0.2.4-20261017/plugins-source-pr.md>)
- [public-final-pr.md](<outputs/release-0.2.4-20261017/public-final-pr.md>)
- [read-only-analysis-pr.md](<outputs/release-0.2.4-20261017/read-only-analysis-pr.md>)
- [release-notes.md](<outputs/release-0.2.4-20261017/release-notes.md>)
- [remove-ci-pr.md](<outputs/release-0.2.4-20261017/remove-ci-pr.md>)

### report-compact-tree-20261024 · 6

- [README.md](<outputs/report-compact-tree-20261024/README.md>)
- [pdf-text.txt](<outputs/report-compact-tree-20261024/exports/pdf-text.txt>)
- [黄金下周走势研究报告-v8.pdf](<outputs/report-compact-tree-20261024/exports/黄金下周走势研究报告-v8.pdf>)
- [plan.md](<outputs/report-compact-tree-20261024/plan.md>)
- [report-v8.html](<outputs/report-compact-tree-20261024/report-v8.html>)
- [update-prompt.txt](<outputs/report-compact-tree-20261024/update-prompt.txt>)

### report-decision-logic-20261024 · 2

- [plan.md](<outputs/report-decision-logic-20261024/plan.md>)
- [report-v5.html](<outputs/report-decision-logic-20261024/report-v5.html>)

### report-default-charts-20261024 · 5

- [axis-prompt.txt](<outputs/report-default-charts-20261024/axis-prompt.txt>)
- [黄金下周走势研究报告-v7.pdf](<outputs/report-default-charts-20261024/exports/黄金下周走势研究报告-v7.pdf>)
- [prompt.txt](<outputs/report-default-charts-20261024/prompt.txt>)
- [report-v6.html](<outputs/report-default-charts-20261024/report-v6.html>)
- [report-v7.html](<outputs/report-default-charts-20261024/report-v7.html>)

### report-delivery-20261020 · 1

- [166目录-30品种M5筛查-5候选H1复核.html](<outputs/report-delivery-20261020/166目录-30品种M5筛查-5候选H1复核.html>)

### report-export-feedback-20261024 · 2

- [README.md](<outputs/report-export-feedback-20261024/README.md>)
- [黄金下周走势研究报告-v11.pdf](<outputs/report-export-feedback-20261024/exports/黄金下周走势研究报告-v11.pdf>)

### report-financial-colors-20261024 · 1

- [prompt.txt](<outputs/report-financial-colors-20261024/prompt.txt>)

### report-reader-focus-20261024 · 6

- [README.md](<outputs/report-reader-focus-20261024/README.md>)
- [report-v10.html](<outputs/report-reader-focus-20261024/report-v10.html>)
- [report-v11.html](<outputs/report-reader-focus-20261024/report-v11.html>)
- [steering-prompt.txt](<outputs/report-reader-focus-20261024/steering-prompt.txt>)
- [template-refresh-prompt.txt](<outputs/report-reader-focus-20261024/template-refresh-prompt.txt>)
- [update-prompt.txt](<outputs/report-reader-focus-20261024/update-prompt.txt>)

### report-visuals-20261024 · 7

- [黄金下周走势研究报告-v4.pdf](<outputs/report-visuals-20261024/exports/黄金下周走势研究报告-v4.pdf>)
- [regeneration-prompt.txt](<outputs/report-visuals-20261024/regeneration-prompt.txt>)
- [report-v1.html](<outputs/report-visuals-20261024/report-v1.html>)
- [report-v2.html](<outputs/report-visuals-20261024/report-v2.html>)
- [report-v4.html](<outputs/report-visuals-20261024/report-v4.html>)
- [result.md](<outputs/report-visuals-20261024/result.md>)
- [visual-feedback.txt](<outputs/report-visuals-20261024/visual-feedback.txt>)

### research-autonomy-20261024 · 3

- [README.md](<outputs/research-autonomy-20261024/README.md>)
- [plan.md](<outputs/research-autonomy-20261024/plan.md>)
- [prompt-and-actions-audit.md](<outputs/research-autonomy-20261024/prompt-and-actions-audit.md>)

### research-catalog-check-20261026 · 4

- [cover.png](<outputs/research-catalog-check-20261026/cover.png>)
- [dictionary.png](<outputs/research-catalog-check-20261026/dictionary.png>)
- [mobile.png](<outputs/research-catalog-check-20261026/mobile.png>)
- [render-check.json](<outputs/research-catalog-check-20261026/render-check.json>)

### research-method-composition-20261024 · 2

- [next-research-instruction.md](<outputs/research-method-composition-20261024/next-research-instruction.md>)
- [修复与交付记录.md](<outputs/research-method-composition-20261024/修复与交付记录.md>)

### research-routing-audit-20261024 · 3

- [README.md](<outputs/research-routing-audit-20261024/README.md>)
- [real-routing-notes.md](<outputs/research-routing-audit-20261024/real-routing-notes.md>)
- [report-lifecycle-notes.md](<outputs/research-routing-audit-20261024/report-lifecycle-notes.md>)

### slash-ultra-20261024 · 7

- [frontend-delivery.md](<outputs/slash-ultra-20261024/frontend-delivery.md>)
- [implementation.md](<outputs/slash-ultra-20261024/reply-evidence/implementation.md>)
- [tabs-dark-1100-hover.png](<outputs/slash-ultra-20261024/tabs-evidence/hover/tabs-dark-1100-hover.png>)
- [tabs-light-1100-hover.png](<outputs/slash-ultra-20261024/tabs-evidence/hover/tabs-light-1100-hover.png>)
- [implementation.md](<outputs/slash-ultra-20261024/tabs-evidence/implementation.md>)
- [DELIVERY.md](<outputs/slash-ultra-20261024/ultra-evidence/DELIVERY.md>)
- [交付记录.md](<outputs/slash-ultra-20261024/交付记录.md>)

### startup-animation-20261025 · 1

- [验证记录.md](<outputs/startup-animation-20261025/验证记录.md>)

### ultra-lifecycle-status-20261025 · 3

- [delivery.md](<outputs/ultra-lifecycle-status-20261025/delivery.md>)
- [plan.md](<outputs/ultra-lifecycle-status-20261025/plan.md>)
- [plugin-delivery.md](<outputs/ultra-lifecycle-status-20261025/plugin-delivery.md>)

### ultra-original-flow-20261025 · 1

- [delivery.md](<outputs/ultra-original-flow-20261025/delivery.md>)

### ultra-shared-sweep-20261025 · 1

- [delivery.md](<outputs/ultra-shared-sweep-20261025/delivery.md>)

### ultra-status-alignment-20261025 · 2

- [delivery.md](<outputs/ultra-status-alignment-20261025/delivery.md>)
- [plan.md](<outputs/ultra-status-alignment-20261025/plan.md>)

### visual-parameter-lab · 2

- [index.html](<outputs/visual-parameter-lab/index.html>)
- [preview-default.html](<outputs/visual-parameter-lab/preview-default.html>)

### wenkai-font-20261024 · 2

- [README.md](<outputs/wenkai-font-20261024/README.md>)
- [黄金下周走势研究报告-v11.pdf](<outputs/wenkai-font-20261024/exports/黄金下周走势研究报告-v11.pdf>)

### workflow-connectors-20261025 · 1

- [delivery-notes.md](<outputs/workflow-connectors-20261025/delivery-notes.md>)

### workflow-holdout-fix-20261024 · 1

- [README.md](<outputs/workflow-holdout-fix-20261024/README.md>)

### workspace-edge-scroll-20261025 · 1

- [delivery-notes.md](<outputs/workspace-edge-scroll-20261025/delivery-notes.md>)
