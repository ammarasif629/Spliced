# Investigative Journalism Platform — Production Architecture

> Code name: **Spliced** (working title)
> Design philosophy: *"Testimony is evidence, not truth. Truth emerges through corroboration, relationships, and temporal context."*
> This document covers all 15 deliverables and incorporates three core redesigns (§0) throughout.

---

## 0. Core Design Principles and Three Redesigns (Non-negotiable)

The original specification contained three design choices that would make the service impossible in the EU and contradict the platform philosophy. These are replaced as follows.

### 0.1 Principle: Evaluate the "claim", not the person, and do not store any scores in the database
- **Scores are never tied to a person’s identity.** There is no trust-score column on people, sources, testimonies, or relationships.
- **There are no stored scores or weights in the database (no stored score).** Corroboration coverage (the proportion of core claims that have been cross-verified by independent sources) is not stored; it is derived at read time from corroboration links via a `COUNT` aggregation (cacheable, not authoritative). If a testimony is rejected, its links are excluded and the value naturally changes on the next read — there is no logic that recalculates and rewrites a stored number.
- Quantitative dimensions that cannot be meaningfully measured, such as coherence, conflict, or expertise, are not summed into a single number; they are shown as separate badges or annotations. (No blended 0–100 single score = no false precision)

### 0.2 Principle: AI assists, but does not judge
- AI is responsible only for **extraction, normalization, consistency flags, and summarization**. It does not automatically collect personal data or determine credibility.
- All AI outputs require **evidence (citations)**. If no evidence is available, it returns "insufficient evidence".

### 0.3 Principle: The knowledge graph is fully isolated per newsroom (single shared database removed)
- The model of "the entire platform contributing to a single shared database" is discarded. Collaboration occurs **only within a newsroom**, and each newsroom has its own isolated knowledge graph. There are no shared entity pools, global graphs, or cross-newsroom edges.
- Entity normalization and deduplication also occur **only within the newsroom scope** (`UNIQUE (newsroom_id, …)`). Even the same real person will be represented as different records in newsroom A and newsroom B.
- Enforcement mechanisms include RLS on all tenant tables, logical separation of Neo4j by newsroom (multi-DB or label partitioning), RBAC, full-event audit logging, and GDPR data-subject rights (access, rectification, deletion).
- Sensitive categories (GDPR Art. 9) and criminal-history data (Art. 10) are **disabled by default** and can only be entered after legal-basis gating.

The redesign below is not optional; it is the definitive design applied throughout this document.

| Original spec (discarded) | Problem | Applied design |
|---|---|---|
| Automated AI background research on people | GDPR Art. 9/10, automated profiling | Journalist input with citation attachment. AI only summarizes and flags. |
| Storing person trust scores (0–50) in the database | Defamation, false precision | **No score columns in the DB.** Coverage is a read-time derived value. |
| Single shared database / crowd-sourced person scoring | Targeting, blacklist abuse | **Single shared DB removed.** Newsroom-isolated graph + provenance + audit + correction. |

---

## 1. Software Architecture (Entire System)

```
                          ┌─────────────────────────────────────┐
                          │            CLIENT (Web)              │
                          │  Next.js 15 (App Router) + React 19  │
                          │  TS · Tailwind · R3F/Three.js        │
                          │  TanStack Query · Zustand            │
                          └───────────────┬─────────────────────┘
                                          │ HTTPS / WSS
                          ┌───────────────▼─────────────────────┐
                          │        API Gateway (BFF)             │
                          │  Next.js Route Handlers + Edge auth  │
                          │  rate-limit · CSRF · session         │
                          └───────────────┬─────────────────────┘
                                          │ REST + WebSocket
          ┌───────────────────────────────┼───────────────────────────────┐
          │                               │                               │
┌─────────▼─────────┐         ┌───────────▼──────────┐        ┌───────────▼──────────┐
│  Core API         │         │  Analysis Service    │        │  Realtime/Collab      │
│  FastAPI (Python) │◄───────►│  FastAPI + Celery     │        │  WS hub (Redis PubSub)│
│  CRUD · auth ·    │  task   │  LLM pipeline         │        │  graph live-sync      │
│  graph queries    │  queue  │  entity resolution    │        │  presence             │
└───┬────────┬──────┘         └───────┬───────────────┘        └───────────────────────┘
    │        │                        │
    │        │                        │ embeddings / RAG
┌───▼──┐  ┌──▼──────┐          ┌───────▼────────┐   ┌──────────────┐   ┌──────────────┐
│ Neo4j│  │Postgres │          │ pgvector       │   │ Object Store │   │ LLM Providers│
│ graph│  │+ audit  │          │ (semantic)     │   │ (S3: evidence│   │ OpenAI/Claude│
│      │  │+ tenancy│          │                │   │  docs, files)│   │ /Gemini      │
└──────┘  └─────────┘          └────────────────┘   └──────────────┘   └──────────────┘
```

