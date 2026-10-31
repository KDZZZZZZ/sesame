Run the unchanged shared regression suite once on Linux and keep native OS checks on Windows and macOS. All three platforms still validate the selected source, storage boundaries, updater, packaged payload and staging; Windows and macOS retain native configuration, SDK command, filesystem and plugin lifecycle tests.

Validation: 48 desktop build/staging policy tests passed. The staged-installer gate passed 174 tests, including rejection of missing, skipped or failed required steps. Independent review confirmed the Linux set retains all 48 original files, Windows/macOS each run 20 files, and the helper requires all three successful jobs from the exact same run, attempt and source revisions.

Native candidate build: https://github.com/KDZZZZZZ/mt5agent/actions/runs/39059008826
