# HarbourOS — Portability & Zero Lock-In Guide (`docs/PORTABILITY.md`)

## 1. Portable Architecture Overview
HarbourOS is built as a single-deployable modular monolith (`src/shared`, `src/server`, `src/web`) where every external dependency sits behind a typed TypeScript port (`src/server/ports/`):

| Port | Default Adapter (AI Studio / Dev) | Production Adapter | Env Variable |
| :--- | :--- | :--- | :--- |
| `DbPort` | `PGliteAdapter` (`@electric-sql/pglite` WASM Postgres) | Any PostgreSQL 14–16 (`pg` Pool) | `DATABASE_URL` |
| `Auth` | Built-in Mobile OTP + HS256 JWT (`jose`) | Same (zero Auth0/Firebase lock-in) | `JWT_ACCESS_SECRET` |
| `Notify` | Console + `sync.outbox_events` table | Any DLT SMS / WhatsApp gateway | `SMS_PROVIDER`, `WHATSAPP_PROVIDER` |
| `Llm` | Off by default (`LLM_PROVIDER=none`) | Optional Gemini adapter (`adapters/llm-gemini.ts`) | `LLM_PROVIDER`, `GEMINI_API_KEY` |

## 2. Running Locally or on Any VPS / Cloud Run / Fly.io
```bash
# 1. Install and run full verification gate
npm ci
npm run check

# 2. Boot with embedded PGlite PostgreSQL
npm run dev

# 3. Boot with external PostgreSQL 16 via Docker Compose (UNVERIFIED-IN-AI-STUDIO — run locally)
docker compose up --build
```
