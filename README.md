# Spliced

An investigative-journalism workspace and hackathon MVP built around the
TIME-GRAPH concept: a continuous temporal graph where testimonies, sources,
claims, and supporting evidence are visualized, correlated, and explored.

This repository contains a lightweight reference implementation (Next.js + SQLite)
that demonstrates the architecture, core UX patterns, and data flows for a
privacy- and evidence-focused platform for investigative reporting.

Table of contents
- Overview
- Key features (detailed)
- Architecture & file map
- API reference (routes)
- Data model & DB notes
- LLM / AI pipeline
- Development: setup, run, seed, env
- Contributing & roadmap

## Overview

Spliced is designed to help teams collect, relate, and analyze testimony and
evidence without assigning persistent judgment or scores to people or
sources. Instead the system derives corroboration and coverage at read-time
from stored relationships and an operation log for collaborative whiteboards.

Goals
- Support interlocked views for temporal analysis (the TIME-GRAPH) and
   traditional reports.
- Provide collaborative whiteboards attached to time layers with an operation
   log to support offline sync and auditability.
- Use AI as an assistant (extraction, normalization, summarization) — not an
   arbiter or scorer.

## Key features (detailed)

- Graph-first workspace (Time-Graph)
   - Continuous temporal visualization: nodes and claims are positioned on a
      time plane; zoom and camera modes allow 2D/3D analysis and spatial
      reconstruction.
   - Selection model: click, Ctrl+click multi-select, box select, focus-on
      double-click, `F` framing. Selections persist across camera mode toggles.

- Collaborative whiteboards
   - Each time layer can open a floating WhiteboardWindow with drawing tools
      (pen, marker, highlighter), sticky notes, attachments (images, PDF, URLs),
      and undo/redo.
   - Boards are backed by `board_object` and `board_op` tables; ops are appended
      and polled for sync (production would use a WebSocket hub).

- Testimonies and pipeline
   - Testimony submission screen with an async processing pipeline: extraction,
      normalization, and a coverage assessment step (pure functions in
      `lib/assessment.ts`).
   - Actions: accept into the accepted narrative chain, reject, restore.

- Sources & context
   - Source records with attribute and contextual panels. Sources are never
      assigned single-number trust scores; context and cited evidence drive
      derived metrics.

- Panels and helpers
   - SupportPanel, ConflictPanel and StarredPanel provide curated lists from
      the graph, including explicit links to supporting testimonies.
   - LinkCreator helps create evidence and corroboration links between nodes.

- Client architecture and state
   - `lib/client/api.ts` provides a thin client API for the REST routes.
   - `lib/client/store.ts` contains the client store helpers used by pages and
      UI components.

### Time-Graph — deep dive

- Concept
   - The TIME-GRAPH is a continuous temporal canvas where events, testimonies,
      claims, and evidence are positioned along an axis of time (and optionally
      elevated into 3D for spatial reconstruction). Time is the primary organizing
      principle: relationships, corroboration links, and whiteboards are all
      anchored to time layers.

- Visual affordances
   - Layers: time is represented as stacked or continuous layers. Each layer can
      contain multiple nodes (claims/testimonies) and an associated whiteboard.
   - Node glyphs: nodes show brief metadata (timestamp, type, support count).
   - Edges: corroboration links, contradiction markers, and citations are
      visualized as directed or undirected edges with weightless counts (no
      persistent score values).
   - Camera modes: a top-down 2D analysis mode and a free 3D reconstruction
      mode — switching is smooth and preserves selection and context.

- Interaction model
   - Inspect: clicking a node opens a side-panel with full testimony text and
      citations; the panel links to source context.
   - Corroboration discovery: hovering an edge highlights supporting
      testimonies; panels show the count and list of supports with timestamps.
   - Temporal navigation: scrub, zoom, and focus allow analysts to isolate time
      ranges and inspect how corroboration changes over time.

- Use cases
   - Timelining an incident from multiple witness statements and media.
   - Detecting chains of corroboration and gaps where additional evidence is
      needed.

