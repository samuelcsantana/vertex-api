# Vertex API - System Context & AI Agent Rules

## 🎯 Project Objective
Vertex is the backend infrastructure for a high-level technical blog and SaaS portfolio. The ultimate goal is to serve as a showcase for international Senior/Tech Lead engineering roles.

## 🌍 Language & Localization
- **STRICT RULE:** The entire codebase MUST be written in English.
- This includes variable names, database tables, comments, documentation, commit messages, and API responses.

## 🛠️ Tech Stack & Architecture
- **Framework:** NestJS (Strict Mode)
- **HTTP Engine:** Fastify (Express is explicitly FORBIDDEN to maximize I/O performance)
- **Database:** PostgreSQL
- **ORM:** Drizzle ORM (Do NOT use Prisma or TypeORM)
- **Validation:** Zod
- **Security:** Argon2 (for password hashing), Helmet, strict CORS, JWT via HttpOnly Cookies (for XSS mitigation), and rate limiting via `@nestjs/throttler`.
- **Architecture Style:** NestJS standard modular architecture (Vertical Slices). Strong focus on Dependency Injection, Clean Code, and enterprise-grade patterns.

## 🏗️ Design Patterns & Code Quality (SOLID & Clean Code)
- **Separation of Concerns:** Controllers MUST only handle HTTP routing, DTO validation, and response mapping. ALL business logic MUST reside in Services or Use Cases.
- **SOLID Principles:**
  - Strictly enforce the Single Responsibility Principle (SRP).
  - Utilize Dependency Inversion (DIP) via NestJS Dependency Injection. Depend on abstractions (interfaces/abstract classes) when integrating external layers like Database Repositories or Third-party APIs.
  - **Where DIP is (and isn't) applied here:** `ObjectStorage` (`src/uploads/storage/`) is the seam for S3 — `UploadsService` keeps the domain logic (key naming, Markdown parsing) and depends on the abstraction; `S3ObjectStorage` is bound in `UploadsModule`'s providers, and unit tests inject a fake instead of faking AWS env vars. Drizzle deliberately gets **no** repository-interface layer on top: one database, no variation axis, the ORM already is the abstraction — don't add `IPostsRepository`-style ceremony. The OAuth strategies follow the same "fail at the boundary, not at boot" idea: they construct with placeholder credentials and 503 their own routes via an `authenticate()` guard when `GOOGLE_*`/`GITHUB_*` env vars are missing, instead of throwing in the constructor and taking the whole app (and every e2e run) down with them.
- **Clean Code Rules:**
  - Prefer early returns (guard clauses) to avoid deep nesting.
  - Write self-documenting code with meaningful, descriptive variable/function names.
  - Keep functions small, focused, and highly testable.
- **Error Handling:** Centralize error handling using NestJS Exception Filters. Never leak internal server errors or stack traces to the client.

## 🔐 Cross-Domain OAuth (Token Callback Pattern)
This API and vertex-web (the Next.js frontend) are deployed on different domains (Render vs. Vercel). A `Set-Cookie` issued directly from an OAuth callback response here would be scoped to *this API's own domain* — vertex-web's `cookies()` calls could never see it, regardless of polling. `handleOAuthCallback` in `auth.controller.ts` does not set a cookie at all:

1. It mints a random, single-use exchange code via `AuthService.createOAuthExchangeCode` (60s TTL, stored in an in-memory `Map` — deliberately not Redis/DB-backed, since a code is only ever meant to survive a single redirect hop on a single-instance deployment; the one failure mode, a process restart mid-flow, just means that one login attempt fails and the visitor retries).
2. It redirects the popup to `${FRONTEND_URL}/auth/callback?code=...` — the code, never the real JWT, since URLs can end up in browser history, `Referer` headers, or a proxy's access log.
3. vertex-web trades the code for the real token via `POST /auth/exchange`, which calls `AuthService.exchangeOAuthCode`. The code is deleted on first lookup *unconditionally* — valid or not — so a captured code can't be replayed even inside its 60s window.

`GOOGLE_CALLBACK_URL` / `GITHUB_CALLBACK_URL` still point at this API's own domain (unchanged) — only what happens *after* the callback succeeds is different. The GitHub account-linking flow (`isLinkFlow` branch in `githubAuthCallback`) is unaffected by any of this: it reuses the caller's existing session instead of issuing a new one, so it was never subject to the cross-domain cookie problem.

## 🚦 Rate Limiting
`@nestjs/throttler`, registered as `APP_GUARD` in `app.module.ts`: 100 requests/IP/60s globally, applied to every route with no extra decorator needed. `/auth/login` and `/auth/register` override this to a much tighter 5/60s via `@Throttle(...)`, since both are direct credential-guessing/account-spam targets.

This only works correctly because `trustProxy: true` is set on the Fastify adapter in `main.ts`. Without it, every request behind Render's reverse proxy resolves to the proxy's own IP instead of the real client's — per-IP limiting would collapse all traffic into one shared bucket. If this API is ever moved behind a different/additional proxy layer, re-verify this setting.

## 🌐 CORS
`main.ts` derives the allowed origin from `FRONTEND_URL` (same env var the OAuth callback redirect uses) rather than a hardcoded domain — one source of truth for vertex-web's origin instead of two values that could silently drift apart if the frontend's deployed URL ever changes.

## 🔒 Access Control
Every `POST`/`PATCH`/`DELETE` across posts, topics, about-page content, and uploads requires `JwtAuthGuard` + `AdminGuard` (`role !== 'admin'` → `ForbiddenException`). Comments are the deliberate exception: any authenticated user can create one (`JwtAuthGuard` alone), but deleting one still checks `isOwner || isAdmin` in `CommentsService.remove` — never just "is logged in." There's a third pattern in `UsersController`: `GET /users`, `PATCH /users/:id/ban`, and `DELETE /users/:id` are `AdminGuard`-gated same as posts/topics, but `DELETE /users/me` is deliberately `JwtAuthGuard`-only (no `AdminGuard`) — it's every user's own right to delete their own account (LGPD Art. 18), so it uses `request.user.sub` as an implicit self-target rather than an `:id` param. `UsersService.remove()` (admin-on-someone-else) and `.removeSelf()` (self-service) share the same underlying delete-and-cascade-comments logic via a private helper; only `remove()` has the "not your own account" guard, since self-deletion is the entire point of the other one. If you add a new mutation endpoint, match whichever of these three patterns actually fits (admin-only, owner-or-admin, or self-service-only) rather than defaulting to bare `JwtAuthGuard`.

## 🧾 User-Facing Error Responses
Any error a visitor actually sees in vertex-web must carry a machine-readable `code` (from `src/common/constants/error-codes.ts`) alongside its English `message` — e.g. `throw new UnauthorizedException({ message: 'Invalid credentials', code: ErrorCode.InvalidCredentials })`. vertex-web translates the code per-locale: its `src/lib/api-error-codes.ts` mirrors this list, so adding a code here means adding it there too, plus a message key in its `ApiErrors` namespace in all three locales (pt/en/es). Internal/generic errors (not-found lookups, token plumbing) deliberately stay message-only — only add a code when the frontend actually presents that failure to an end user. The GitHub OAuth popup is the special case: `GithubPopupExceptionFilter` redirects the popup to the frontend's `/auth/callback?oauth_error=<code>` instead of rendering any message itself, because an API-origin popup response can't know the visitor's locale.

## 🌿 Version Control & Git Strategy
- **Branching Model:** We follow a structured Gitflow standard.
  - `main`: Production-ready code.
  - `develop`: Integration branch for upcoming releases.
  - `feature/*`: For new features (branching off from `develop`).
  - `bugfix/*` / `hotfix/*`: For fixing issues.
- **`main` is branch-protected — there is no direct push, not even for admins.** `enforce_admins` is on, force-push and branch deletion are off, and the repo only allows Squash and Merge (merge commits and rebase merges are disabled at the repo level). Every change reaches `main` through a PR from a `feature/*`/`bugfix/*` branch: `git checkout -b feat/x`, commit freely (draft commits don't need to be clean — they get squashed away), `git push -u origin feat/x`, `gh pr create`, then `gh pr merge --squash --delete-branch`, using the PR title/body as the final, professional Conventional Commit message. After merging, sync `develop` (`git checkout develop && git merge origin/main && git push origin develop && git checkout main && git pull`) — `develop` itself isn't protected, so this fast-forward push works directly.
- **Semantic Commits (Conventional Commits):** ALL commit messages MUST follow the Conventional Commits specification strictly in English (e.g., `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`). This applies above all to the final squash-merge commit that actually lands on `main` — the throwaway commits on a feature branch don't need to individually satisfy this.
- **Atomic Commits:** Each squash-merged PR should represent a single, logical, atomic change. Do not bundle unrelated changes into a single PR.
- **AI Git Execution:** When asked to commit changes, the AI MUST branch off first (never commit directly to `main`), craft an appropriate Semantic Commit message in English for the eventual squash-merge, and ensure the PR represents an atomic change.
- **Releases:** Tag stable milestones with SemVer (`git tag vX.Y.Z && git push origin vX.Y.Z`) and publish a real GitHub Release from that tag (`gh release create vX.Y.Z --generate-notes`, then hand-edit the body — GitHub's auto-generated notes are only useful once there's real merged-PR history to summarize from).

## 🤖 AI Assistant Directives
1. **Always read this file** when starting a new session, creating new features, or answering architectural questions.
2. **Do not ask for interactive inputs** in the terminal. Always use non-interactive flags (e.g., `--yes`, `--strict`, etc.).
3. **No assumptions on DB changes:** Always generate Drizzle migrations explicitly before applying them.
4. **Code Quality:** Ensure all code adheres to ESLint/Prettier standards. Tests (Vitest/Jest) are expected for critical modules like Identity and Auth.
5. **Swagger stays in sync:** `swagger.json` at the repo root is a checked-in snapshot of the live OpenAPI spec (`GET /docs-json` while the app is running), not something the app generates on its own. Regenerate it by hand after changing any route's shape — `curl http://localhost:3333/docs-json` while `npm run start:dev` is running, then overwrite the file with the (pretty-printed) response.
6. **Pre-commit secret scanning:** `.husky/pre-commit` runs `npx lint-staged`, which runs `secretlint` (AWS-key + generic-secret rules, see `.secretlintrc.json`) against every staged file. A commit will hard-fail if it stages something that looks like a credential — don't route around it with `--no-verify`; if it's a false positive, fix the pattern or the file, not the hook. Note `"prepare": "husky || true"` in `package.json`: `npm ci --omit=dev` still runs the `prepare` lifecycle script even with dev deps skipped, so the `|| true` exists specifically to keep production Docker builds (which never install `husky` itself) from failing — don't remove it.
