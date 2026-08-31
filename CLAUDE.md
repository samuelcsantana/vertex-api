# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

The NestJS backend for samuelsantana.dev, a personal engineering blog/portfolio. Serves posts,
topics, comments, and auth to **vertex-web** (the Next.js frontend, separate repo), over a REST
API — deployed on a different domain from the frontend, which shapes several decisions below
(CORS, OAuth cookie handling).

**Since 31/08/2026 this runs on AWS Lambda, not on Render.** A container image in `sa-east-1`,
behind a CloudFront distribution that serves `api.samuelsantana.dev`; the origin is a Lambda
function URL. Configuration is read from SSM Parameter Store at cold start, not from environment
variables on the function. Infrastructure is Terraform in `infra/`, run by a role that the local
identity may only assume. `Dockerfile.lambda` builds that image; `Dockerfile` still builds the
long-lived server, which is what local development and any container host use.

Tech stack: NestJS on **Fastify** (Express is forbidden — not installed, don't add it), Drizzle
ORM over PostgreSQL (not Prisma/TypeORM), Zod validation, Argon2 password hashing, JWT in an
`HttpOnly` cookie, Passport (Google/GitHub OAuth + JWT strategies), AWS S3 (presigned uploads),
Swagger/OpenAPI at `/docs`.

The entire codebase (vars, DB tables, comments, commit messages, API responses) must be in
English.

## Commands

```bash
npm install
cp .env.example .env            # fill in required values
docker compose up -d postgres   # local Postgres only, on host port 5435
npm run db:push                 # apply Drizzle schema
npm run db:seed                 # seed default topics + About content
npm run start:dev               # API on :3020 (Swagger UI at /docs)
```

```bash
npm run build            # production build (nest build)
npm run lint              # eslint --fix over src/apps/libs/test
npm run format             # prettier --write
npm test                   # unit tests (jest)
npm run test:watch         # jest --watch
npm run test:cov           # unit tests + coverage
npm run test:e2e           # e2e (jest + supertest) — needs Postgres running; not wired into CI
npm run db:generate        # generate a new Drizzle migration from schema changes
```

Run a single test file: `npx jest path/to/file.spec.ts` (or `npx jest -t "test name"` to filter by
name). For e2e: `npx jest --config ./test/jest-e2e.json --runInBand path/to/file.e2e-spec.ts`.

`npm run test:debug` attaches the Node inspector (`--inspect-brk`) for step debugging a single
Jest run.

Full local stack: `docker compose up -d --build` builds and runs both `api` (:3020) and `postgres`
(host :5435 → container :5432); `api` waits on postgres's healthcheck. Migrations are **not** run
automatically on container start — apply them manually with `npm run db:push` against whichever
`DATABASE_URL` you're targeting.

Regenerating the checked-in OpenAPI snapshot: `swagger.json` at the repo root does not update
itself. After changing any route's shape, run the app locally and
`curl http://localhost:3020/docs-json`, pretty-print, and overwrite `swagger.json` by hand.

## Architecture

**Module layout.** Standard NestJS vertical-slice modules under `src/`: `auth`, `posts`, `topics`,
`comments`, `about`, `uploads`, `projects`, `users`, `health`, plus `database` (global) and
`common` (shared constants/pipes/utils). Each domain module follows
`*.module.ts` / `*.controller.ts` / `*.service.ts` / `dto/`. Controllers only do HTTP
routing/DTO validation/response mapping; business logic lives in services.

**Database.** `DatabaseModule` is `@Global()` — one `DatabaseService` (Drizzle + `postgres-js`)
injected everywhere, connection opened in `onModuleInit`/closed in `onModuleDestroy`. Schema lives
in `src/database/schema.ts` (tables: `users`, `emailOtps`, `projects`, `posts`, `aboutContent`,
`topics`, `postsToTopics` join table, `comments`). There is deliberately **no** repository-interface
layer over Drizzle (no `IPostsRepository` abstraction) — one database, no variation axis, the ORM
already is the abstraction. Contrast with `ObjectStorage` (`src/uploads/storage/`), which *is* a
real DIP seam: `UploadsService` depends on the `ObjectStorage` abstraction (key naming, Markdown
parsing stay in the service), `S3ObjectStorage` is the concrete AWS implementation bound in
`UploadsModule`'s providers, and unit tests inject a fake instead of mocking AWS env vars.

**Auth guard composition.** `JwtAuthGuard` verifies the cookie-borne JWT and populates
`request.user`; `AdminGuard` just reads `request.user.role` and always runs *after*
`JwtAuthGuard` in the chain, never standalone. Three access-control patterns are in use across
the API — match whichever fits a new mutation endpoint rather than defaulting to bare
`JwtAuthGuard`:
- **Admin-only** (`JwtAuthGuard` + `AdminGuard`): every `POST`/`PATCH`/`DELETE` on posts, topics,
  about-page content, uploads; also `GET /users`, `PATCH /users/:id/ban`, `DELETE /users/:id`.
- **Owner-or-admin**: comment creation only needs `JwtAuthGuard`, but
  `CommentsService.remove` checks `isOwner || isAdmin` in the service layer.
- **Self-service-only**: `DELETE /users/me` is `JwtAuthGuard`-only (no `AdminGuard`) — every
  user's right to delete their own account (LGPD Art. 18) — using `request.user.sub` as an
  implicit target rather than an `:id` param. `UsersService.remove()` (admin) and
  `.removeSelf()` (self) share a private delete-and-cascade-comments helper; only `remove()`
  checks "not your own account."

**OAuth: Token Callback Pattern.** This API and vertex-web live on different domains, so a
`Set-Cookie` issued directly from an OAuth callback would be scoped to this API's own domain and
invisible to vertex-web. Instead (`auth.controller.ts` `handleOAuthCallback`):
1. Mint a random single-use exchange code (`AuthService.createOAuthExchangeCode`, 60s TTL, kept
   in an in-memory `Map` — deliberately not Redis/DB-backed, since a code only needs to survive a
   single redirect hop on a single-instance deployment).
2. Redirect the popup to `${FRONTEND_URL}/auth/callback?code=...` — the code, never the JWT.
3. vertex-web trades it via `POST /auth/exchange` → `AuthService.exchangeOAuthCode`, which deletes
   the code on first lookup **unconditionally** (valid or not), so a captured code can't be
   replayed even inside its window.

`GOOGLE_CALLBACK_URL`/`GITHUB_CALLBACK_URL` still point at this API's own domain — only what
happens after the callback succeeds differs. The GitHub account-linking flow (`isLinkFlow` branch
in `githubAuthCallback`) reuses the caller's existing session instead of issuing a new one, so it's
unaffected. OAuth strategies (`src/auth/strategies/`) construct with placeholder credentials when
`GOOGLE_*`/`GITHUB_*` env vars are absent and 503 their own routes via an `authenticate()` guard
override, rather than throwing at boot and taking the whole app down — this is why e2e tests don't
need OAuth env vars configured.

**Rate limiting.** `@nestjs/throttler` registered as `APP_GUARD` in `app.module.ts`: 100
requests/IP/60s globally. `/auth/login` and `/auth/register` override to 5/60s via `@Throttle(...)`.
`trustProxy: true` on the Fastify adapter is what stops every request resolving to the proxy's own
address, but **the rate limiter deliberately does not use `request.ip`**. Behind CloudFront that
value is the leftmost `X-Forwarded-For` entry, and CloudFront *appends* to that header rather than
replacing it — so it is a value the caller chose, and a caller sending a fresh one per request is
never counted twice. Counters are keyed on `CloudFront-Viewer-Address` instead, which CloudFront
generates and overwrites, and only for requests that proved they came through the CDN. See
`src/common/throttler/client-tracker.ts`.

Where the counters live is chosen by `THROTTLER_DDB_TABLE`: in-memory by default, which is correct
for one process, and DynamoDB when set. It is currently unset, and the app says so at boot.

A separate guard rejects anything that did not come through the CDN
(`src/common/edge/edge-origin.guard.ts`): the Lambda function URL is publicly resolvable and
cannot be closed with origin access control, because OAC requires the caller to send a SHA-256 of
the request body and a browser doing `fetch` cannot. A shared secret in the `x-origin-verify`
origin header is what separates the distribution from anyone else who finds the URL.

**CORS.** `main.ts` derives the allowed origin from `FRONTEND_URL` — one source of truth shared
with the OAuth redirect target. It also allows both the apex and `www.` variant of that host
(`withWwwVariant` helper), because a browser's `Origin` header is exact-host and a single-origin
allowlist previously caused a production CORS outage when `FRONTEND_URL` was set to the apex domain
but the deployed frontend was actually reachable at `www.`.

**User-facing error responses.** Any error a visitor sees in vertex-web must carry a
machine-readable `code` from `src/common/constants/error-codes.ts` alongside the English
`message`, e.g. `throw new UnauthorizedException({ message: 'Invalid credentials', code:
ErrorCode.InvalidCredentials })`. vertex-web mirrors this list in its own
`src/lib/api-error-codes.ts` plus per-locale messages (pt/en/es) — adding a code here means adding
it there too. Internal/generic errors (not-found lookups, token plumbing) stay message-only; only
add a code when the frontend actually presents the failure to an end user. The GitHub OAuth popup
is a special case: `GithubPopupExceptionFilter` redirects to
`/auth/callback?oauth_error=<code>` instead of rendering a message, since an API-origin popup
can't know the visitor's locale.

**Testing layers.**
- *Unit* (Jest, in CI via `tests.yml`): mocked dependencies, no real Postgres. Covers the
  highest-risk logic deliberately deeply rather than the whole codebase shallowly — e.g. the
  exchange-code TTL/single-use behavior in `AuthService` (including fake-timer tests for the 60s
  boundary), `AdminGuard`'s role check, `CommentsService.remove`'s `isOwner || isAdmin` rule.
- *E2E* (Jest + Supertest, `test/*.e2e-spec.ts`, **not** wired into CI): runs the real app against
  real Postgres. `test/utils/create-test-app.ts` is the shared bootstrap helper — required because
  Nest's default `createNestApplication()` assumes an Express adapter that isn't installed here;
  `@fastify/cookie` also needs registering outside `main.ts`'s own bootstrap, and `uuid`'s ESM
  build needs adding to Jest's transform allowlist. `auth.e2e-spec.ts` cleans up the users it
  creates in its own `afterAll`.

## Code conventions

Controllers handle HTTP and nothing else — routing, DTO validation, response mapping. Business
logic lives in services. Guard clauses instead of nested conditionals, small focused functions,
names that carry their own meaning. Errors are centralised in exception filters; a stack trace
never reaches a client.

Dependency inversion is applied at external boundaries **and nowhere else**, and that limit is the
point. `ObjectStorage` (`src/uploads/storage/`) is the seam for S3: `UploadsService` keeps the
domain logic — key naming, Markdown parsing — and depends on the abstraction, `S3ObjectStorage` is
bound in `UploadsModule`'s providers, and unit tests inject a fake rather than faking AWS
environment variables.

Drizzle deliberately gets **no** repository-interface layer on top of it: one database, no
variation axis, and the ORM is already the abstraction. Tests that need a database fake build a
chainable stand-in for `databaseService.db` by hand — see `otp.service.spec.ts`. Do not introduce
a repository layer to make testing easier; it has been considered and rejected.

## Error responses a visitor sees

Any error that surfaces in vertex-web's UI must carry a machine-readable `code` from
`src/common/constants/error-codes.ts` next to its English `message`:

```ts
throw new UnauthorizedException({
  message: 'Invalid credentials',
  code: ErrorCode.InvalidCredentials,
});
```

vertex-web translates the code per locale and mirrors this list in its own
`src/lib/api-error-codes.ts`. Adding a code here without adding it there leaves the visitor with
an untranslated fallback, and nothing fails to make that visible.

## Environment variables

See `.env.example` for the full list. Notable ones: `FRONTEND_URL` (drives CORS and the OAuth
redirect target), `DATABASE_URL`/`JWT_SECRET`/`COOKIE_SECRET` (required at boot — app throws
immediately if `COOKIE_SECRET` is missing), `GOOGLE_CALLBACK_URL`/`GITHUB_CALLBACK_URL` (point at
this API's own domain), `ADMIN_EMAIL` (the one address that gets `role: 'admin'` on first
login/registration).

## Git workflow

Gitflow-style: `main` (production, branch-protected — no direct pushes even for admins,
squash-merge only) ← PR from `develop` ← PR from `feature/*`/`bugfix/*`/`hotfix/*`. Typical flow:
`git checkout -b feat/x`, commit freely, `git push -u origin feat/x`, `gh pr create`, then
`gh pr merge --squash --delete-branch`. After merging, fast-forward `develop` from `main`
(`develop` itself isn't protected). Commit messages (especially the final squash-merge message)
must follow Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`) in
English. Tag releases with SemVer and `gh release create vX.Y.Z --generate-notes`, then hand-edit
the generated body.

Pre-commit hook (`.husky/pre-commit` → `npx lint-staged` → `secretlint`) hard-fails a commit that
stages anything matching an AWS key or generic secret pattern — fix the pattern/file, don't
`--no-verify` around it. `"prepare": "husky || true"` in `package.json` exists so
`npm ci --omit=dev` (which never installs `husky`) doesn't fail production Docker builds; don't
remove the `|| true`.

Always generate Drizzle migrations explicitly (`npm run db:generate`) before applying schema
changes — never assume a migration from a schema edit alone.
