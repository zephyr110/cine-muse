# Cine Studio

> AI-powered video production workbench — from a one-line idea to a finished cut, driven by a team of sub-agents.

Cine Studio is a desktop AI video generation client built with a **Next.js static renderer + Electron shell + local Express/SQLite service**. The core pipeline is a simulated multi-agent engine: a core chain (screenplay → shot list → video → edit) that you can strengthen with optional "boost" sub-agents at specific stages.

[EN](README.md) · [中文](README.zh-CN.md)

## Features

- **Multi-agent pipeline** — core chain plus optional boost sub-agents (script review, style design, scene generation, consistency guard, visual QA) that slot into the flow around their anchor stages.
- **Four intervention modes** (L0–L3) — fully automatic to hands-on: auto, guided, review (human approval at key gates), manual.
- **State-machine engine** — every project walks through queued → executing → (waiting_approval ⇄ iterating) → completed/failed, with gates, retries and checkpoints simulated by a local ticker.
- **Dashboard** — collapsible project blocks (pending / in progress / completed), typed activity timeline with per-event icons, stat cards.
- **Asset library & RAG knowledge base** — characters, scenes, props and style assets; knowledge bases bound to pipeline stages.
- **Settings dialog** — account security (change password) and model services with pluggable adapters (LLM / video / TTS) that can be swapped without touching orchestration.
- **Local-first** — accounts (scrypt-hashed) and app state persist to SQLite on your machine; nothing leaves it.
- **Theming** — light / dark / follow-system.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Next.js static export (renderer)                       │
│  src/app (pages) · src/components · src/lib/store.tsx   │
│  immer-backed global store, persisted on every change   │
└──────────────┬──────────────────────────┬───────────────┘
               │ fetch /api/*             │ window.cineAPI (IPC)
┌──────────────▼────────────┐  ┌──────────▼────────────────┐
│  Local Express service    │  │  Electron main process    │
│  server/ · 127.0.0.1:47832│  │  electron/                │
│  scrypt auth + token      │  │  single-instance lock     │
│  sessions, SQLite (user   │  │  window lifecycle,        │
│  + state kv)              │  │  state flush on quit      │
└───────────────────────────┘  └───────────────────────────┘
```

Three layers, one data contract:

1. **Renderer** — Next.js 16 static export (`CINE_RELATIVE_ASSETS=1`) + React 19 + Base UI (shadcn-style components) + Tailwind v4. UI state lives in an immer-backed store (`src/lib/store.tsx`); every mutation is normalized and persisted.
2. **Local service** — Express on `127.0.0.1:47832` with scrypt password hashing, token sessions and SQLite via better-sqlite3. It owns authentication (`/api/auth/*`) and state storage (`/api/state`).
3. **Electron shell** — main process with a single-instance lock (avoids port conflicts), IPC passthrough and a 300 ms delayed close on quit so the last state flush lands.

### Engine

- `src/lib/engine/reducer.ts` — the state machine: project lifecycle, stage gates/retries/checkpoints, `TICK`-driven simulation, event log (capped at 120, newest-first).
- `src/lib/engine/templates.ts` — stage templates and `BOOST_SLOTS`: boost agents are injected around anchor stages (`after`/`before`) when selected, skipping any agent already in the template.
- `src/lib/engine/seed.ts` — demo seed data (projects, agents, assets, knowledge bases).
- `src/lib/meta.tsx` — single source of truth for per-kind display metadata (project status, intervention mode, event timeline icons).

## Tech Stack

| Layer | Tech |
|---|---|
| UI | Next.js 16 (static export), React 19, Base UI, shadcn components, Tailwind v4, lucide-react, recharts, sonner |
| State | immer, React context + reducer, zod validation |
| Desktop | Electron 43, electron-builder |
| Service | Express, better-sqlite3, scrypt, token sessions |
| Tooling | TypeScript, ESLint, pnpm |

## Getting Started

Requires Node.js 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install

# 1. start the local service (auth + persistence, port 47832)
pnpm dev:server

# 2. start the web renderer
pnpm dev        # → http://localhost:3000
```

Register an account in the app, or use the demo login on the login page. Create a project, pick boost agents, choose an intervention mode and watch the pipeline run.

### Desktop build

```bash
# unpacked app for testing
pnpm build:desktop:dir

# distributable installers via electron-builder
pnpm build:desktop
```

## Project Structure

```
├── src/app/          # pages: /login /register /forgot-password /dashboard /assets /knowledge /agents /projects
├── src/components/   # auth, dashboard, projects, assets, knowledge, agents, settings, ui (shadcn-style)
├── src/lib/          # store, auth client, api client, engine (reducer/templates/seed), meta, theme, types
├── electron/         # main process, preload, db adapter
├── server/           # Express auth + state service (SQLite)
└── docs/             # design docs
```

## License

See [LICENSE](LICENSE).
