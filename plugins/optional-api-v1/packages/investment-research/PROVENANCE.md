# Provenance

Original Sesame JavaScript implementation, MIT. This package separates the research responsibility previously held by Sesame's combined manual-trading package. Its native workflow, fixed artifacts and report binding use the public Sesame host interfaces; no third-party execution engine is bundled.

The previous package recorded the following architecture reference, retained here with the research responsibility:

- [TradingAgents](https://github.com/TauricResearch/TradingAgents), MIT, commit `1394a3f72aa4393e1a98f51b382434c4b4c2d972`: analyst evidence, bull/bear scenarios, risk review and manager synthesis. [Referenced graph](https://github.com/TauricResearch/TradingAgents/blob/1394a3f72aa4393e1a98f51b382434c4b4c2d972/tradingagents/graph/setup.py). This is an adapted communication pattern, not a Python-engine import or a claim to reproduce its benchmark results.

Sources and numerical methods remain separately selected plugins with their own provenance and licenses. The research manager uses the independent reports plugin; this package does not copy its renderer. No account credentials, user research or market dataset is included in the package.

Version 3.2.0 adds original MIT-licensed, bounded `fixed-event-window-returns/1.0.0` endpoint arithmetic over caller-selected fixed event and market artifacts. It records actual alignment, raw price basis, baseline and missing/overlapping observations. This is neither a historical event search engine nor a point-in-time dataset certification or predictive method. No third-party method, source credential, model request or market dataset is embedded; deterministic synthetic tests establish arithmetic and artifact identity, not investment performance.

3.3.0：新增研究报告流程入口与结果 brief，复用原生 Run、固定证据、问答及渲染核验。受限 RSS/HTML 解析及金融证据读取纳入审核研究能力，未授予通用 shell 或配置权限。

4.0.0：任务 brief 改为目标、问题、方法参考、证据和交付要求，删除旧业务模板选择。Research 提供独立的只读方法发现与正文；本工作流继续使用既有 Run 执行，Reports 仅通过通用组件统一呈现。来源、计算、报告和交易权限保持分别声明；不新增宿主接口、调度器或数据获取服务。

4.0.1 更新策略研究交接指引，分别指向现有因子研究和完整策略开发插件。
