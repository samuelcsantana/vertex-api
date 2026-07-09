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
docker compose up -d       # starts local Postgres on :5432
npm run db:push            # applies the Drizzle schema
npm run db:seed            # seeds default topics + About content
npm run start:dev
```

The API listens on `:3333` by default. Swagger UI is at `http://localhost:3333/docs`.

### Other scripts

```bash
npm run build       # production build
npm run lint         # eslint --fix
npm test             # unit tests (jest)
npm run test:e2e     # e2e tests
npm run test:cov     # coverage report
npm run db:generate  # generate a new Drizzle migration from schema changes
```

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

## Architecture notes

- **Auth guards compose, they don't duplicate logic.** `JwtAuthGuard` verifies the token and populates `request.user`; `AdminGuard` just reads `request.user.role` — it always runs after `JwtAuthGuard` in the guard chain, never standalone.
- **OAuth exchange codes are intentionally in-memory, not DB- or Redis-backed.** A code is only ever meant to survive a single redirect hop (a few seconds, 60s TTL as a hard ceiling) on a single-instance deployment — durability across a process restart isn't a real requirement here, and the one failure mode (a restart mid-flow) just means that one login attempt fails and the visitor retries.
- **Passport strategies own their own callback URL fallback** (`GOOGLE_CALLBACK_URL ?? 'http://localhost:3333/auth/google/callback'`), so local dev works without any `.env` file at all.

## Related repository

- [vertex-web](https://github.com/samuelcsantana/vertex-web) — the Next.js frontend this API serves.
