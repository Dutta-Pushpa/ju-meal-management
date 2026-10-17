# Deployment and CI/CD

How the project is built, tested, published, and (later) deployed.

> **সংক্ষিপ্ত:** CI/CD পাইপলাইন, কন্টেইনার প্রকাশ, এবং ডিপ্লয়মেন্ট চেকলিস্ট।

## Pipelines

| Workflow                                  | Trigger                                    | Purpose                                   |
| ----------------------------------------- | ------------------------------------------ | ----------------------------------------- |
| [ci.yml](../.github/workflows/ci.yml)     | Push to `main`/`development`, pull request | Quality gates and tests                   |
| [cd.yml](../.github/workflows/cd.yml)     | Tag `v*`, or manual                        | Publish the API image, deploy placeholder |
| [load.yml](../.github/workflows/load.yml) | Nightly, or manual                         | JMeter load test                          |

Later-phase jobs detect their own input files and **skip themselves** while a
phase is unfinished. Adding the file is what activates the job; the workflow
does not need editing.

## Continuous integration

`.github/workflows/ci.yml`:

| Job                        | Runs                                                    | Active when                               |
| -------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| Capture phase inputs       | Scans the tree for later-phase files                    | Always                                    |
| Format, lint, type-check   | `format:check`, `lint`, `typecheck`                     | Always                                    |
| Unit and integration tests | Tests against a PostgreSQL 16 service                   | Always — coverage uploaded as an artifact |
| API collection (Newman)    | Boots the API, waits for `/health`, runs the collection | `postman/**/*.json` exists (Phase 7)      |
| Frontend build             | `npm run build --workspace client`                      | `client/vite.config.*` exists (Phase 10)  |

The integration database is created by the service container (`ju_meal_test`)
and migrated by the test suite itself. Tests never touch development or
production data: the suite refuses to run against a database whose name does not
end in `_test`.

Any failing step fails the pipeline. A newer push to the same branch cancels an
in-flight run.

## Continuous delivery

`.github/workflows/cd.yml` triggers on a version tag (`v1.2.3`) or manually.

1. **detect** — looks for a `Dockerfile` at the repository root or under
   `server/`.
2. **publish-image** — only when a Dockerfile exists. Builds the image and
   pushes it to the GitHub Container Registry:
   `ghcr.io/<owner>/<repo>/ju-meal-server`. Tagged with the version, the short
   commit SHA, and `latest` for version tags. No secret is required; the
   workflow's own `GITHUB_TOKEN` is used.
3. **deploy** — **a disabled placeholder.** It runs only when the repository
   variable `DEPLOY_ENABLED` is `true` **and** an image was published, and it
   only prints a reminder. Nothing is deployed yet.

### Why the deploy job is disabled

Deployment needs a host, a database, and secrets that do not exist yet — Phase 11. Rather than guess, the pipeline publishes a ready-to-run image and stops
there. Enabling it is a deliberate step, described below.

## Enabling deployment (Phase 11 checklist)

1. **Add a Dockerfile.** A multi-stage build for the server (Node 22, `npm ci`,
   non-root user). This alone activates `publish-image`.
2. **Choose a host** and decide how migrations run. Migrations must run **once**
   per release, before the new version serves traffic — never concurrently from
   every replica. `npm run db:migrate` is idempotent and safe to re-run.
3. **Configure the `production` environment** in GitHub with required reviewers,
   so every deploy is approved.
4. **Set the repository variable** `DEPLOY_ENABLED=true`.
5. **Add the deploy secrets** the chosen host needs (for example `DEPLOY_HOST`,
   `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PATH`) and replace the placeholder
   step in `cd.yml` with the real commands.
6. **Point the runtime at production configuration.** The application refuses to
   boot with unsafe production settings, which is enforced in
   `server/src/config/env.ts`:
   - `NODE_ENV=production`
   - `DB_SSL=true`
   - `LOG_PRETTY=false`
   - `JWT_SECRET` set to a long random value, not the example
   - `DATABASE_URL` pointing at the managed database, never a container on the
     application host

### Managed PostgreSQL with Neon

Production uses a managed database. [Neon](https://neon.tech) fits this project:

- `DATABASE_URL` — the **pooled** connection string (host contains `-pooler`),
  used by the API pool at runtime.
- `DATABASE_ADMIN_URL` — the **direct** connection string, used by the one-off
  `npm run db:migrate` release step. Migrations hold a session-level advisory
  lock, which a transaction pooler cannot keep across statements.
- `DB_SSL=true` — required in production; Neon URLs also carry `sslmode=require`.

Run migrations once per release, before the new version takes traffic, rather
than from every application instance. `npm run db:migrate` is idempotent.

## Configuration and secrets

| Name             | Kind          | Used for                                   |
| ---------------- | ------------- | ------------------------------------------ |
| `GITHUB_TOKEN`   | Built-in      | Pushing images to GHCR                     |
| `DEPLOY_ENABLED` | Repo variable | Master switch for the deploy job           |
| Host secrets     | Repo secrets  | Added in Phase 11; see the checklist above |

No credential is ever committed. Environment files hold placeholders only, and
CI injects throwaway values scoped to a single job.

## Release process

1. Merge to `main` once CI is green.
2. Tag the release: `git tag v1.2.0 && git push origin v1.2.0`.
3. CD publishes `ghcr.io/<owner>/<repo>/ju-meal-server:v1.2.0` (and `latest`).
4. Once deployment is enabled, approve the `production` environment to deploy.

## Correctness notes

- **Migrations are not automatic on deploy.** They are a controlled step so a
  bad migration can be caught before it reaches every instance.
- **The image is the artifact.** The same image is promoted between environments;
  only configuration changes.
- Load tests report throughput and latency, but correctness matters more: after a
  run, ledger debits must equal confirmed order totals and no balance may go
  negative. See [development.md](development.md#load-testing).