**Why split the services**
- **Core API (synchronous, low latency):** CRUD, graph queries, authentication. This is the hot path for user interaction.
- **Analysis Service (asynchronous, Celery worker):** LLM pipelines and entity resolution take seconds, so they are isolated behind a queue. Failures, retries, and cost tracking are isolated here.
- **Realtime hub:** Live synchronization of collaborative graph editing. Neo4j changes are broadcast via Redis PubSub.
- **Dual storage:** Relationship traversal and path queries go to Neo4j, while normalized records, audit data, and tenancy go to Postgres. **Postgres is the source of truth**, and Neo4j is a graph projection synchronized through CDC.

---

## 2. Relational Schema (PostgreSQL) — `schema.sql`

Postgres is the source of truth. All records are tenant-isolated and provenance-aware.

```sql
-- ===== Tenancy & Users =====
CREATE TABLE newsroom (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE app_user (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newsroom_id   UUID NOT NULL REFERENCES newsroom(id),
  email         CITEXT UNIQUE NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','editor','journalist','viewer')),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ===== Core Entities (normalized, deduplicated) =====
CREATE TABLE entity_person (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newsroom_id   UUID NOT NULL REFERENCES newsroom(id),
  display_name  TEXT NOT NULL,
  aliases       TEXT[] DEFAULT '{}',
  is_confidential BOOLEAN DEFAULT false,   -- Protect sources: true means excluded from graph projection
  created_by    UUID REFERENCES app_user(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (newsroom_id, display_name)
);
CREATE TABLE entity_org      (LIKE entity_person INCLUDING ALL);
CREATE TABLE entity_location (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newsroom_id UUID NOT NULL REFERENCES newsroom(id),
  name TEXT NOT NULL, lat DOUBLE PRECISION, lon DOUBLE PRECISION,
  UNIQUE (newsroom_id, name)
);
CREATE TABLE event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newsroom_id UUID NOT NULL REFERENCES newsroom(id),
  title TEXT NOT NULL,
  occurred_at TIMESTAMPTZ,             -- Z-axis coordinate of the time-plane
  occurred_precision TEXT CHECK (occurred_precision IN ('exact','day','month','year','approx')),
  location_id UUID REFERENCES entity_location(id)
);

-- ===== Source: The evidentiary role of a person. No scores. Only citation-backed attributes =====
CREATE TABLE source (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newsroom_id   UUID NOT NULL REFERENCES newsroom(id),
  person_id     UUID REFERENCES entity_person(id),
  org_id        UUID REFERENCES entity_org(id),
  role          TEXT,                  -- witness / official / insider / document-holder ...
  created_at    TIMESTAMPTZ DEFAULT now(),
  CHECK (person_id IS NOT NULL OR org_id IS NOT NULL)
);

-- Facts about a source must always have an author and a source of evidence (no automatic scraping)
CREATE TABLE source_attribute (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     UUID NOT NULL REFERENCES source(id),
  category      TEXT NOT NULL,         -- proximity / conflict_of_interest / expertise / prior_record ...
  statement     TEXT NOT NULL,         -- "Our reporting confirmed in 2019 that the agency employed this person"
  citation_url  TEXT,                  -- Evidence link (strongly recommended)
  citation_note TEXT,
  is_allegation BOOLEAN DEFAULT true,  -- Fact vs claim label (defamation protection)
  entered_by    UUID NOT NULL REFERENCES app_user(id),
  verified_by   UUID REFERENCES app_user(id),  -- Editor verification signature
  restricted    BOOLEAN DEFAULT false, -- If Art.9/10 data, true and legal_basis required
  legal_basis   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ===== Testimony / Claim / Evidence =====
CREATE TABLE testimony (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newsroom_id   UUID NOT NULL REFERENCES newsroom(id),
  source_id     UUID NOT NULL REFERENCES source(id),
  raw_text      TEXT NOT NULL,
  given_at      TIMESTAMPTZ,           -- The time referenced by the testimony (for time-plane placement)
  ai_title      TEXT,                  -- §7 AI summary
  ai_summary    TEXT,
  ai_detail     TEXT,
  status        TEXT DEFAULT 'active' CHECK (status IN ('active','rejected')),  -- conflict resolution
  entered_by    UUID NOT NULL REFERENCES app_user(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Atomic claims extracted from testimony (the unit for cross-verification)
CREATE TABLE claim (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  testimony_id  UUID NOT NULL REFERENCES testimony(id),
  text          TEXT NOT NULL,         -- "The suspect bought 1/10 of a gallon of gasoline"
  subject_id    UUID,                  -- related person/org
  event_id      UUID REFERENCES event(id),
  asserted_time TIMESTAMPTZ,
  coherence_flag TEXT[],               -- ['chronological_impossible','self_contradiction'] etc. (AI + human confirmed)
  status        TEXT DEFAULT 'active'
);

CREATE TABLE evidence (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newsroom_id   UUID NOT NULL REFERENCES newsroom(id),
  kind          TEXT,                  -- document / photo / recording / record ...
  storage_url   TEXT,                  -- S3 (encrypted)
  provenance    TEXT,                  -- Source and acquisition context
  entered_by    UUID NOT NULL REFERENCES app_user(id)
);

-- ===== Relationships (the authoritative graph) — no numeric weights. Strength is expressed through kind =====
CREATE TABLE rel_claim_link (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newsroom_id UUID NOT NULL REFERENCES newsroom(id),   -- Newsroom isolation
  from_claim  UUID NOT NULL REFERENCES claim(id),
  to_claim    UUID REFERENCES claim(id),
  evidence_id UUID REFERENCES evidence(id),
  kind        TEXT NOT NULL CHECK (kind IN
              ('supports','contradicts','direct_evidence','weak_assoc','inference')),
  -- ⚠ weight column removed: 'No storage of scores or weights' (§0.1). Only the existence of a link and its kind are stored.
  created_by  UUID REFERENCES app_user(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ===== Article (final output) =====
CREATE TABLE article (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newsroom_id UUID NOT NULL REFERENCES newsroom(id),
  title TEXT, body TEXT,
  accepted_chain JSONB,               -- Snapshot of the accepted testimony chain
  status TEXT DEFAULT 'draft'
);

-- ===== Audit & GDPR =====
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  newsroom_id UUID, actor UUID,
  action TEXT, target_table TEXT, target_id UUID,
  diff JSONB, at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE rectification_request (   -- Data-subject correction/deletion request
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_ref TEXT, request_type TEXT CHECK (request_type IN ('access','rectify','erase')),
  status TEXT DEFAULT 'open', received_at TIMESTAMPTZ DEFAULT now()
);

-- Isolate the newsroom via Row-Level Security — there is no global shared graph, and every read is scoped to the current newsroom
ALTER TABLE testimony ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON testimony
  USING (newsroom_id = current_setting('app.current_newsroom')::uuid);
-- The same policy applies to entity_person/entity_org/event/source/claim/evidence/rel_claim_link/article
-- Since there are no stored score columns, there is nothing to recompute or correct for scores — coverage is derived at read time
```

