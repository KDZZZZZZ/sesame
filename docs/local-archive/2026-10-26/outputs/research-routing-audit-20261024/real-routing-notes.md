# Real-model routing verification

Both probes used the saved current selection: deepseek / deepseek-flash, thinking=max. Credentials stayed in the original authorized SDK store or memory. The isolated workspace used current plugin policy/loadout and declared tool schemas; no Runtime background services or MCP processes were started.

- Maximum-power probe: real-routing-1792847129107/evidence.json. The model first requested plugin_discover(query="factor") and host_capabilities_list(kind="workflow"). These real discovery calls succeeded. It also proposed memory_search and memory_trading_context; the test stopped before memory access. This probe preceded the later explicit lightweight/quick-research wording clarification. It proves workflow discovery only, not dispatch.
- Lightweight probe: real-routing-lightweight-1792847808209/evidence.json. With the latest synchronized host/plugin prompts, the model proposed direct data_providers and canvas_inspect calls. It did not propose a workflow or subagent. The test stopped before data_providers executed. This single sample supports the lightweight direct-work exception.

Each isolated probe recorded zero Run and zero delegated-agent tasks. No market research, download, trading, report publication, live configuration change, or plugin service activation was executed. Report binding and Strategy report-space selection were not reached in either probe. Neither probe establishes downstream research quality or every possible model route.

The latest host prompt/test and orchestration prompt were reviewed without edits after the lightweight probe. Maximum-effort and lightweight exceptions agree; tests retain research-report requirements and ordinary-question exceptions. The built orchestration prompt matched source. Regression evidence remains routing-intensity-green.log (8 passed), with prior red evidence in routing-intensity-red.log (5 passed, 3 expected failures).
