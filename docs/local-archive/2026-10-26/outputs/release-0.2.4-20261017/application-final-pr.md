Publish Sesame 0.2.4 with verified Windows x64, Linux x64 (AppImage and DEB) and macOS arm64 installers. The schema 2 plan identifies all twelve uploaded draft assets by exact size and SHA-256, including Windows/Linux update manifests, plans and blockmaps. SHA256SUMS covers all eleven other files.

The README and installation guide point to 0.2.4. The desktop update guide explains first-time upgrades from 0.2.3, preserved user data, explicit restart installation, and separate update-channel promotion.

The installers come from the native three-platform release build, with extracted-installer verification and the fixed Plugin API 2 source. Preparation verifies private staging provenance, every downloaded artifact, and update-feed SHA-512 semantics; upload verifies the complete public draft before publication. The application workflow publishes the draft and mirrors immutable assets to R2. Mutable update channels are promoted separately only after public mirror integrity checks.

Upgrades preserve chats, reports, plugins and configuration. Published 0.2.3 installations require one ordinary in-place upgrade to obtain the updater; subsequent Windows/Linux updates use the new channel. Kurumi remains excluded from the official plugin catalog.
