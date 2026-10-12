# 来源与许可

- 自有 orchestration、数据守卫、模拟账户映射、只读provider、规则适配、报告组织与测试：Sesame contributors，2026，MIT；插件实现由 Sesame 内部主 Agent 与其真实内部子 Agent 编写。此次 Codex 负责源码合入、当前验收说明、仓库检查及 PR 审阅发现的报告/留档/测试修正（见 VALIDATION.md），未重新运行交易角色；自动检查不是独立人类安全批准。
- `assets/editorial.css`, `assets/report-kit.js`：公开Sesame `plugins/api-v1/packages/reports/assets`，MIT，Copyright (c) 2026 Sesame contributors。从本次可读的 `/tmp/sesame-api1-publish-workflow` 对应公开0.2.2开发包复制，保留LICENSE，不来自私有宿主源码。
- provider/工具接口设计参考公开 AKShare、MT5、canvas-control、orchestration、reports 与 plugin-manager 的HostContext实例，包代码只使用公开接口与Node标准库；不导入私有Runtime/Store/Pi。
- Dukascopy历史行情由用户机器按限定UTC窗口请求；`dukascopy-node`固定版本、MIT及npm来源详见DATA.md与依赖lock。公开包不包含下载行情或node_modules，不假设整批市场数据可以再分发。
- 成熟撮合引擎及其独立许可/版本由原生依赖模块和RULES.md记录；不把第三方引擎许可改写为MIT，也不把import成功当作实际撮合验收。
- 久留美题材及人物属于原权利人，本包是非官方二创模拟，不含漫画图片或原作长对白。原用户附件为二创拟合记录，仅开发者阅读；未复制全文到包，不进入角色输入。对照价格/金额不是真实逐笔交易历史。
- 官方历史锚点（观众来源，非提前给角色的未来消息）：BLS `https://www.bls.gov/news.release/archives/empsit_12052014.htm`；SNB `https://www.snb.ch/en/publications/communication/press-releases/2015/pre_20150115`。细粒度数据不依赖当前MT5旧历史。
