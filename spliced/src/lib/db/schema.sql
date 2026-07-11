-- Spliced — SQLite schema (architecture doc §2 이식)
-- 원칙(§0.1): 인물·소스·증언·관계 어디에도 신뢰 점수/가중치 컬럼이 없다.
-- coverage는 저장하지 않고 rel_claim_link에서 read-time COUNT로 파생한다.
-- SQLite에는 RLS가 없으므로 뉴스룸 격리(§0.3)는 DAL 계층에서 newsroom_id 스코프를 강제한다.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ===== Tenancy & Users =====
CREATE TABLE IF NOT EXISTS newsroom (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_user (
  id          TEXT PRIMARY KEY,
  newsroom_id TEXT NOT NULL REFERENCES newsroom(id),
  email       TEXT UNIQUE NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','editor','journalist','viewer')),
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ===== Core Entities (뉴스룸 범위 내 정규화·중복 방지) =====
CREATE TABLE IF NOT EXISTS entity_person (
  id          TEXT PRIMARY KEY,
  newsroom_id TEXT NOT NULL REFERENCES newsroom(id),
  display_name TEXT NOT NULL,
  aliases     TEXT DEFAULT '[]',        -- JSON array
  is_confidential INTEGER DEFAULT 0,    -- 취재원 보호: 1이면 그래프 프로젝션 제외
  created_by  TEXT REFERENCES app_user(id),
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE (newsroom_id, display_name)
);

CREATE TABLE IF NOT EXISTS entity_org (
  id          TEXT PRIMARY KEY,
  newsroom_id TEXT NOT NULL REFERENCES newsroom(id),
  display_name TEXT NOT NULL,
  aliases     TEXT DEFAULT '[]',
  created_by  TEXT REFERENCES app_user(id),
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE (newsroom_id, display_name)
);

CREATE TABLE IF NOT EXISTS entity_location (
  id          TEXT PRIMARY KEY,
  newsroom_id TEXT NOT NULL REFERENCES newsroom(id),
  name        TEXT NOT NULL,
  lat REAL, lon REAL,
  UNIQUE (newsroom_id, name)
);

-- event = "page" = 하루. 증언에 입력된 날짜(testimony.given_at)가 페이지를 결정한다.
-- 같은 날짜의 페이지는 뉴스룸당 하나만 존재한다(아래 idx_event_day 유니크 인덱스).
CREATE TABLE IF NOT EXISTS event (
  id          TEXT PRIMARY KEY,
  newsroom_id TEXT NOT NULL REFERENCES newsroom(id),
  title       TEXT NOT NULL,
  ai_subtitle TEXT,                     -- AI-generated day summary (date is the primary label)
  occurred_at TEXT,                     -- time-plane의 Z축 좌표 (ISO8601)
  occurred_precision TEXT CHECK (occurred_precision IN ('exact','day','month','year','approx')),
  location_id TEXT REFERENCES entity_location(id)
);

-- ===== Source: 인물의 "증거상 역할". 점수 없음. citation 첨부 attribute만 =====
CREATE TABLE IF NOT EXISTS source (
  id          TEXT PRIMARY KEY,
  newsroom_id TEXT NOT NULL REFERENCES newsroom(id),
  person_id   TEXT REFERENCES entity_person(id),
  org_id      TEXT REFERENCES entity_org(id),
  role        TEXT,                     -- witness / official / insider / document-holder ...
  created_at  TEXT DEFAULT (datetime('now')),
  CHECK (person_id IS NOT NULL OR org_id IS NOT NULL)
);

-- source에 대한 사실은 반드시 출처와 입력자를 가진다 (자동 스크래핑 금지, §0.2)
CREATE TABLE IF NOT EXISTS source_attribute (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES source(id),
  category    TEXT NOT NULL,            -- proximity / conflict_of_interest / expertise / prior_record ...
  statement   TEXT NOT NULL,
  citation_url TEXT,
  citation_note TEXT,
  is_allegation INTEGER DEFAULT 1,      -- 사실(0) vs 주장(1) 라벨 (명예훼손 방어)
  entered_by  TEXT NOT NULL REFERENCES app_user(id),
  verified_by TEXT REFERENCES app_user(id),
  restricted  INTEGER DEFAULT 0,        -- GDPR Art.9/10이면 1 + legal_basis 필수
  legal_basis TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ===== Testimony / Claim / Evidence =====
CREATE TABLE IF NOT EXISTS testimony (
  id          TEXT PRIMARY KEY,
  newsroom_id TEXT NOT NULL REFERENCES newsroom(id),
  source_id   TEXT NOT NULL REFERENCES source(id),
  raw_text    TEXT NOT NULL,
  given_at    TEXT,
  ai_title    TEXT,
  ai_summary  TEXT,
  ai_detail   TEXT,
  analysis_status TEXT DEFAULT 'pending' CHECK (analysis_status IN ('pending','running','done','failed')),
  status      TEXT DEFAULT 'active' CHECK (status IN ('active','rejected')),
  entered_by  TEXT NOT NULL REFERENCES app_user(id),
  created_at  TEXT DEFAULT (datetime('now'))
);

-- 증언에서 추출된 원자적 주장 (교차검증 단위)
CREATE TABLE IF NOT EXISTS claim (
  id          TEXT PRIMARY KEY,
  newsroom_id TEXT NOT NULL REFERENCES newsroom(id),
  testimony_id TEXT NOT NULL REFERENCES testimony(id),
  text        TEXT NOT NULL,
  subject_id  TEXT,
  event_id    TEXT REFERENCES event(id),
  asserted_time TEXT,
  coherence_flags TEXT DEFAULT '[]',    -- JSON array: ['chronological_impossible', ...]
  status      TEXT DEFAULT 'active' CHECK (status IN ('active','rejected'))
);

CREATE TABLE IF NOT EXISTS evidence (
  id          TEXT PRIMARY KEY,
  newsroom_id TEXT NOT NULL REFERENCES newsroom(id),
  kind        TEXT,                     -- document / photo / recording / record ...
  title       TEXT,
  storage_url TEXT,
  provenance  TEXT,
  entered_by  TEXT NOT NULL REFERENCES app_user(id)
);

-- ===== 관계 (그래프의 정본) — 숫자 가중치 없음(§0.1). 강도는 kind가 표현 =====
CREATE TABLE IF NOT EXISTS rel_claim_link (
  id          TEXT PRIMARY KEY,
  newsroom_id TEXT NOT NULL REFERENCES newsroom(id),
  from_claim  TEXT NOT NULL REFERENCES claim(id),
  to_claim    TEXT REFERENCES claim(id),
  evidence_id TEXT REFERENCES evidence(id),
  kind        TEXT NOT NULL CHECK (kind IN
              ('supports','contradicts','direct_evidence','weak_assoc','inference')),
  -- 'manual' = 기자가 만든 링크(절대 자동 삭제 금지)
  -- 'ai_conflict' = LLM 충돌 분석이 만든 링크. 재분석 시 해당 범위만 교체된다.
  origin      TEXT DEFAULT 'manual' CHECK (origin IN ('manual','ai_conflict')),
  note        TEXT,                     -- 충돌 근거 (LLM이 인용한 이유). 인물 평가 아님.
  dimension   TEXT,                     -- time / location / event / action / people / object / causality / logic
  confidence  REAL,                     -- 0..1, 진술 간 모순의 확신도(인물 신뢰도가 아니다)
  analyzed_at TEXT,
  created_by  TEXT REFERENCES app_user(id),
  created_at  TEXT DEFAULT (datetime('now'))
);

-- 마지막 LLM 분석 실행의 구조화된 산출물. corpus_key가 같으면 재호출을 건너뛴다(§9 캐시).
CREATE TABLE IF NOT EXISTS analysis_run (
  newsroom_id TEXT PRIMARY KEY REFERENCES newsroom(id),
  corpus_key  TEXT NOT NULL,            -- 활성 주장 텍스트 + 모델의 해시
  model       TEXT,
  provider    TEXT,
  at          TEXT DEFAULT (datetime('now')),
  doc         TEXT                      -- JSON: 렌더링/내보내기용 분석 문서
);

-- ===== Article (최종 산출물) =====
CREATE TABLE IF NOT EXISTS article (
  id          TEXT PRIMARY KEY,
  newsroom_id TEXT NOT NULL REFERENCES newsroom(id),
  title TEXT, body TEXT,
  accepted_chain TEXT,                  -- JSON snapshot
  status TEXT DEFAULT 'draft'
);

-- ===== 감사 & GDPR =====
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  newsroom_id TEXT, actor TEXT,
  action TEXT, target_table TEXT, target_id TEXT,
  diff TEXT, at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rectification_request (
  id          TEXT PRIMARY KEY,
  newsroom_id TEXT NOT NULL REFERENCES newsroom(id),
  subject_ref TEXT,
  request_type TEXT CHECK (request_type IN ('access','rectify','erase')),
  status TEXT DEFAULT 'open',
  received_at TEXT DEFAULT (datetime('now'))
);

-- ===== Collaborative Whiteboards (per time layer / event) =====
CREATE TABLE IF NOT EXISTS board_object (
  id          TEXT PRIMARY KEY,
  newsroom_id TEXT NOT NULL REFERENCES newsroom(id),
  event_id    TEXT NOT NULL REFERENCES event(id),
  kind        TEXT NOT NULL CHECK (kind IN ('note','stroke','attachment','note_link')),
  data        TEXT DEFAULT '{}',        -- JSON: note text / stroke points+tool / attachment type+url / linked ids
  x REAL DEFAULT 0, y REAL DEFAULT 0, w REAL DEFAULT 180, h REAL DEFAULT 120,
  color       TEXT,
  deleted     INTEGER DEFAULT 0,        -- soft delete (undo 지원)
  created_by  TEXT,                     -- collaborator nickname
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- operation history: 모든 보드 액션의 감사/동기화 로그 (actor + timestamp + action)
CREATE TABLE IF NOT EXISTS board_op (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  newsroom_id TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  object_id   TEXT,
  action      TEXT NOT NULL,            -- 'Added Note' / 'Moved Note' / 'Deleted Stroke' / 'Undo' ...
  actor       TEXT NOT NULL,
  at          TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_board_object_event ON board_object(event_id);
CREATE INDEX IF NOT EXISTS idx_board_op_event ON board_op(event_id, seq);

CREATE INDEX IF NOT EXISTS idx_claim_testimony ON claim(testimony_id);
CREATE INDEX IF NOT EXISTS idx_claim_event ON claim(event_id);
CREATE INDEX IF NOT EXISTS idx_link_from ON rel_claim_link(from_claim);
CREATE INDEX IF NOT EXISTS idx_link_to ON rel_claim_link(to_claim);
CREATE INDEX IF NOT EXISTS idx_testimony_newsroom ON testimony(newsroom_id);
