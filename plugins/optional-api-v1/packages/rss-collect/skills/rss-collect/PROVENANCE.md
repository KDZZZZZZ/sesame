# rss-collect 来源与维护

Sesame 内部主 Agent 创建的适配层，现由 Sesame 官方维护，内置版本从 1.0.0 开始。Python 实现只使用标准库，没有捆绑或调用候选库的代码。许可证见包根目录 LICENSE；它不改变网页、订阅内容和金融数据的原有权利。

## 固定验证样本

以下时间是原集成记录中再次在线获取并核对样本的时间；发布和离线测试不会重新抓取。样本不代表实时数据。

- `sample.atom`：[https://github.com/adbar/trafilatura/releases.atom](https://github.com/adbar/trafilatura/releases.atom)
  - 核验时间：`2026-10-03T15:27:02.764Z`
  - 文件 SHA-256：`651679918e79bb95a5bcd83e006913796581c35fddb1f54272b566836dc40992`

## 维护规则

当前为原生能力适配器：公开ID保持不变，接受精确source_ref，经host.resources.read读取原始字节；host.process.exec运行现有标准库Python解析器。file_path仍只接受包内相对路径。旧MCP传输入口已移除，不保留第二套调用方式。固定正向断言保存在samples.json，运行plugins/optional-api-v1/tests/source-parser-transport.test.mjs。无需API Key或pip安装；来源获取权限与配置由获取能力管理。

以下为历史版本记录，不描述当前执行方式。

## Plugin API v1 package 2.0.0

The implementation and test samples are retained. Version 2.0.0 moves the package
to the `bot.sesame` namespace with a `sesame/` publisher-qualified identity. It is
a separate release from the public 0.1.4 catalog snapshot. No old plugin identity
is aliased. Existing author, license and source/sample attributions remain.

## Plugin API v1 package 2.0.1

Operational guidance now follows native task-managed stdio execution and actual workspace paths. Reuse an installed compatible Python before explicitly preparing missing dependencies. The parser tool parameter restrictions remain unchanged and are not described as OS isolation. Existing source, sample, license and author attributions are preserved.
