# vertex-api

[![CI](https://github.com/samuelcsantana/vertex-api/actions/workflows/ci.yml/badge.svg)](https://github.com/samuelcsantana/vertex-api/actions/workflows/ci.yml)
[![Tests](https://github.com/samuelcsantana/vertex-api/actions/workflows/tests.yml/badge.svg)](https://github.com/samuelcsantana/vertex-api/actions/workflows/tests.yml)
[![Security](https://github.com/samuelcsantana/vertex-api/actions/workflows/security.yml/badge.svg)](https://github.com/samuelcsantana/vertex-api/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

The NestJS backend for **[samuelsantana.dev](https://samuelsantana.dev)**, a personal engineering blog and technical portfolio. Serves posts, topics, comments, and auth to **[vertex-web](https://github.com/samuelcsantana/vertex-web)**, the Next.js frontend, over a REST API — deployed on a different domain (Render vs. Vercel), which shapes a few of the decisions below.

## Highlights

- **NestJS on Fastify**, not the default Express adapter — `@fastify/helmet` and `@fastify/cookie` sit directly on it.
- **Drizzle ORM over Postgres**, prepared statements by default (no hand-built SQL strings, so no injection surface from user text).
- **JWT sessions in an `HttpOnly` cookie**, verified — and the user re-checked for a ban flag — on every guarded request, not just at issuance.
- **Google/GitHub OAuth via the Token Callback Pattern.** This API can't set the session cookie directly on OAuth callback: it and vertex-web live on different domains, so a cookie set here would be scoped to *this* domain, invisible to the frontend's own `cookies()` calls. Instead, the callback mints a random, single-use exchange code (60s TTL, in-memory) and redirects the popup to the frontend with the code — never the real token — in the URL. The frontend trades it for the real token via `POST /auth/exchange`, which deletes the code on first lookup regardless of validity, so a captured code can't be replayed even within its short window.
- **Write access is admin-only, everywhere.** Every `POST`/`PATCH`/`DELETE` across posts, topics, about-page content, and uploads requires `JwtAuthGuard` + `AdminGuard`. Comments are the one exception by design (any logged-in visitor can post one) — but deleting one still checks `isOwner || isAdmin` in the service layer, not just "is logged in."
- **Rate limited**, globally and per-route. 100 req/IP/60s by default (`@nestjs/throttler`, registered as `APP_GUARD`); `/auth/login` and `/auth/register` get a much tighter 5/60s, since both are direct brute-force/spam targets. `trustProxy` is enabled on the Fastify adapter so this reads the real client IP behind Render's reverse proxy instead of collapsing all traffic into one shared bucket.

## Tech stack

- [NestJS](https://nestjs.com) on `@nestjs/platform-fastify`
- [Drizzle ORM](https://orm.drizzle.team) + PostgreSQL
- Passport (Google OAuth2, GitHub, JWT strategies)
- Zod for request validation
- AWS S3 (presigned uploads for post cover images)
- Swagger/OpenAPI, served at `/docs`

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

### Rate-limit counters and the second instance

`@nestjs/throttler` counts in memory by default, which makes every configured limit a **per-process** limit. On one instance that is exactly right. On two, each one grants the full budget on its own, so `POST /auth/login`'s 5-per-minute becomes 10 — and which instance answers is the load balancer's business, not the attacker's problem.

Setting `THROTTLER_DDB_TABLE` moves the counters into DynamoDB and makes the limits mean what they say across instances. It is off by default because it is not free: the throttler guard runs on **every** route, so a shared counter adds a network round trip to every request, blog page views included. That is cheap when the table is in the same region as the app and expensive when it is not — which is why the deployment decides rather than the code.

The table needs a single partition key `pk` (string) and TTL enabled on the `expiresAt` attribute. **Provisioned** capacity keeps it inside the always-free tier (25 read and 25 write units); on-demand does not. TTL is only garbage collection here — DynamoDB deletes expired items "typically within two days" and serves them in reads until it does, so the window is enforced against a timestamp in the item, never by the item's absence.

If the table cannot be reached, requests are **allowed** rather than refused. Failing closed would take the public blog down over a dependency that exists only to bound abuse; the reasoning is written out in `dynamodb-throttler-storage.ts`.

## Architecture notes

- **Auth guards compose, they don't duplicate logic.** `JwtAuthGuard` verifies the token and populates `request.user`; `AdminGuard` just reads `request.user.role` — it always runs after `JwtAuthGuard` in the guard chain, never standalone.
- **OAuth exchange codes are intentionally in-memory, not DB- or Redis-backed.** A code is only ever meant to survive a single redirect hop (a few seconds, 60s TTL as a hard ceiling) on a single-instance deployment — durability across a process restart isn't a real requirement here, and the one failure mode (a restart mid-flow) just means that one login attempt fails and the visitor retries.
- **Passport strategies own their own callback URL fallback** (`GOOGLE_CALLBACK_URL ?? 'http://localhost:3333/auth/google/callback'`), so local dev works without any `.env` file at all.

## Related repository

- [vertex-web](https://github.com/samuelcsantana/vertex-web) — the Next.js frontend this API serves.
