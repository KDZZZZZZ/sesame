# Plugin API 2 publication

The source directories retain the names `plugins/api-v1` and
`plugins/optional-api-v1`; their current manifests, capabilities and locks use
**API 2**. The `dev.7` collection targets Sesame **0.3.0**. Each manifest's
`engines.sesame` is authoritative, including its minimum and maximum host versions.
Every plugin explicitly declares its
capabilities, input/output schemas, consumers, dependencies and usage guidance.
Preserve each package's license, author and third-party provenance.

GitHub Releases are reserved for application versions (`vX.Y.Z`). The
owner-authorized 2026-10-16 history reset removes plugin GitHub Releases and
their historical publication plans. Application installers remain unchanged;
historical application tags retain their original source trees without old
ancestors. Old plugin GitHub URLs and API 1 installation flows are retired.

## Prepare a release

For the first rollout, merge the workflow and validator changes into trusted `main` through a separate infrastructure PR. Open a new publishing PR after `Plugin CI` and `Plugin release approval` are available on `main`. A candidate branch cannot supply its own release validator.

1. Merge the tested packages and their distribution locks into `dev`. Open a PR from this repository’s `dev` to `main`. Run the release command at the committed source revision, using the **actual number of that open PR** in place of `123`.
2. The command generates `.github/plugin-r2-api2/dev.N.json` and prints the source commit, package counts and SHA-256 values for the selected archives and locks. By default it carries forward the most recent committed release plan’s IDs that still exist in the current source locks. This preserves prior exclusions such as `sesame/kurumi-replay`. To admit new packages, add one `--include <publisher/slug>` per ID on the same command. Inspect both package lists, then commit and push the plan to the open PR.
3. Wait for `Plugin CI` to pass `plugin-static-review` on the final PR commit. Resolve outstanding review discussions and change requests. A maintainer with GitHub `maintain` or `admin` access, distinct from the PR author, must submit GitHub’s **Approve** review on that commit. Pushing another commit requires a fresh approval.
4. Before merging, confirm that a successful **Plugin release approval** run on `main` has uploaded `plugin-semantic-review-<PR number>` for the current head. The run starts automatically after the CI or review event. To retry while the PR is open, use **Run workflow** on `main` with its PR number.
5. Merge the reviewed PR into `main`. **Publish plugins to Sesame R2** verifies the saved approval, source and plan, writes immutable objects and checks public downloads before promoting the catalog.

For a release that retains the existing selection, run

```sh
node scripts/plugin.mjs release --pr 123
```

For a release that also admits two new packages, use their actual IDs

```sh
node scripts/plugin.mjs release --pr 123 --include community/market-feed --include sesame/plugin-optimizer
```

Package installation and host assembly use the pinned distribution locks. [R2 storage and retry behavior](R2-DISTRIBUTION.md)

## Host bundles and installation

The `dev.7` core profile contains eleven default plugins; its optional profile
contains 45 plugins and excludes Kurumi. The optional profile is selected
explicitly and is not automatically assembled into the application. Host builds
pin the published core archive, source commit and lock digest; optional test
fixtures pin their selected archive separately.

API 1 hosts must upgrade before using these packages. Existing installed package
state is not silently overwritten. Package install/update and loading remain
separate from configuring accounts or installing external runtimes.

See [R2 distribution](R2-DISTRIBUTION.md), [contribution rules](../../CONTRIBUTING.md)
and [application releases](../../RELEASING.md).
