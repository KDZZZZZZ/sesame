Sesame 0.2.4 improves Agent collaboration, reports and desktop updates.

- Windows and Linux can check for and download updates in the background. Installation starts only after you choose to restart and current work has settled; chats, reports, plugin data and settings are retained.
- Subagent messages and pause diagnostics stay in their own work context. The main Agent can resolve a dependency and resume the original workflow without creating a replacement task.
- A report opens its bound Agent conversation or explicitly orchestrated workflow. Work and report views switch inside the same window; completed reports no longer duplicate themselves below the workflow.
- Plugin reports support Markdown headings, tables and emphasis. Manual trading reports present the manager's summary, with specialist work accessible in the workflow details.
- Updated plugins clarify capabilities and configuration, support MT5 terminal launch and account configuration, and improve financial research and factor workflows.

The official Plugin API 2 catalog contains 54 plugins (9 core and 45 optional), excluding Kurumi. Eight updated packages require Sesame 0.2.4. Read-only analysis excludes trading and mixed native write tools while retaining market data and indicator access. Plugins remain distributed through the official catalog rather than GitHub plugin releases.

Installers: Windows x64, Linux x64 (AppImage and DEB), and macOS Apple Silicon. Published 0.2.3 installations need one ordinary in-place upgrade to acquire the updater. macOS continues to update manually. The Windows installer is unsigned and the macOS app uses ad-hoc signing without notarization. External data services, models and broker connections require their own configuration.

See INSTALL.md and SHA256SUMS.txt for installation instructions and file checksums.
