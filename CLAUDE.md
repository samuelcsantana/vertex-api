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
- **Security:** Argon2 (for password hashing), Helmet, strict CORS, and JWT via HttpOnly Cookies (for XSS mitigation).
- **Architecture Style:** NestJS standard modular architecture (Vertical Slices). Strong focus on Dependency Injection, Clean Code, and enterprise-grade patterns.

## 🏗️ Design Patterns & Code Quality (SOLID & Clean Code)
- **Separation of Concerns:** Controllers MUST only handle HTTP routing, DTO validation, and response mapping. ALL business logic MUST reside in Services or Use Cases.
- **SOLID Principles:** 
  - Strictly enforce the Single Responsibility Principle (SRP). 
  - Utilize Dependency Inversion (DIP) via NestJS Dependency Injection. Depend on abstractions (interfaces/abstract classes) when integrating external layers like Database Repositories or Third-party APIs.
- **Clean Code Rules:** 
  - Prefer early returns (guard clauses) to avoid deep nesting.
  - Write self-documenting code with meaningful, descriptive variable/function names.
  - Keep functions small, focused, and highly testable.
- **Error Handling:** Centralize error handling using NestJS Exception Filters. Never leak internal server errors or stack traces to the client.

## 🌿 Version Control & Git Strategy
- **Branching Model:** We follow a structured Gitflow standard. 
  - `main`: Production-ready code.
  - `develop`: Integration branch for upcoming releases.
  - `feature/*`: For new features (branching off from `develop`).
  - `bugfix/*` / `hotfix/*`: For fixing issues.
- **Semantic Commits (Conventional Commits):** ALL commit messages MUST follow the Conventional Commits specification strictly in English (e.g., `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`).
- **Atomic Commits:** Commits MUST be atomic. Each commit should represent a single, logical change. Do not bundle unrelated changes into a single commit.
- **AI Git Execution:** When asked to commit changes, the AI MUST analyze the staged files, craft an appropriate Semantic Commit message in English, and ensure the commit represents an atomic change.

## 🤖 AI Assistant Directives
1. **Always read this file** when starting a new session, creating new features, or answering architectural questions.
2. **Do not ask for interactive inputs** in the terminal. Always use non-interactive flags (e.g., `--yes`, `--strict`, etc.).
3. **No assumptions on DB changes:** Always generate Drizzle migrations explicitly before applying them.
4. **Code Quality:** Ensure all code adheres to ESLint/Prettier standards. Tests (Vitest/Jest) are expected for critical modules like Identity and Auth.
