# Phase 12: automated checks with GitHub Actions

## Outcome

FairGate now has one local verification command, `npm run check`, and a GitHub Actions workflow that runs it after installing locked dependencies and applying migrations to a fresh test database. Pushes, pull requests, and manual workflow runs use the same check sequence.

This phase makes the existing work easier to maintain. There is no new customer feature, dependency, schema change, or deployment. You still review, stage, commit, and push the changes yourself.

## Local commands

With dependencies installed, the API environment configured, and Docker Desktop running, use the repository root:

```powershell
npm run db:start
npm run db:deploy
npm run check
```

`npm run check` runs three stages in order:

1. `npm run typecheck` generates Prisma/Next types and checks both apps, API scripts, and integration tests.
2. `npm test` runs the traffic-helper, auth, booking, waiting-room, request-limit, and operator suites sequentially.
3. `npm run build` compiles the API and produces a Next.js production build.

`&&` stops the sequence when a command fails. Do not replace it with a separator that continues after failure. Existing individual commands still work when investigating one failing suite. Development servers are not required; integration tests start their own APIs on free ports.

The tests still require the existing local PostgreSQL/Redis addresses. The check command does not start containers, reset data, seed the catalogue, or silently apply migrations. Those setup operations are explicit above. Tests remove their own fixtures.

## Follow a CI run

1. A push or pull request starts **FairGate CI** on an Ubuntu 24.04 GitHub-hosted runner. The workflow also supports a manual run from the Actions tab once it is available on the default branch.
2. GitHub starts disposable PostgreSQL 17 and Redis 7.4 service containers and waits for health checks. Host ports are `5433` and `6380`, matching our existing local-only test guards. The database begins empty. Service containers belong to this job, not your laptop or a production environment.
3. Checkout downloads the triggering code. Repository permission is `contents: read`, and checkout does not persist credentials for later commands.
4. Setup Node selects the Node 22 release line and caches npm package downloads using the lockfile. The patch release may advance; CI is not pinned to your local Node patch version. Native packages are installed on Linux for this run.
5. `npm ci` installs dependencies from `package-lock.json`. It fails if the manifest and lockfile disagree. This checks a clean installation instead of inheriting a developer's existing `node_modules`.
6. `npm run db:deploy` applies the committed migrations to the fresh service database. No local `.env` file is copied: job environment variables provide the disposable database/Redis URLs. No catalogue seed is needed because tests create their own fixtures and the build does not query catalogue data.
7. `npm run check` runs exactly the same type-check/test/build sequence as the local command. The step fails on a nonzero exit code. Individual npm/TAP output identifies which stage and test failed.
8. GitHub disposes of the runner and service containers after the job. The job has a 15-minute time limit. A newer run for the same branch/PR cancels obsolete in-progress checks.

A feature-branch push with an open pull request can trigger separate push and PR runs. They have different refs and therefore separate concurrency groups. The action major-version tags and service image tags can receive updates; the npm dependency tree is locked by the committed lockfile.

## What the result means

A green check means this revision passed the configured type checks, tests, and build in that runner environment. It does not establish production throughput, browser accessibility/visual correctness, bot resistance, or deploy the app. The local traffic experiment remains a separate command; CI has no laptop-dependent latency threshold.

The npm cache contains package downloads rather than a reused `node_modules` directory. It reduces download time without replacing the clean install. These behaviors follow the official [setup-node documentation](https://github.com/actions/setup-node). Service port mapping and health checks follow GitHub's [PostgreSQL service-container guide](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers).

The test password in the workflow is a disposable fixture credential, just like the one in local Compose. It is not a production secret. The workflow uses `pull_request`, not `pull_request_target`, and requires no repository secrets. It never stages, commits, publishes, or changes branch protection.

## Review these files

| File | Purpose |
| --- | --- |
| `package.json` | Adds the sequential `test` aggregate and `check` command. |
| `.github/workflows/ci.yml` | Triggers, permissions, concurrency, runner, temporary services, clean install, migration, and checks. |
| `README.md` | Current phase, commands, and link to this walkthrough. |
| This guide | Explains the local/CI lifecycle and learning checkpoint. |

Application code, individual test suites, lockfile, and local Compose configuration remain unchanged.

## First GitHub run

After understanding and reviewing the diff, commit and push it yourself. Open the repository's **Actions** tab and select **FairGate CI**. Look for **Typecheck, tests, and build** and expand the first failed step if it is red. A fork pull request may need maintainer approval to run under the repository's Actions policy.

The workflow cannot be verified as a completed GitHub-hosted run until the file has been pushed and Actions runs it. Local checks and workflow syntax inspection are separate evidence. Do not claim the remote check passed based only on a local run.

Making this check mandatory before merging is a separate repository rules/branch-protection setting. A workflow file alone does not prohibit merging a failed PR. We have not changed that setting in this phase.

## Troubleshooting

- **Install fails:** inspect Node/registry errors and manifest-lockfile mismatches. Update dependencies intentionally with npm and review both manifest and lockfile; do not delete the lockfile to hide the mismatch.
- **Service health check fails:** inspect the job's service startup logs. No production credentials are needed.
- **Migration fails:** inspect the first failing migration. Keep previously applied migrations immutable; fix a schema change with an appropriate new migration.
- **Test fails:** identify the npm suite and named subtest; rerun that individual command locally after starting services and applying migrations.
- **Local passes but Linux fails:** compare Node versions, native dependencies, filename/import casing, and reliance on ignored files. A clean runner exposes assumptions hidden by an existing checkout.
- **Timeout or cancellation:** confirm whether a newer run replaced this one before treating it as an application failure.

## Learning exercise and checkpoint

Trace one pull request from checkout through PostgreSQL migration, a two-process booking test, and the Next.js build. Explain why the workflow uses real Redis/PostgreSQL, why the ports match our test guards, and why no seed data is required.

Then predict what happens if a new test fails: which later stages stop, where the failure appears, and why a green build alone would not replace the test suite. Compare `npm test` with `npm run check` and explain what each command guarantees.

Review the changes and commit them yourself when clear. Stop here; Phase 13 begins only when you are ready.