---

## 3. Graph Schema (Neo4j) — `graph_schema.cypher`

Projected from Postgres through CDC. **Logically isolated per newsroom** (multi-DB or `:Nr_{id}` label partitioning with a `newsroomId` property on every node and edge), and no cross-newsroom edges or global graphs are created. Every query forces a `newsroomId` filter. `is_confidential` sources and `restricted` attributes are **not placed in the graph** (source protection and legal-risk separation).

```cypher
// Node labels
// (:Person {id, name})  (:Organization)  (:Location {id,name,lat,lon})
// (:Event {id,title,occurredAt,precision})   <- Z-axis of the time-plane
// (:Testimony {id,title,summary,status,givenAt})
// (:Claim {id,text,assertedTime,status,coherenceFlags})
// (:Evidence {id,kind})  (:Article {id,title})  (:Source {id,role})

// Constraints (prevent duplicates)
CREATE CONSTRAINT person_id  IF NOT EXISTS FOR (p:Person)    REQUIRE p.id IS UNIQUE;
CREATE CONSTRAINT claim_id   IF NOT EXISTS FOR (c:Claim)     REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT event_id   IF NOT EXISTS FOR (e:Event)     REQUIRE e.id IS UNIQUE;

// Edge types (line color mapping)
//  Claim -[:SUPPORTS   ]-> Claim     ← blue   (no weight property)
//  Claim -[:CONTRADICTS]-> Claim     ← red    (strength expressed only by edge type)
//  Claim -[:CORROBORATED_BY]-> Evidence         ← green (direct evidence)
//  Claim -[:WEAK_ASSOC]-> Claim                 ← orange
//  Claim -[:INFERRED_FROM]-> Claim              ← purple (derived inference)
//  Source -[:CLAIMS]-> Testimony -[:CONTAINS]-> Claim
//  Person -[:PARTICIPATED_IN]-> Event
//  Claim  -[:AT_EVENT]-> Event -[:LOCATED_AT]-> Location
//  Testimony -[:MENTIONS]-> (Person|Org|Location)
//  Article -[:REFERENCES]-> Claim

// Example: time-plane query — cards and relationships within one event (plane)
MATCH (e:Event {id:$eventId})<-[:AT_EVENT]-(c:Claim {status:'active'})
OPTIONAL MATCH (c)-[r:SUPPORTS|CONTRADICTS|WEAK_ASSOC|INFERRED_FROM]-(c2:Claim)
              WHERE (c2)-[:AT_EVENT]->(e)          // same plane relationship
RETURN c, r, c2;

// Example: cross-time relationships — lines that span the Z-axis
MATCH (c1:Claim)-[r:SUPPORTS|CONTRADICTS]-(c2:Claim)
MATCH (c1)-[:AT_EVENT]->(e1:Event), (c2)-[:AT_EVENT]->(e2:Event)
WHERE e1.occurredAt <> e2.occurredAt
RETURN c1, r, c2, e1.occurredAt AS z1, e2.occurredAt AS z2;
```

