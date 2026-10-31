# Host fixture evidence saved after execution

本目录只保存此前已完成的两份宿主 fixture 修改与验证证据；没有重新运行测试，也没有改产品或测试文件。两个测试此前已 untracked，按根线程要求只保留增量证据，不将整份测试混入 clock 修复提交。

- 最终定向回归：28/28 通过，0 失败、0 跳过，65813.8406 ms；使用临时 fixture、本地模型替身，无真实 broker/model 调用。
- 初次旧 fixture 为 26/28；补 quote_clock 后为 27/28；剩余旧“主会话零消息”断言经明确授权改成 typed completion 通知与实际已完成 workflow 的精确关联，最后 28/28。前两轮仅在会话有回执，此处不补造完整原日志。
- 两文件 node --check 无诊断；oxlint 两次均无诊断且命令单元 exit 0。语法检查与其他命令同单元执行，未单独捕获各自 exit code，具体边界见 static-checks.recorded.json。

修改范围：普通 quote 回执增加显式 fixture UTC sidecar，原 tick 不改；验证观察结果、guard revision/source time 传递；保留精确授权链、SELL/position/quantity、无关持仓和不重发断言。主消息按唯一外层 Run、delegation/automation typed 输入和相应助手回复验证，不写死消息总数。backend 测试文件未修改。

文件：

- [验证简表](./verification.json)
- [合并增量 diff](./changes.patch)
- [此前 28 项工具输出转存](./tests-final.recorded.log)
- [语法与 lint 已有回执](./static-checks.recorded.json)
- [原始 before 文本及回执出处](./captured-tool-evidence.json)
- [host before](./before/trading-decision-host.test.mjs) / [after](./after/trading-decision-host.test.mjs) / [diff](./trading-decision-host.test.mjs.patch)
- [agent-host before](./before/trading-decision-agent-host.test.mjs) / [after](./after/trading-decision-agent-host.test.mjs) / [diff](./trading-decision-agent-host.test.mjs.patch)

真实性边界：before 来自修改前保留的工具 stdout，不是依据新代码反推；原 stdout 保存在 JSON 中，单独 before 文件仅去掉 PowerShell 自动增加的一个末尾 CRLF。它是原始文本快照，不宣称当时已生成磁盘哈希。after 是本次保存时只读复制的当前文件。原来没有磁盘测试日志，recorded.log 是已有工具回执的注明来源转存，不冒充原始文件或重跑输出。diff 只统一 CRLF/LF 用于阅读。
