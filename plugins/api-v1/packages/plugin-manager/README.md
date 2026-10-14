# Sesame plugin manager

Create and manage plugins in Sesame, or author them with an external coding Agent.

- [Shared development Skill](skills/develop-plugins/SKILL.md)
- [Host API reference](skills/develop-plugins/references/host-api.md)
- [Authoring and installation guide](skills/develop-plugins/references/authoring.md)
- [Portable scaffold CLI](scripts/create-plugin.mjs) (Node 24+, no application source or credentials)

Inside Sesame use `plugin_create` with `template: "native"` for a native package,
or retain the existing `skill` / `mcp-python` templates. External Agents can run:

```sh
node plugins/api-v1/packages/plugin-manager/scripts/create-plugin.mjs --name example --publisher your-name --description 'Describe the requested behavior' --output ../example
```

The native starter exposes an echo tool. Implement the requested behavior before
delivery, then validate, test, install the exact bytes, load and verify in Sesame.
The generator does not install dependencies, activate packages or select a license
for the author's work. Product integration uses the documented public interfaces.

`plugin_catalog` reads the Plugin API 1 development catalog from
`https://dl.sesame.bot/plugins/api-v1/catalog.json`. Current catalogs install
verified package files from content-addressed `dl.sesame.bot` package URLs. Older
schema 1 catalogs remain readable for compatibility and still install only from
fixed GitHub commit URLs recorded in the catalog.