---

## 4. API Specification (Core Endpoints)

REST (Core API, FastAPI) + WebSocket (collaboration). All calls use `Authorization: Bearer`, and the tenant is injected from the session.

```
# --- Entities ---
POST   /entities/persons            Create (return existing record + match candidates on duplicate)
GET    /entities/search?q=&type=    Entity search (normalization helper)

# --- Testimony ---
POST   /testimonies                 Submit raw text → 202 + task_id (async analysis queue)
GET    /testimonies/{id}            Retrieve analysis results
PATCH  /testimonies/{id}/reject     Reject testimony → trigger relationship recomputation
PATCH  /testimonies/{id}/restore

# --- Source (not scored, contextual) ---
GET    /sources/{id}/context        Source context panel
POST   /sources/{id}/attributes     Journalist input (source required) — requires legal_basis if restricted

# --- Assessment (statement-level) — not stored in DB, derived at read time ---
GET    /testimonies/{id}/assessment Corroboration coverage (derived via read-time COUNT) + badges + evidence
POST   /claims/{id}/links           Connect supports/contradicts/evidence
GET    /claims/{id}/conflicts       List conflicts

# --- Time Graph ---
GET    /graph/planes                List events (= planes) + Z coordinates
GET    /graph/plane/{eventId}       Cards and relationships inside a plane (2D view)
GET    /graph/full                  Entire 3D graph (including cross-plane relationships)
GET    /graph/accepted-chain        Reconstruct the narrative using only status=active

# --- Analysis (AI assistance, human-triggered) ---
POST   /analysis/extract            Raw text → claim/entity/temporal extraction
POST   /analysis/consistency        Consistency flags against stored evidence and testimonies
POST   /analysis/research-leads     ⚠️ Human-triggered only. Returns unverified source-link candidates.
                                    Do not auto-record them as person records or score them.

# --- Search ---
GET    /search/semantic?q=          pgvector embedding search
                                    "All relevant items from John in Jan–Mar" → hybrid filter + vector search

# --- GDPR ---
POST   /gdpr/requests               Submit access/rectify/erase requests

# --- WebSocket ---
WS     /ws/graph/{caseId}           Live graph editing sync (presence, node/edge deltas)
```

Example response for `GET /testimonies/{id}/assessment` — **not a stored score in the DB** (derived at request time from corroboration links). No person score exists; coverage is shown alongside separate badges:
```json
{
  "testimony_id": "…",
  "corroboration_coverage": 0.6,           // 3 of 5 core claims are cross-verified = 60%
  "claim_breakdown": [
    {"claim":"Gasoline purchase (1/10)","status":"corroborated","supporting_evidence":2,"contradicting":0},
    {"claim":"Solo perpetrator","status":"contested","supporting_evidence":1,"contradicting":2}
  ],
  "coherence_badges": ["chronologically_consistent"],
  "source_context": [                        // cited, editorial, not numeric
    {"category":"proximity","statement":"Claim of having witnessed the scene","citation_url":"…","is_allegation":true}
  ],
  "conflicts": [{"with_testimony":"…","claim":"Solo perpetrator","type":"contradicts"}],
  "disclaimer":"editorial estimate — coverage is the proportion of cross-verified claims, not a truth judgment"
}
```

---

## 5. Frontend Component Hierarchy

