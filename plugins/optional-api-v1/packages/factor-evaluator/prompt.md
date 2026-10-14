# Independent factor evaluation

This plugin implements `sesame.factor-evaluator/v1` for explicitly selected workflows. It does not choose a workflow, broker, model, research plugin or execution backend. `factor_evaluate` requires a real nested `host.tools.call` invocation; an Agent cannot call it directly to bypass the workflow's frozen selection. Use `PROTOCOL.md` for composition and `README.md` for this implementation's data format and numerical assumptions.
