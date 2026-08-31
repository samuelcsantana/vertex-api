# vertex-api

[![CI](https://github.com/samuelcsantana/vertex-api/actions/workflows/ci.yml/badge.svg)](https://github.com/samuelcsantana/vertex-api/actions/workflows/ci.yml)
[![Tests](https://github.com/samuelcsantana/vertex-api/actions/workflows/tests.yml/badge.svg)](https://github.com/samuelcsantana/vertex-api/actions/workflows/tests.yml)
[![Security](https://github.com/samuelcsantana/vertex-api/actions/workflows/security.yml/badge.svg)](https://github.com/samuelcsantana/vertex-api/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

The NestJS backend for **[samuelsantana.dev](https://samuelsantana.dev)**, a personal engineering blog and technical portfolio. Serves posts, topics, comments, and auth to **[vertex-web](https://github.com/samuelcsantana/vertex-web)**, the Next.js frontend, over a REST API on a different domain from the frontend, which shapes a few of the decisions below.

It runs on **AWS Lambda in São Paulo** — a container image behind CloudFront on `api.samuelsantana.dev` — with the database in the same region. It used to run on Render in Virginia while that database was already in São Paulo, so every query crossed a continent: a primary-key lookup measured **~240 ms**. The same class of request now completes in **24–34 ms**. Moving it is what `infra/` is for.

## Highlights

- **NestJS on Fastify**, not the default Express adapter — `@fastify/helmet` and `@fastify/cookie` sit directly on it.
- **Drizzle ORM over Postgres**, prepared statements by default (no hand-built SQL strings, so no injection surface from user text).
- **JWT sessions in an `HttpOnly` cookie**, verified — and the user re-checked for a ban flag — on every guarded request, not just at issuance.
- **Google/GitHub OAuth via the Token Callback Pattern.** This API can't set the session cookie directly on OAuth callback: it and vertex-web live on different domains, so a cookie set here would be scoped to *this* domain, invisible to the frontend's own `cookies()` calls. Instead, the callback mints a random, single-use exchange code (60s TTL, stored as a hash in Postgres) and redirects the popup to the frontend with the code — never the real token — in the URL. The frontend trades it for the real token via `POST /auth/exchange`, which deletes the code on first lookup regardless of validity, so a captured code can't be replayed even within its short window.
- **Write access is admin-only, everywhere.** Every `POST`/`PATCH`/`DELETE` across posts, topics, about-page content, and uploads requires `JwtAuthGuard` + `AdminGuard`. Comments are the one exception by design (any logged-in visitor can post one) — but deleting one still checks `isOwner || isAdmin` in the service layer, not just "is logged in."
- **Rate limited**, globally and per-route, and counted somewhere the caller cannot influence. 100 req/IP/60s by default (`@nestjs/throttler` as `APP_GUARD`); `/auth/login` and `/auth/register` get a much tighter 5/60s. Two things had to be true for that to mean anything on a serverless runtime, and neither is the default: the counters live in DynamoDB rather than in a process — ten concurrent attempts against a five-per-minute route were all answered before that changed, because each one got its own execution environment — and they are keyed on `CloudFront-Viewer-Address` rather than `request.ip`, because CloudFront *appends* to `X-Forwarded-For` instead of replacing it, making its leftmost entry a value the caller picks.

## Tech stack

- [NestJS](https://nestjs.com) on `@nestjs/platform-fastify`
- [Drizzle ORM](https://orm.drizzle.team) + PostgreSQL
- Passport (Google OAuth2, GitHub, JWT strategies)
- Zod for request validation
- AWS S3 (presigned uploads for post cover images)
- Swagger/OpenAPI, served at `/docs` by the long-lived server. The Lambda entry point deliberately leaves it out — `SwaggerModule.createDocument` walks the metadata of the whole application, which is worth doing once when a dev server starts and not on every cold start. `swagger.json` at the repo root is the checked-in snapshot of the contract.

## Getting started

### Prerequisites

- Node 20+
- Docker (for local Postgres) — or any reachable Postgres instance

### Setup

```bash
npm install
cp .env.example .env       # fill in the values you need — see below
docker compose up -d postgres   # starts local Postgres on :5435 (only the postgres service — see Docker below)
npm run db:push            # applies the Drizzle schema
npm run db:seed            # seeds default topics + About content
npm run start:dev
```

The API listens on `:3020` by default. Swagger UI is at `http://localhost:3020/docs`.

### Other scripts

```bash
npm run build       # production build
npm run lint         # eslint --fix
npm test             # unit tests (jest)
npm run test:e2e     # e2e tests
npm run test:cov     # coverage report
npm run db:generate  # generate a new Drizzle migration from schema changes
```

## Docker

This repo pairs with [vertex-web](https://github.com/samuelcsantana/vertex-web) (the frontend, on port `3021`) — the two run side by side in local dev with a collision-free port scheme against other sibling repos on this machine:

| Service | Port |
| --- | --- |
| `api` | 3020 |
| `postgres` (host-side only; container listens on 5432) | 5435 |

```bash
docker compose up -d --build
```

This builds and starts both the `api` and `postgres` services (`api` waits for `postgres`'s healthcheck before starting). To run only the database and keep using `npm run start:dev` for the app with hot reload, use `docker compose up -d postgres` instead — see the Setup section above.

### Two images, one application

`Dockerfile` builds the long-lived server this repository has always shipped: `node dist/src/main.js`, listening on a port. `Dockerfile.lambda` packages the same application as a Lambda container image, with `src/lambda.ts` as its entry point instead of `src/main.ts`. Neither replaces the other, and both build from the same `dist/`.

The difference that matters is the base image. `argon2` ships no prebuilt binary for musl, which is why the Alpine-based server image installs a C toolchain and compiles it from source. The Lambda base image is Amazon Linux — glibc — where `node-gyp-build` finds a prebuild and nothing needs compiling, so that image has no toolchain in it at all.

`src/bootstrap.ts` holds what both entry points must do identically: CORS, `@fastify/cookie`, `helmet`. Those are registered imperatively, outside the Nest module system, so a plugin added to one entry point and forgotten in the other would be a difference nothing type-checks — and a missing `@fastify/cookie` means `res.setCookie` is undefined and every login silently stops setting a session. Swagger stays out of it: `SwaggerModule.createDocument` walks the whole application's metadata, which is worth doing once when a dev server starts and not worth doing on every cold start.

Migrations are **not** run automatically on container start — there's no migration step in the image's `CMD`. Apply the Drizzle schema manually against whatever `DATABASE_URL` you're targeting with `npm run db:push`.

**Point `db:push` at the direct database host, not the pooled one.** In production `DATABASE_URL` is Neon's pooled endpoint (the hostname carrying a `-pooler` suffix), which is PgBouncer in transaction mode. That is the right endpoint for the running app and the wrong one for a schema migration: migration tooling leans on session-level state that a connection handed back to the pool after every transaction does not keep. Run migrations against the direct hostname — the same connection string with `-pooler` removed — and leave the pooled one to the app.

## Testing

Two layers:

- **Unit (Jest, wired into CI as `tests.yml`).** Mocked dependencies, no real Postgres needed — the exchange-code TTL/single-use logic in `AuthService` (including fake-timer tests for the 60s boundary), `AdminGuard`'s role check, `CommentsService.remove`'s `isOwner || isAdmin` rule, and `slugify`. As with vertex-web, this deliberately covers a handful of the highest-risk files completely rather than the whole codebase shallowly.
- **E2E (Jest + Supertest, `test/*.e2e-spec.ts`, not wired into CI).** Runs the real app against a real Postgres (`docker compose up -d` first) — registration, login, the `/auth/exchange` endpoint, unauthenticated-request rejection on protected routes, and the rate limiter actually returning 429 on the 6th request within its window. `test/utils/create-test-app.ts` is the one bootstrap helper all of these share; it exists because `Test.createTestingModule().createNestApplication()` defaults to an Express adapter that isn't even installed here (**this project's default e2e boilerplate never actually ran** — `@nestjs/platform-express` is missing, `@fastify/cookie` isn't registered outside `main.ts`'s own imperative bootstrap, and `uuid`'s ESM build isn't in Jest's default transform allowlist; all three needed fixing before any e2e test, including the original `app.e2e-spec.ts`, could pass). `auth.e2e-spec.ts` cleans up the throwaway users it creates in its own `afterAll` rather than letting them accumulate in whatever Postgres `DATABASE_URL` points at.

```bash
npm test              # unit tests
npm run test:cov      # unit tests with a coverage report
npm run test:e2e      # e2e — needs Postgres up (OAuth env vars are optional: unconfigured strategies 503 their own routes instead of crashing boot)
```

## Environment variables

See [`.env.example`](./.env.example) for the full, documented list. The ones most worth calling out:

| Variable | Purpose |
| --- | --- |
| `FRONTEND_URL` | vertex-web's own origin. Drives both CORS (`main.ts`) and the OAuth callback redirect target — one source of truth instead of two values that could drift apart. |
| `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET` | Required at boot; the app throws immediately if `COOKIE_SECRET` is missing. |
| `GOOGLE_CALLBACK_URL`, `GITHUB_CALLBACK_URL` | Registered with each provider's OAuth app config — these still point at *this* API's own domain even with the Token Callback Pattern in place, since only what happens *after* the callback succeeds changed. |
| `ADMIN_EMAIL` | The one address that gets `role: 'admin'` on first login/registration — everyone else is `role: 'user'`. |
| `THROTTLER_DDB_TABLE`, `THROTTLER_DDB_REGION` | Where rate-limit counters live. Unset keeps them in the API process — see below. |

### Rate-limit counters and concurrency

`@nestjs/throttler` counts in memory by default, which makes every configured limit a **per-process** limit. On one long-lived process that is exactly right. On a serverless runtime it is close to no limit at all: every concurrent request gets its own execution environment, and each starts its counter at zero. Ten simultaneous attempts against `POST /auth/login` — declared as five per minute — were all answered, none throttled, against this deployment. Sequential requests reuse a warm environment and are limited correctly, which is what made it easy to miss.

Setting `THROTTLER_DDB_TABLE` moves the counters into DynamoDB and makes the limits mean what they say. **It is set in production**, and the reason is not theoretical: before it was, ten simultaneous attempts against `/auth/login` — declared as five per minute — were all answered and none throttled, because each concurrent request got its own execution environment with a counter starting at zero. Sequential requests were limited correctly the whole time, which is exactly what made it easy to miss.

It stays off by default in the code because the throttler guard runs on **every** route, so a shared counter adds a round trip to every request, blog page views included. That is cheap when the table is beside the app and expensive when it is not — which is why the deployment decides rather than the code. The table is provisioned at 25 read and 25 write units, the always-free allowance; if it were ever exceeded the storage fails open rather than failing the request.

The table needs a single partition key `pk` (string) and TTL enabled on the `expiresAt` attribute. **Provisioned** capacity keeps it inside the always-free tier (25 read and 25 write units); on-demand does not. TTL is only garbage collection here — DynamoDB deletes expired items "typically within two days" and serves them in reads until it does, so the window is enforced against a timestamp in the item, never by the item's absence.

If the table cannot be reached, requests are **allowed** rather than refused. Failing closed would take the public blog down over a dependency that exists only to bound abuse; the reasoning is written out in `dynamodb-throttler-storage.ts`.

### What a rate limit counts against

`@nestjs/throttler` keys its counters on `request.ip`, which with `trustProxy: true` is the **leftmost** entry of `X-Forwarded-For`. Behind a CDN that is a value the caller picks: CloudFront *appends* the viewer's address to whatever `X-Forwarded-For` arrived rather than replacing it, so a request carrying `X-Forwarded-For: 1.2.3.4` is counted as 1.2.3.4 — and one that sends a fresh value each time is never counted twice. Every per-IP budget in the app becomes decorative, `/auth/login` included, and sharing the counters between instances does not help: they would be sharing a number that means nothing.

So the address comes from `CloudFront-Viewer-Address` instead, which CloudFront generates and overwrites — a viewer that sends its own is ignored — but only for requests that have proved they came through the CDN, using the same `EDGE_SHARED_SECRET` the edge check uses. With no secret configured there is no CDN in front, `X-Forwarded-For` is as trustworthy as it ever was, and `request.ip` stands.

**The distribution has to forward that header.** CloudFront's `AllViewer` origin request policy does **not** include `CloudFront-*` headers; use one that does, or add the header explicitly. If it is missing while the shared secret says the CDN is in front, the app logs a warning once and falls back to the spoofable value — the configuration is wrong, and silence would hide it.

### Proving a request came through the CDN

When this API runs behind a CDN whose origin is publicly resolvable — a Lambda function URL is, and cannot be closed with origin access control without breaking every browser `POST` — anyone who finds the origin hostname can bypass whatever the distribution enforces.

`EDGE_SHARED_SECRET` closes that. Configure the CDN to send the same value as an `x-origin-verify` origin header on every request, and the API answers `403` to anything arriving without it. This is not user authentication; it is the origin declining to talk to callers who cannot show they are the edge — the same shape of trust as `trustProxy`, which believes a forwarded client IP only because a proxy it trusts put it there.

Unset, every request is accepted. That is correct for local development, for the e2e suite, and for a deployment with nothing in front of it — and it is the thing to remember to set on the day a distribution appears, because an unset secret makes that distribution decorative.

### Where configuration comes from

Locally, from `.env` and the shell. On Lambda, from **SSM Parameter Store**: set `CONFIG_PARAMETER_PREFIX` to a path prefix and everything under it is read into `process.env` once per execution environment, before the app is built.

The reason is not how the values are read but where they end up. A value set as a Lambda environment variable has to come from somewhere — hardcoded in the Terraform, or read by Terraform and written to the function — and either way it lands in the state file, which becomes a copy of every secret sitting in a bucket nobody thinks of as holding secrets. Reading them at runtime means Terraform creates the parameters and never learns their contents.

Anything already present in the environment wins over the store, so a single value can be overridden for a debug run without writing to it. With no prefix configured the loader does nothing at all, which is what keeps `npm run start:dev` and the e2e suite untouched.

### Infrastructure

`infra/` is the Terraform for the AWS side of this service. Two things about how it is wired are worth knowing before running it.

**Terraform assumes a role rather than being one.** The identity that runs it — a local IAM user, or a GitHub OIDC identity in CI — is allowed to do exactly one thing: assume `vertex-api-terraform`. Every permission lives on that role, and the role's policy is scoped to resources named `vertex-api*` rather than to `*`, so a leaked credential is worth an hour of one project rather than an account. The `provisioning_identity` output exists to make that visible: if it ever reads as a user or the account root instead of an assumed role, the wiring has come undone.

**State is in S3, and the bucket is not managed here.** Terraform needs somewhere to keep state before it has ever run, so the bucket was created out of band — versioned, encrypted, public access blocked, TLS-only — and deliberately left out of the configuration. State that can destroy the bucket holding it is a loop worth not being in.

```bash
cd infra
export AWS_PROFILE=vertex-api-deployer   # the identity allowed to assume the role
terraform init
terraform plan
```

CI checks formatting and validity with `-backend=false`, which needs no credentials. A plan needs the account and is run by hand.

## Deployment

```
vertex-web (Vercel)  ──►  CloudFront  ──►  Lambda function URL  ──►  Neon Postgres
samuelsantana.dev         api.samuelsantana.dev   │  NestJS + Fastify     │
                                                  │  container image      │
                                                  └── sa-east-1 ──────────┘
                                                        (same region)
```

The certificate is the one piece that lives elsewhere: CloudFront reads certificates from `us-east-1` and nowhere else, so ACM is the only resource in this stack outside São Paulo.

**Why CloudFront is here at all:** a Lambda function URL cannot carry a custom domain. That single constraint pulls in the rest.

**Why the function URL is public.** Locking an origin to its distribution means origin access control, and OAC requires the *caller* to send a SHA-256 of the request body — AWS's wording is "Lambda doesn't support unsigned payloads". A browser doing `fetch` cannot produce that, so every `POST` from the site would fail: login, registration, the OAuth exchange, posting a comment. The URL therefore stays reachable, and a shared secret in an origin header is what makes reaching it useless. See [Proving a request came through the CDN](#proving-a-request-came-through-the-cdn).

**Why nothing is cached.** This API authenticates with an `HttpOnly` cookie, and CloudFront's default cache policy does not put `Cookie` in the cache key — one visitor's `GET /auth/profile` would be stored and served to the next. `CachingDisabled` is a correctness requirement here, not a tuning decision left for later.

Measured on the deployed stack, server-side rather than from a client:

| | |
|---|---|
| Cold start | ~2.5 s (850 ms init + ~1.6 s to build the app, read Parameter Store and connect) |
| `GET /health` warm | ~3 ms |
| `GET /posts` warm, querying Postgres | 24–34 ms |
| Memory used | 195 MB of 1024 |

Memory is set well above what the function uses because on Lambda memory *is* CPU, and a cold start is bound by how fast the module graph executes. Billing is in GB-seconds, so finishing sooner at more memory can cost the same or less.

Configuration is read from SSM Parameter Store at cold start rather than set as environment variables on the function — see [Where configuration comes from](#where-configuration-comes-from). Everything above is Terraform in `infra/`; see [Infrastructure](#infrastructure).

## Architecture notes

- **Auth guards compose, they don't duplicate logic.** `JwtAuthGuard` verifies the token and populates `request.user`; `AdminGuard` just reads `request.user.role` — it always runs after `JwtAuthGuard` in the guard chain, never standalone.
- **OAuth exchange codes live in Postgres, and used not to.** They were an in-memory `Map`, which is correct for exactly one deployment shape: a single process. The request that mints a code and the `POST /auth/exchange` that spends it are two separate HTTP calls, so anything running more than one — a second instance, the overlap of a rolling deploy, a serverless environment — can land them in different memory, and the second one finds nothing. The symptom would have been OAuth logins failing for some visitors some of the time while every local run passed. The row stores a SHA-256 of the code and the user's id, never the code itself and never a frozen token payload, so the token is rebuilt from the current row when the code is spent — a role changed inside that 60-second window cannot ride into a token that then lives for seven days.
- **Passport strategies own their own callback URL fallback** (`GOOGLE_CALLBACK_URL ?? 'http://localhost:3333/auth/google/callback'`), so local dev works without any `.env` file at all.

## Related repository

- [vertex-web](https://github.com/samuelcsantana/vertex-web) — the Next.js frontend this API serves.