```
<AppShell>
├─ <TopBar>  (case selector, search, presence avatars)
├─ <SidebarNav>  (Graph · Testimonies · Sources · Article · Search)
└─ <WorkspaceRouter>
   ├─ <GraphView>                         ← signature view
   │  ├─ <ViewModeToggle 2D|3D />
   │  ├─ <TimePlaneCanvas>                (R3F <Canvas>)
   │  │  ├─ <CameraRig>  (OrbitControls, 2D↔3D transition animation)
   │  │  ├─ <Plane>  × N                  (one event = one translucent plane)
   │  │  │  └─ <TestimonyCard3D>  × M     (cards on the plane, billboard)
   │  │  └─ <ConnectionLines>             (edge colors: blue/red/green/orange/purple)
   │  ├─ <PlaneInspector>                 (selected plane details in 2D)
   │  └─ <ConflictPanel>                  (reject/restore, recomputation view)
   ├─ <TestimonyDetail>
   │  ├─ <RawTextPane>  <AiSummaryPane>
   │  ├─ <ClaimBreakdown>  (coverage bar, claim-by-claim status)
   │  └─ <SourceContextPanel>  (cited attributes, fact vs claim labels)
   ├─ <SourceContextPanel>  (reused)
   ├─ <SemanticSearch>
   └─ <ArticleComposer>  (accepted-chain → draft)
```

State management: server state via **TanStack Query**, graph camera/selection via **Zustand**, and live collaboration via WS deltas merged into the query cache.

---

## 6. UI Wireframes (ASCII)

**(A) 3D Time-Graph — signature view**
```
┌───────────────────────────────────────────────── SPLICED ──────┐
│ [2D] [3D]   🔍search           👥●●     Case: "Warehouse Fire"        │
├──────────────────────────────────────────────────────────────────────┤
│                                                    ▲ Z (time →)       │
│            ╱───────────────────╲                                       │
│           ╱   Dec 27 (plane)    ╲   ┌──────┐                          │
│          ╱   ┌──────┐            ╲  │explos│  ← card                   │
│         ╱    │card A│───red────┐  ╲ │ives  │                          │
│        ╱     └──────┘          │   ╲└──────┘                          │
│       ╱────────────────────────┼────╲                                  │
│      ╱   Jan 10 (plane)        │     ╲                                 │
│     ╱    ┌──────┐   blue   ┌───▼──┐   ╲    blue=support red=contradict│
│    ╱     │gasoli│──────────│card C│    ╲   green=evidence orange=weak assoc│
│   ╱      │ne    │          └──────┘     ╲  purple=inference            │
│  ╱       └──────┘                        ╲                             │
│ └──────────────────────────────────────────┘  (plane=Event, XY=relationships within a plane)│
│                                                                        │
│ [ Rotate ⟳ ]  [ Zoom +/- ]  [ Isolate plane ]  [ Show full graph ]    │
└──────────────────────────────────────────────────────────────────────┘
```

**(B) Testimony Card (2D detail)**
```
┌─ "Two weeks ago he bought explosives" ───────────── [Reject] ─┐
│ Source: Witness #3 (witness)                                  │
│ ▓▓▓▓▓▓░░░░  Coverage 60% (3/5 claims cross-verified)         │  ← not a person score
│ ──────────────────────────────────────────────────── │
│ ✔ chronologically consistent   ⚠ 2 contradictions   │  ← separate badges
│ Evidence: 2   Supports: 1   Conflicts: 2                      │
│ 📄 Summary: (AI) The witness claims the purchase occurred two weeks before the incident… │
│ [Source Context ▾]  3 evidence links · fact 1 / claim 2        │
└──────────────────────────────────────────────────────────────┘
```

**(C) Source Context Panel — no score**
```
┌─ Source: Kim OO (witness) ─────────────────────────────┐
│ ⚠ This panel is editorial context, not a trust score   │
│ • proximity   Claim of having witnessed the scene  [claim]  🔗 evidence │
│ • conflict    Confirmed business relationship with the defendant [fact]  🔗 court ruling │
│ • expertise   Claimed 15 years of relevant experience [claim]  🔗 interview │
│ [+ add attribute (source required)]   Verification: Editor Lee OO │
└──────────────────────────────────────────────────────┘
```

---

## 7. User Flow

