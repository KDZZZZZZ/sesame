# QuantSkills 目录来源与维护

本插件由 Sesame 内部主 Agent 创建，现由 Sesame 官方维护，现为按需独立发布包。工具代码使用 Python 标准库；MIT 授权见包根目录 LICENSE。目录条目仍指向各上游项目，不代表取得了这些项目的代码授权或官方维护权。

- 原始来源：[QuantSkills README](https://raw.githubusercontent.com/quantskills/quantskills/main/README.md)
- 原始抓取时间：`2026-10-03T14:34:06.311Z`
- 原始 README SHA-256：`f2776eef99218dd7200b2d77b31e5dda02da1e0370f66f371f658bd62c57ba6c`
- 上游 commit：未核验（抓取时连接失败，保留 null），不能将 main URL 视为固定 commit。
- 214 个唯一条目、10 类；213 条 pending_review、1 条 published_endpoint。标签反映当时的目录描述，未逐个运行、安装或审计上游代码。
- `catalog.json` 包含原始字段及按描述推断的依赖/接入方式；推断不等于实测能力。

这是固定快照，无 TTL，也不自动同步上游。独立插件升级可更换快照；更新时须同步来源、日期、哈希、分类数量和 plugin.json 中的断言，再执行本包协议测试和实际宿主 plugin_test/install/load。不要只修改日期来表示刷新。2026-10-10 核对上游目录时已显示更新的 218 项，本包仍明确保留 214 项旧快照，不冒充新快照或逐项验证。

MCP 以当前系统用户权限运行，不是 OS 沙箱。本包不在启动时安装环境或访问网络；实际查找已安装包和安装目录由 plugin-manager 完成。显式更新后的安装版本优先，卸载、回退、重启状态由宿主公开生命周期管理；不因目录建议改变用户的加载选择。


## Plugin API v1 package 2.0.0

The implementation and test samples are retained. Version 2.0.0 moves the package
to the `bot.sesame` namespace with a `sesame/` publisher-qualified identity. It is
a separate release from the public 0.1.4 catalog snapshot. No old plugin identity
is aliased. Existing author, license and source/sample attributions remain.

## Plugin API v1 package 2.0.1

Operational guidance now follows native task-managed stdio execution and actual workspace paths. Reuse an installed compatible Python before explicitly preparing missing dependencies. The parser tool parameter restrictions remain unchanged and are not described as OS isolation. Existing source, sample, license and author attributions are preserved.

## Plugin API v1 package 2.1.0

`workflows.json` 与新增 `catalog_recommend` 为 Sesame 原创编排指引，将相同用户需求收敛到一个方法流程。参考链接选自上述已保存目录；不复制参考仓库源码或书籍正文。方法包分别维护自身采用的论文、书籍、开源实现、许可证与取舍记录。推荐不会检查在线发布或安装状态，也不运行策略、访问账户或自动下载依赖。

协议回归：在公开仓库执行 `node --test plugins/optional-api-v1/tests/quantskills-routing.test.mjs`。该测试启动真实 stdio Python 进程，验证请求隔离、错误恢复、选择路由和元数据一致性；不将其称为量化方法有效性验证。
