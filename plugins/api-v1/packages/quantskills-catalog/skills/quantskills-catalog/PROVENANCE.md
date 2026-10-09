# QuantSkills 目录来源与维护

本插件由 Sesame 内部主 Agent 创建，现由 Sesame 官方维护，内置版本从 1.0.0 开始。工具代码使用 Python 标准库；MIT 授权见包根目录 LICENSE。目录条目仍指向各上游项目，不代表取得了这些项目的代码授权或官方维护权。

- 原始来源：[QuantSkills README](https://raw.githubusercontent.com/quantskills/quantskills/main/README.md)
- 原始抓取时间：`2026-10-03T14:34:06.311Z`
- 原始 README SHA-256：`f2776eef99218dd7200b2d77b31e5dda02da1e0370f66f371f658bd62c57ba6c`
- 上游 commit：未核验（抓取时连接失败，保留 null），不能将 main URL 视为固定 commit。
- 214 个唯一条目、10 类；213 条 pending_review、1 条 published_endpoint。标签反映当时的目录描述，未逐个运行、安装或审计上游代码。
- `catalog.json` 包含原始字段及按描述推断的依赖/接入方式；推断不等于实测能力。

这是固定快照，无 TTL，也不自动同步上游。应用升级可更换快照；更新时应同步来源、日期、哈希、分类数量和 plugin.json 中的断言，再执行 `node --test tests/builtin-research-plugins.test.js` 与 `node scripts/sync-plugin-tools.mjs --check`。不应只修改日期来表示刷新。

应用启动只注册静态 schema，获准调用后才启动本机 stdio MCP，以当前系统用户权限运行，不是 OS 沙箱。启动时内置包优先于旧同名外部安装，保留用户策略、按会话加载状态和旧安装审计；维护者通过应用代码版本发布更新。


## Plugin API v1 package 2.0.0

The implementation and test samples are retained. Version 2.0.0 moves the package
to the `bot.sesame` namespace with a `sesame/` publisher-qualified identity. It is
a separate release from the public 0.1.4 catalog snapshot. No old plugin identity
is aliased. Existing author, license and source/sample attributions remain.

## Plugin API v1 package 2.0.1

Operational guidance now follows native task-managed stdio execution and actual workspace paths. Reuse an installed compatible Python before explicitly preparing missing dependencies. The parser tool parameter restrictions remain unchanged and are not described as OS isolation. Existing source, sample, license and author attributions are preserved.