1. A journalist creates a case → pastes the testimony text into `POST /testimonies` → receives 202 immediately.
2. The Analysis Service performs **extraction** (claims/entities/time) → **entity resolution** (match existing nodes; ask the user if ambiguous) → **consistency flags** → **summary**. It pushes "analysis complete" over WS.
3. If the testimony points to another event (for example, "two weeks ago"), a new Event (plane) is created automatically and linked by an edge. A new plane is added along the Z axis.
4. The journalist connects and edits supports/contradicts/evidence lines between cards in the 3D graph.
5. Coverage and conflicts are recalculated in real time and reflected on the cards.
6. After review, an untrustworthy testimony is **rejected** → it is gray-out and its outgoing relationships are excluded from the "accepted narrative"; all indicators are recomputed.
7. The `accepted-chain` is organized into a coherent narrative → drafted in `ArticleComposer` → reviewed and signed by an editor → published.

---

## 8. Scoring / Assessment Algorithm — `analysis/assessment.py`

**The single blended score is discarded. No score is stored in the database.** The function below calculates coverage from corroboration links at **read time** and returns it without writing any values to tables. The quantitative backbone is a single corroboration coverage metric, while everything else is shown separately.

```python
# analysis/assessment.py
from dataclasses import dataclass

@dataclass
class ClaimStatus:
    supporting: int      # Number of independent sources/evidence supporting the claim
    contradicting: int
    has_direct_evidence: bool

def classify_claim(cs: ClaimStatus) -> str:
    if cs.contradicting >= 2 and cs.supporting == 0:
        return "refuted"
    if cs.has_direct_evidence or cs.supporting >= 2:
        return "corroborated"
    if cs.contradicting >= 1:
        return "contested"
    return "uncorroborated"

def testimony_assessment(claims: list[ClaimStatus], coherence_flags: list[str]) -> dict:
    statuses = [classify_claim(c) for c in claims]
    n = len(statuses) or 1
    corroborated = sum(s == "corroborated" for s in statuses)

    # ★ The only numeric signal: cross-verification ratio (definable and defensible)
    coverage = corroborated / n

    # Non-quantifiable dimensions are shown as badges rather than aggregated into a number
    badges = []
    if "chronological_impossible" in coherence_flags:
        badges.append("⚠ chronological_impossibility")  # Hard flag: warns regardless of coverage
    if "self_contradiction" in coherence_flags:
        badges.append("⚠ self_contradiction")
    if not coherence_flags:
        badges.append("✔ internally_coherent")

    return {
        "corroboration_coverage": round(coverage, 2),
        "claim_statuses": statuses,       # Always transparent on a claim-by-claim basis
        "coherence_badges": badges,
        "disclaimer": "coverage = proportion of cross-verified claims. Not a truth or credibility score.",
    }
```

**Design rationale**
- `coverage` is a verifiable fact: "what percentage of key claims has been confirmed by independent sources?" It does not use arbitrary constants like "prior fraud −10".
- Temporal or geographic impossibility is not folded into coverage; it is shown as a hard badge (even a highly covered claim can still be flagged as impossible).
- Source context is not quantified → this avoids defamation and profiling risks.
- Coverage is not stored, so there is no target to recompute and rewrite. When a testimony is rejected, only its links are excluded by status and the next read naturally shows a different coverage value.

---

## 9. LLM Prompting Pipeline — `analysis/pipeline.py`

**RAG-based, citation-required, and no automatic person judgment.** Five stages, with a modular provider abstraction.

```python
# analysis/llm/provider.py  ── Common interface for all providers
class LLMProvider(Protocol):
    async def complete(self, system: str, user: str, schema: dict | None) -> dict: ...
# OpenAIProvider / ClaudeProvider / GeminiProvider implementations. Routing is handled through config.
```

| Stage | Input | Output (JSON) | Guardrails |
|---|---|---|---|
| 1. Extract | Raw testimony | claims[], entities[], temporal_refs[], locations[] | Deterministic parsing; do not generate claims not present in the source text |
| 2. Resolve | Extracted entities + pgvector candidates | Existing node match or "new" | If ambiguous, require human confirmation (no automatic merges) |
| 3. Consistency | claims + **stored evidence/testimony in the system** (RAG) | flags[]{claim_id, type, cited_conflict_id} | Every flag must cite a specific item in the system. No judgment on person disposition |
| 4. Summarize | Raw testimony | {title, summary_3line, detail, needs_verification[]} | Use only the source text. No speculation |
| 5. Research-leads (human-triggered) | Journalist-specified search terms | leads[]{claim, source_url, unverified:true} | ⚠ Link candidates only. No automatic recording to a person record or scoring. Explicit "unverified" label |

