# Dev 插件发布记录（不含 Kurumi）

完成核验：2026-10-14T15:47:09.479Z。

已发布 R2 dev.3：54 个插件，包含本次 10 个新增或更新版本。Kurumi 未进入发布归档、安装目录或官网目录。

| 插件 | 版本 | 最低宿主要求 |
| --- | --- | --- |
| sesame/akshare | 1.0.8 | >=0.2.0-0 |
| sesame/auto-factor-mining | 1.0.0-dev.2 | >=0.2.3-dev.8 |
| sesame/factor-evaluator | 1.0.0-dev.1 | >=0.2.3-dev.8 |
| sesame/manual-trading | 3.0.0 | >=0.2.3-dev.8 |
| sesame/market-data-parser | 2.0.3 | >=0.2.0-0 |
| sesame/mt5 | 1.6.0 | >=0.2.3-dev.8 |
| sesame/portfolio-execution | 1.0.0 | >=0.2.3-dev.8 |
| sesame/qmt | 1.4.0 | >=0.2.3-dev.8 |
| sesame/rss-collect | 2.0.3 | >=0.2.0-0 |
| sesame/web-extract | 2.0.3 | >=0.2.0-0 |

## 发布和核验

- 源码：5c44877c13618905cc85b820e21a8fd51a1d3684。
- 发布合并：c73f6919c46fe81c1021b8adec1ce7f7e64df5a2；[PR 69](https://github.com/KDZZZZZZ/sesame/pull/69)。
- [发布工作流](https://github.com/KDZZZZZZ/sesame/actions/runs/38590188259)。
- [合并前审查门禁](https://github.com/KDZZZZZZ/sesame/actions/runs/38590013251)。
- [R2 安装目录](https://dl.sesame.bot/plugins/api-v1/catalog.json)：归档、锁、审查记录、应用 pin 和全部包版本/摘要回读一致。
- 官网提交：8f69413b88fe44cf0d8e28ce6ed7c9bcb6d9f9e0；[官网 PR 14](https://github.com/KDZZZZZZ/sesame-site/pull/14)；Cloudflare 部署 7b36c1b8-d1e4-4f06-846e-6bd92206c45c。
- 官网两个目录校验通过，23 项测试通过；最低宿主版本断言已由旧的手工交易 0.2.2 更新为六个新组合插件实际要求的 dev.8。
- [官网插件目录](https://sesame.bot/plugins/)：两个公开 JSON 与已合并源码逐字节一致，54 个版本与 R2 一致；首页、中英文插件和安装页可访问。
- 应用安装文件未改变：复用当天对四个完整 R2 安装包的下载和 SHA-256 核验，再核对当前发布元数据、校验和及大小；未重复下载。见 installer-verification-reuse.json。

## 最后审查意见归因

工具重名评论被独立复核为 not-applicable：真实宿主在注册、安装和更新提交之前全局拒绝不同插件拥有同名工具。disabled/discoverable 状态保留名称登记，委派工具列表由登记信息生成。额外插件校验会重复宿主约束，因此没有增加。真实 Store/Runtime/Registry/Manager 的 16 项隔离回归全部通过，证据见 tool-owner-invariant.json；复现脚本同名 .mjs。

## 运行边界

六个新组合工作流相关插件要求 Sesame >=0.2.3-dev.8；本地对应安装包已构建并验证 155 个运行文件，SHA-256 e5e84a3579d64623f7e403995e4a7c6318369de50727c80f4e3797df02aa1a74。
安装包：E:\brief2great\sesame\mt5agent\release\win32-x64\Sesame-0.2.3-dev.8-win-x64.exe。这次未升级当前运行实例，也未发布新应用版本。
原始本地 dev 未提交修改保留；发布使用单独工作树中的固定快照。未运行真实模型调用或交易。MT5 原始成交缺少手工运行归属时，不能据此认定该轮成交确认或盈亏归因。

完整证据：candidate-evidence.json、final-agent-review.md、review-gate/review-gate.json、publication-evidence.json、website-publication-evidence.json；下载的发布字节保存于 published/。
