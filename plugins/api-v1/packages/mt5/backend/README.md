MT5 1.1 默认复用本机依赖；请先用 `mt5_dependencies`。程序、Windows Python、Wine 和编译镜像不在本体/插件发行包中，安装方法见 `../skills/dependencies/SKILL.md`。本机执行保留任务进程管理，不宣称为 OS 沙箱。

# MT5 plugin backend

The official `sesame/mt5` package owns MT5 connection configuration, market/account mapping, native MQL5 source, compiler isolation, Tester execution, trade tools and persistent EA observation. It receives the public `HostContext`; it never imports the application's runtime or database.

New strategy work starts with a frozen SVL source published by `sesame/strategy-authoring`. Read `mt5_target`, follow [the target profile](../target/README.md), and register the native files through `mt5_translation`. The host derives the graph from the original SVL. MQL5 binary64 arithmetic, broker rules and native callback behavior require separate target evidence; source validation and successful compilation do not prove native equivalence.

Existing native MQL5 projects remain inspectable and usable through `mt5_project`, `mt5_compile`, `mt5_backtest` and `mt5_deployment`. Their old language, source revision and trace identity remain explicit. They do not acquire a new SVL RunRecord or a reconstructed graph. Migration copies declared old records and private files once, includes committed SQLite WAL data, and leaves the original state intact. Running or uncertain deployments prevent package deactivation.

`providers.js` implements the declared market/account contracts. Decimals and tickets remain strings where the native source supplies them. Numeric native JSON carries an explicit precision warning. Broker wall clocks are preserved without guessing UTC offsets; missing quantities, currencies, coverage and correlations remain unknown. The market adapter retains a bounded native history cache, supports forming bars, and uses calendar month boundaries. Polling streams provide an initial snapshot and ready barrier, then per-consumer sequences; they do not reconstruct missed historical fills from current positions.

The compiler freezes MetaEditor, installed standard headers, package SDK and source files. The compiler invokes the locally installed MetaEditor through a plugin-owned Windows Job controller. On non-Windows hosts it uses the existing Wine program with a new private prefix. No host runtime, VM image, or guest transport is required. Compiler cancellation waits for process-tree cleanup acknowledgement; an uncertain cleanup preserves its private files.

Tester starts a fresh private terminal under a native Windows Job. A PID only means that a process was created. The controller settles only after the native Job confirms zero active processes. Missing acknowledgements mark the pass unknown and retain its files. This boundary has protocol tests; native Windows/Wine verification is required before a release declares that platform verified. No test suite silently starts the user's terminal or sends trades.

Task sealing cancels and waits only for its compiler/Tester work, then freezes source/build/result evidence. Cleanup runs after the host seals the TaskResult. Successful EX5 bytes remain available for explicit later use; actual EA paths and account positions are never stopped by task cleanup. Standard SVL runs pin expanded parameters, exact build, source, translation, environment and input bindings. Persistent observation is read-only; stale or unverifiable EA state becomes unknown.

For missing dependencies, follow [the dependency skill](../skills/dependencies/SKILL.md). The explicit download scripts verify their source and preserve existing installations. Historical VM compiler experiments are stored outside this package in the repository development archive.