**Stage 3 prompt skeleton** (consistency — compare claims, not people):
```
SYSTEM: You are an investigative fact-consistency assistant. Determine only whether the following [testimony claims] conflict logically, temporally, or geographically with [evidence/testimony stored in the system]. Do not judge the credibility or disposition of any person. Every judgment must cite the id of the conflicting target. If there is no evidence, return "insufficient_evidence".
USER:  Claims: {claims}
        Stored context (RAG): {retrieved_evidence_and_testimony}
        Return JSON only: {flags:[{claim_id, type, cited_conflict_id, reason}]}
```

**Cross-policy:** Full prompt/output audit logging for reproducibility, PII masking before provider transmission, cost/token tracking per case, and forced "insufficient evidence" on hallucination. **Prompt-injection defense for ingested text/web content** via system-prompt isolation and treating input as data, not instructions.

---

## 10. Folder Structure (Monorepo)

```
spliced/
├─ apps/
│  ├─ web/                     # Next.js frontend
│  │  ├─ app/                  # App Router
│  │  │  ├─ (workspace)/graph/page.tsx
│  │  │  ├─ (workspace)/testimonies/[id]/page.tsx
│  │  │  └─ api/               # BFF route handlers (auth proxy)
│  │  ├─ components/
│  │  │  ├─ graph/TimePlaneCanvas.tsx  Plane.tsx  ConnectionLines.tsx
│  │  │  └─ testimony/ClaimBreakdown.tsx  SourceContextPanel.tsx
│  │  ├─ lib/  (api-client.ts, ws.ts, zustand-store.ts)
│  │  └─ styles/
│  └─ realtime/                # WS hub (Node) — collaboration sync
├─ services/
│  ├─ core_api/                # FastAPI
│  │  ├─ main.py  deps.py
│  │  ├─ routers/ (testimony.py, graph.py, source.py, search.py, gdpr.py)
│  │  ├─ db/ (postgres.py, neo4j.py, projection.py  # CDC sync)
│  │  └─ security/ (rbac.py, tenancy.py, audit.py)
│  └─ analysis/                # FastAPI + Celery
│     ├─ pipeline.py  worker.py
│     ├─ llm/ (provider.py, openai.py, claude.py, gemini.py)
│     ├─ assessment.py         # §8
│     └─ recompute.py          # Recompute accepted-chain/conflict projections when a testimony is rejected (coverage is not stored, so it is not recomputed)
├─ packages/
│  └─ shared-types/            # Shared TS ↔ Pydantic schemas (openapi codegen)
├─ infra/
│  ├─ docker-compose.yml  (postgres+pgvector, neo4j, redis, minio)
│  ├─ migrations/ (alembic)
│  └─ k8s/
└─ docs/architecture.md
```

---

## 11. Production Roadmap

| Phase | Duration | Goal | Exit |
|---|---|---|---|
| **P0 Foundation** | 3 weeks | Schema, tenancy, auth, RLS, CI, entity CRUD | Store entities in an isolated case |
| **P1 Testimony+AI** | 4 weeks | Extraction, resolution, consistency, summary pipeline, coverage calculation | Submit testimony → receive assessment |
| **P2 Graph 2D** | 3 weeks | Claim links, conflicts, rejection, accepted-chain, 2D plane view | Review conflicts and reconstruct narrative |
| **P3 Time-Graph 3D** | 4 weeks | R3F planes/cards/colored lines, 2D↔3D, automatic plane generation | 3D exploration demo |
| **P4 Search+Collab** | 3 weeks | pgvector semantic search, live WS collaboration | Multiple journalists editing simultaneously |
| **P5 Governance** | 3 weeks | GDPR workflow, audit UI, restricted-data gating, publication signing | Compliance-ready |
| **P6 Hardening** | Ongoing | Load/security audits, cost optimization | GA |

---

## 12. Implementation Plan (Initial Sprint Example)

- **Sprint 1:** infra (docker-compose: postgres+pgvector/neo4j/redis/minio) · alembic migrations · JWT+RBAC+RLS · duplicate detection for `POST /entities`.
- **Sprint 2:** Celery + provider abstraction · Stage 1 extraction · Stage 2 resolution (pgvector candidates + person-confirmation UI).
- **Sprint 3:** Stage 3 consistency (RAG) · Stage 4 summary · `assessment.py` · testimony detail UI (ClaimBreakdown).
- **Sprint 4:** Claim-link API · `recompute.py` (reject recomputation) · conflict panel · accepted-chain.
- **Sprint 5:** R3F scaffolding · Plane/Card/Lines · OrbitControls · 2D↔3D camera interpolation · automatic plane generation.

---

## 13. Security Considerations (Journalism-Specific)