### Conflicting testimonies & conflict resolution

- Detection
   - Conflicts are identified via explicit contradiction links or via
      automated checks in the AI pipeline (e.g., mutually exclusive date ranges
      or locations). Conflicts are flagged but never converted into a single
      numeric "truth" score.

- UI treatment
   - ConflictPanel: shows active conflicts for the selected set — each entry
      explains the contradiction, lists the involved testimonies, and links to
      the relevant source/context panels.
   - Inline flags: testimonies in conflict display a non-assertive flag with an
      explanation and a link to the evidence that triggered it.

- Analyst workflows
   - Annotate: users can add annotations to any testimony explaining the
      perceived conflict and attach evidence or notes on how to reconcile it.
   - Corroborate: create or find supporting testimonies or documents;
      create explicit corroboration links to reduce uncertainty.
   - Accept/Reject: a testimony can be accepted into the accepted narrative
      chain or rejected; these actions update read-time derived views but do not
      delete the original data.

- Auditability
   - Every action (annotate, accept, reject, link) is recorded in the op-log
      with actor and UTC timestamp so downstream reviewers can trace decisions.

### Overall usage — typical user workflows

- Onboarding / quick exploration
   1. Open the graph and use the time scrubber to jump to the incident's
       initial timeframe.
   2. Use box-select to capture candidate testimonies and open the
       SupportPanel to view corroborating items.
   3. Open a whiteboard at a time layer to sketch timelines and pin important
       nodes or media.

- Investigative cycle (collect → correlate → assess → publish)
   - Collect: ingest testimonies via the UI or API; attach raw documents and
      media to source records. The AI pipeline extracts structured fields to help
      normalize entries.
   - Correlate: use LinkCreator and the graph to draw relationships; rely on
      the Time-Graph to visually cluster supporting evidence by time.
   - Assess: examine conflict flags in ConflictPanel, run manual corroboration
      searches, and use the coverage assessment to see how many independent
      supports exist for a claim.
   - Publish / accept: move accepted testimonies into the Accepted Chain for
      narrative export. All actions remain auditable.

- Collaborative investigation
   - Multiple analysts can open whiteboards on overlapping time layers. Ops
      appended to `board_op` let others poll and replay changes for sync.
   - Use sticky notes on whiteboards to assign follow-ups and link evidence to
      claims, ensuring tasks are traceable.

- Evidence production
   - Export the Accepted Chain or selected nodes as a narrative outline, with
      linked testimony excerpts and source attributions.


## Architecture & file map (high level)

- Frontend: Next.js (app router)
   - Pages and UI under `src/app/` (graph, chain, sources, testimonies, boards)
   - Components under `src/components/` give the visualization and panels.

- Backend: Next.js API routes backed by a lightweight DAL
   - API route handlers under `src/app/api/` map closely to DAL functions.

- Database layer: `src/lib/db/`
   - `schema.sql` defines the initial schema (including `board_object` and
      `board_op` for whiteboards).
   - `dal.ts`, `boards.ts` implement newsroom-scoped data access and op logs.
   - `seed.ts` builds the demo dataset ("Warehouse Fire") on first run.

- LLM integration: `src/lib/llm/`
   - Provider pattern with `openai.ts` and `mock.ts`. `pipeline.ts` composes
      the extraction and summarization steps.

Important files (read first)
- `src/lib/db/schema.sql` — DB schema and automatic `CREATE TABLE IF NOT EXISTS`
- `src/lib/db/dal.ts` — DAL functions with newsroom scoping
- `src/components/board/WhiteboardWindow.tsx` — whiteboard UI + ops
- `src/lib/assessment.ts` — coverage/assessment logic
- `src/lib/llm/pipeline.ts` — AI pipeline orchestration

## API reference (routes overview)

This section lists the main API routes and their purpose. See the route files
under `src/app/api/` for implementation details.

