import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { seed } from "./seed";
import { organizeAllByDate } from "./organize";

// dev HMR에서 커넥션이 중복 생성되지 않도록 globalThis에 보관
const globalForDb = globalThis as unknown as { __veritasDb?: Database.Database };

function open(): Database.Database {
  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "veritas.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "db", "schema.sql"),
    "utf-8"
  );
  db.exec(schema);

  // 경량 마이그레이션: 기존 DB에 새 컬럼 추가 (이미 있으면 무시)
  // NOTE: ALTER TABLE ADD COLUMN에는 CHECK 제약을 붙일 수 없다. 새 DB는
  // schema.sql의 제약을 갖고, 기존 DB는 DAL이 origin 값을 통제한다.
  for (const sql of [
    "ALTER TABLE event ADD COLUMN ai_subtitle TEXT",
    "ALTER TABLE rel_claim_link ADD COLUMN origin TEXT DEFAULT 'manual'",
    "ALTER TABLE rel_claim_link ADD COLUMN note TEXT",
    "ALTER TABLE rel_claim_link ADD COLUMN dimension TEXT",
    "ALTER TABLE rel_claim_link ADD COLUMN confidence REAL",
    "ALTER TABLE rel_claim_link ADD COLUMN analyzed_at TEXT",
  ]) {
    try {
      db.exec(sql);
    } catch {
      /* column already exists */
    }
  }

  const count = db.prepare("SELECT COUNT(*) AS n FROM newsroom").get() as {
    n: number;
  };
  if (count.n === 0) seed(db);

  // 페이지 = 날짜. 기존/가져온 데이터도 열 때마다 날짜 페이지로 정규화된다(멱등).
  // 중복 날짜를 먼저 합친 뒤에야 유니크 인덱스를 걸 수 있다.
  organizeAllByDate(db);
  try {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_event_day
       ON event(newsroom_id, substr(occurred_at, 1, 10))
       WHERE occurred_at IS NOT NULL`
    );
  } catch (err) {
    console.error("could not enforce one-page-per-day uniqueness", err);
  }
  return db;
}

export function getDb(): Database.Database {
  if (!globalForDb.__veritasDb) globalForDb.__veritasDb = open();
  return globalForDb.__veritasDb;
}

export function uid(): string {
  return crypto.randomUUID();
}

export function audit(
  newsroomId: string,
  actor: string | null,
  action: string,
  targetTable: string,
  targetId: string,
  diff?: unknown
) {
  getDb()
    .prepare(
      `INSERT INTO audit_log (newsroom_id, actor, action, target_table, target_id, diff)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(newsroomId, actor, action, targetTable, targetId, diff ? JSON.stringify(diff) : null);
}
