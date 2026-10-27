Configuration integration tests now initialize the model session before waiting for request completion, and immediately report interrupted or canceled responses with their status and error context. This removes the assumption that SDK startup and a multi-tool configuration reply finish within twenty seconds on a loaded Windows runner.

All 51 existing assertions remain, with an additional completed-state assertion. The two integration cases register cleanup with the test runner so a whole-test timeout also disposes the fixture. Product code and the global polling helper are unchanged.

Validation: all 12 configuration tests passed on Windows in 105.1 seconds, with no skips; syntax, diff checks and an independent review passed. The three-platform release build is running at https://github.com/KDZZZZZZ/mt5agent/actions/runs/39057554832.