**Data protection (Paris = EU, highest priority)**
- **Complete isolation per newsroom** (no global shared graph): RLS on all tenant tables, Neo4j newsroom partitioning, and mandatory read scoping. Cross-newsroom join paths are blocked entirely.
- **No stored scores:** The absence of trust-score or weight columns on people, sources, testimonies, and relationships removes the risk of incorrect score propagation and correction. Coverage is derived at read time.
- RBAC (admin/editor/journalist/viewer) + mutation logging to `audit_log`.
- **GDPR data-subject rights:** Implement access/rectification/deletion workflows via `rectification_request`. On deletion, hard-delete the data across Postgres, Neo4j, pgvector, and S3.
- **Special categories (Art. 9) and criminal-history data (Art. 10):** Disabled by default. To enter them, you must specify `restricted=true`, provide `legal_basis`, and obtain editor approval. They are excluded from graph projections.
- **Journalism exception (Art. 85):** Applies only to actual reporting outputs and varies by member state → must be reviewed by an EU data-protection lawyer before policy finalization. (This document is not legal advice.)

**Source protection (the lifeline of reporting tools)**
- `is_confidential` sources are completely excluded from the graph/shared projections; their identities are stored encrypted, retained minimally, and not logged on the server.
- Ideally, confidential-source identities should be kept in a separate isolated vault with restricted access.

**Defamation defense**
- No automatic person scoring (§0). Every source attribute carries `is_allegation` (fact vs claim label) + citation + `verified_by` (editor signature).
- An editor sign-off gate is required before publication.

**Application security**
- Prompt injection: ingested testimonies/web text are treated as data only, with system-prompt isolation and minimal tool permissions.
- Secrets: LLM keys are kept in a backend vault (never exposed to the frontend), with restricted permissions for OpenAI and similar providers.
- Standards: OWASP (input validation, CSRF, rate limiting), encryption in transit and at rest, and S3 server-side encryption + signed URLs for evidence.

---

## 14. Scalability Considerations

- **Separate read hot path:** Graph reads go to Neo4j read replicas, while CRUD goes to Postgres. Neo4j is a projection (not authoritative) and can be rebuilt.
- **Analysis queue:** Celery + Redis, respecting provider rate limits and automatic retries/backpressure. Token budgets per case are enforced to prevent runaway costs.
- **Embeddings:** pgvector HNSW indexes; if scale grows, Pinecone or a dedicated vector DB can be swapped in without changing the abstraction layer.
- **Graph rendering:** Large cases use plane/card LOD, frustum culling, and instanced meshes (R3F), plus server-side graph pruning (load only the relevant time window).
- **Stateless services** → horizontal scaling; WS uses Redis PubSub for multi-instance fan-out.
- **CDC synchronization:** Postgres → Neo4j uses an outbox pattern with idempotent upserts.

---

## 15. Future Feature Suggestions

- **Versioned narrative (narrative diff):** Visualize how the accepted narrative changes over time when testimonies are rejected or added.
- **Evidence integrity:** Hash-chain and timestamp evidence to audit tampering.
- **Collaborative verification queue:** Editor review workflow + claim-level verification status Kanban.
- **Multilingual testimony:** Preserve the original language and add a translation layer (the original text remains authoritative).
- **Export:** Accepted chain → article draft / timeline graphic / data-journalism embed.
- **Contradiction alerts:** Real-time warnings when a new testimony conflicts with the existing accepted narrative.
- **Stronger in-newsroom collaboration:** Shared editing conflict resolution and role-based approval flows. (Since newsroom isolation is a principle, automatic cross-newsroom sharing is not introduced; explicit export/manual import is required when needed.)
- **Model evaluation harness:** Regression tests for extraction/consistency prompt accuracy (journalistic trustworthiness = reproducibility).

---

### Summary (The three decisions confirmed in this revision)
1. **Full redesign applied:** Automated profiling, person trust scores, and crowd-sourced person databases are discarded and replaced by journalist-entered citations, claim-level evaluation, and newsroom isolation — not an optional approach but the definitive design.
2. **No scores in the database:** There are no score or weight columns on people, sources, testimonies, or relationships (including the removal of `rel_claim_link.weight`). Coverage is not stored; it is a read-time derived value from corroboration links (cacheable, not authoritative).
3. **Isolation per newsroom:** The single shared database is discarded. Each newsroom has its own isolated graph and collaboration occurs only within the newsroom. There are no global graphs or cross-newsroom edges (Postgres RLS + Neo4j partitioning).

Its strong parts — normalized knowledge graph, time-plane 3D graph, conflict resolution, and semantic search — are all retained, and the result satisfies EU serviceability, defamation protection, and card-based UX with derived coverage display.
