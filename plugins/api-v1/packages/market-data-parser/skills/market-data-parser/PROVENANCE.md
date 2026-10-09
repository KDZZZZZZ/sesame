# market-data-parser 来源与维护

Sesame 内部主 Agent 创建的适配层，现由 Sesame 官方维护，内置版本从 1.0.0 开始。Python 实现只使用标准库，没有捆绑或调用候选库的代码。许可证见包根目录 LICENSE；它不改变网页、订阅内容和金融数据的原有权利。

## 固定验证样本

以下时间是原集成记录中再次在线获取并核对样本的时间；发布和离线测试不会重新抓取。样本不代表实时数据。

- `sample_fx.json`：[https://api.exchangerate-api.com/v4/latest/USD](https://api.exchangerate-api.com/v4/latest/USD)
  - 核验时间：`2026-10-03T15:27:05.725Z`
  - 文件 SHA-256：`dacbf7fa69c1ce1b7c9d3ac2f22ddeb2050d55fdead4af78af3c880831f004c7`
- `sample_fx.xml`：[https://www.tcmb.gov.tr/kurlar/today.xml](https://www.tcmb.gov.tr/kurlar/today.xml)
  - 核验时间：`2026-10-03T15:28:08.386Z`
  - 文件 SHA-256：`bfaa6d1b41cdb0ed7bbf0dfda3a5c940dd3c65be0a81a8e13bae6dedd889abf6`

## 维护规则

源码、技能说明、样本、完整 MCP schema 和正向断言一起纳入仓库审查。修改 server.py 后运行 `node scripts/sync-plugin-tools.mjs`，再运行 `node --test tests/builtin-research-plugins.test.js` 与 schema `--check`。运行时仅在获准调用后使用已有本机 Python 启动 stdio MCP，以当前系统用户身份执行，可访问公网与内网；没有 Linux/WSL/Lima 或 OS 沙箱前提。工具自己的 file_path 参数只允许包内文件，这是服务器参数校验，不代表进程没有宿主权限。URL 采集可由 web-sources 插件负责。

应用启动时优先加载此内置包；旧同名外部安装保留审计记录但不执行。沿用用户的启用策略，无 TTL、无单独密钥。来源内容或格式变更会影响抓取或解析质量；维护者需要显式更新并发布应用。


## Plugin API v1 package 2.0.0

The implementation and test samples are retained. Version 2.0.0 moves the package
to the `bot.sesame` namespace with a `sesame/` publisher-qualified identity. It is
a separate release from the public 0.1.4 catalog snapshot. No old plugin identity
is aliased. Existing author, license and source/sample attributions remain.

## Plugin API v1 package 2.0.1

Operational guidance now follows native task-managed stdio execution and actual workspace paths. Reuse an installed compatible Python before explicitly preparing missing dependencies. The parser tool parameter restrictions remain unchanged and are not described as OS isolation. Existing source, sample, license and author attributions are preserved.