- Boards
   - `GET/POST /api/boards` — list/create boards (implicit newsroom scope)
   - `GET/PUT/DELETE /api/boards/[eventId]` — board by event id (`src/app/api/boards/[eventId]/route.ts`)
   - `POST /api/boards/[eventId]/ops` — append board operations (op log)
   - `GET/POST /api/boards/object/[id]` — board object operations (sticky,
      drawing objects)

- Testimonies
   - `GET/POST /api/testimonies` — list/submit testimonies
   - `GET /api/testimonies/[id]` — testimony detail
   - `POST /api/testimonies/[id]/assessment` — run/record assessment pipeline
   - `POST /api/testimonies/[id]/reject` — mark testimony rejected
   - `POST /api/testimonies/[id]/restore` — restore a previously rejected item

- Claims
   - `GET/PUT/DELETE /api/claims/[id]` — manage claim records
   - `GET/POST /api/claims/[id]/links` — list/create corroboration links

- Sources
   - `GET/POST /api/sources` — list/create sources
   - `GET /api/sources/[id]/attributes` — detailed attributes panel
   - `GET /api/sources/[id]/context` — contextual evidence and citations

- Entities
   - `GET /api/entities/search` — typed entity search endpoint used by UI

- Events
   - `GET /api/events/[id]` — event metadata and associated objects

- Graph projections
   - `GET /api/graph/accepted-chain` — narrative chain based on accepted
      testimonies
   - `GET /api/graph/full` — full graph projection used for the canvas

- Newsrooms
   - `GET/POST /api/newsrooms` — create and list newsroom scopes

## Data model & DB notes

- No permanent scoring: the schema purposely omits persistent trust/score
   columns. Derived metrics (coverage, support counts) are computed at read
   time by aggregating links and testimony states.
- Whiteboard operations are append-only records (`board_op`) with actor,
   action type, payload, and UTC timestamp to preserve history and enable
   auditing.
- The demo database is `data/veritas.db` (SQLite). On first run the app will
   create and seed this file using `src/lib/db/seed.ts`.

Migration & simplifications
- This repo is a hackathon MVP: production variants would switch to Postgres
   with RLS, a message queue for background tasks, and WebSockets for live
   collaboration.

## LLM / AI pipeline

- The project treats AI as an assistive component. The pipeline performs:
   - extraction of structured fields from free text,
   - normalization (dates, names, locations),
   - lightweight consistency checks and summarization.
- Providers: the pipeline can use the OpenAI provider (`OPENAI_API_KEY`) or a
   deterministic `mock` provider bundled in `src/lib/llm/mock.ts` for offline
   development and consistent behavior.

## Development

Prerequisites
- Node 18+ recommended
- NPM/Yarn/PNPM (the repo uses standard Node scripts)

Local setup

1. Install dependencies

```bash
cd spliced
npm install
```

2. Environment

Create a `.env.local` in the repo root for optional AI integration and config:

```
# Optional: OpenAI key
OPENAI_API_KEY=sk-...
# Optional: override model
OPENAI_MODEL=gpt-4o-mini
# Optional: set a different SQLite path (defaults to data/veritas.db)
DATABASE_URL=file:./data/veritas.db
```

3. Run the app

```bash
npm run dev
# open http://localhost:3000
```

The first run will create `data/veritas.db` and seed a demo case. To reseed,
stop the server and delete the `data/` folder before restarting.

Build & production

```bash
npm run build
npm run start
```

Testing & linting
- There are no unit tests included in the MVP. Linters/config may be available
   in the repo — run the configured `npm` scripts if present.

## Contributing & roadmap

We welcome contributions focused on privacy, auditability, and responsible AI
use. Possible next steps and priorities:

- Add end-to-end tests for the DAL and API routes.
- Implement WebSocket-based live sync for whiteboards.
- Replace SQLite with Postgres + RLS for newsroom isolation in production.
- Add semantic search (pgvector) for entity and evidence lookups.
- Expand GDPR and rectification workflows.

If you'd like a guided PR to implement any item above, open an issue or a PR
with the proposed change and a brief design note.

## License & Contact

This repository is a hackathon/MVP reference. No license file is included by
default — add one (e.g., MIT) if you plan to reuse the code publicly.