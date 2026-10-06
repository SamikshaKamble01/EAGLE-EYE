"""SQLite persistence layer (standard library only - no extra install needed).

Tables
------
inspections : one row per uploaded job (files, verdict, summary, report paths)
defects     : one row per defect found by the rule engine
"""
import json
import sqlite3
import uuid
from datetime import datetime, timezone

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS inspections (
    id              TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL,
    status          TEXT NOT NULL,            -- processing | completed | failed
    verdict         TEXT,                     -- PASS | FAIL
    score           REAL,
    cabinet_name    TEXT,
    image_path      TEXT,
    pdf_path        TEXT,
    excel_path      TEXT,
    annotated_path  TEXT,
    report_path     TEXT,
    summary_json    TEXT,
    error           TEXT
);

CREATE TABLE IF NOT EXISTS defects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    inspection_id   TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    code            TEXT NOT NULL,
    severity        TEXT NOT NULL,            -- critical | major | minor
    item            TEXT,
    expected        TEXT,
    actual          TEXT,
    message         TEXT
);

-- re-checks: a new photo of the same cabinet after a fix points at the inspection it re-checks
-- (columns parent_id / root_id / round are added by _migrate for databases created earlier)

CREATE INDEX IF NOT EXISTS idx_defects_inspection ON defects(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspections_created ON inspections(created_at);
"""


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        path = current_app.config["DATABASE_PATH"]
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path, detect_types=sqlite3.PARSE_DECLTYPES)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


def close_db(_exc=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db(app):
    app.teardown_appcontext(close_db)
    with app.app_context():
        get_db().executescript(SCHEMA)
        _migrate(get_db())
        get_db().commit()


def _migrate(db: sqlite3.Connection) -> None:
    """Add columns introduced after the first version (keeps existing data)."""
    have = {r["name"] for r in db.execute("PRAGMA table_info(inspections)")}
    for name, ddl in (("parent_id", "TEXT"), ("root_id", "TEXT"), ("round", "INTEGER NOT NULL DEFAULT 1")):
        if name not in have:
            db.execute(f"ALTER TABLE inspections ADD COLUMN {name} {ddl}")
    db.execute("CREATE INDEX IF NOT EXISTS idx_inspections_root ON inspections(root_id)")


# --------------------------------------------------------------------------- #
# Repository helpers
# --------------------------------------------------------------------------- #
def new_id() -> str:
    return uuid.uuid4().hex


def create_inspection(inspection_id: str, cabinet_name: str, paths: dict,
                      parent_id: str | None = None, root_id: str | None = None, round_no: int = 1) -> None:
    db = get_db()
    db.execute(
        """INSERT INTO inspections (id, created_at, status, cabinet_name,
                                    image_path, pdf_path, excel_path, parent_id, root_id, round)
           VALUES (?, ?, 'processing', ?, ?, ?, ?, ?, ?, ?)""",
        (inspection_id, datetime.now(timezone.utc).isoformat(), cabinet_name,
         str(paths["image"]), str(paths["pdf"]), str(paths["excel"]),
         parent_id, root_id or inspection_id, round_no),
    )
    db.commit()


def complete_inspection(inspection_id: str, result: dict, annotated_path, report_path) -> None:
    db = get_db()
    db.execute(
        """UPDATE inspections
              SET status='completed', verdict=?, score=?, summary_json=?,
                  annotated_path=?, report_path=?
            WHERE id=?""",
        (result["verdict"], result["score"], json.dumps(result),
         str(annotated_path) if annotated_path else None,
         str(report_path) if report_path else None, inspection_id),
    )
    db.executemany(
        """INSERT INTO defects (inspection_id, code, severity, item, expected, actual, message)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        [(inspection_id, d["code"], d["severity"], d.get("item"),
          d.get("expected"), d.get("actual"), d.get("message")) for d in result["defects"]],
    )
    db.commit()


def fail_inspection(inspection_id: str, error: str) -> None:
    db = get_db()
    db.execute("UPDATE inspections SET status='failed', error=? WHERE id=?", (error, inspection_id))
    db.commit()


def _row_to_dict(row: sqlite3.Row, include_details: bool) -> dict:
    data = {
        "id": row["id"],
        "created_at": row["created_at"],
        "status": row["status"],
        "verdict": row["verdict"],
        "score": row["score"],
        "cabinet_name": row["cabinet_name"],
        "error": row["error"],
        "parent_id": row["parent_id"],
        "round": row["round"],
    }
    if include_details and row["summary_json"]:
        data["result"] = json.loads(row["summary_json"])
    return data


def get_inspection(inspection_id: str, include_details: bool = True):
    row = get_db().execute("SELECT * FROM inspections WHERE id=?", (inspection_id,)).fetchone()
    return (_row_to_dict(row, include_details), row) if row else (None, None)


def list_inspections(limit: int = 50, offset: int = 0, verdict: str | None = None):
    sql = "SELECT * FROM inspections"
    params: list = []
    if verdict:
        sql += " WHERE verdict=?"
        params.append(verdict.upper())
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params += [limit, offset]
    rows = get_db().execute(sql, params).fetchall()
    total = get_db().execute(
        "SELECT COUNT(*) FROM inspections" + (" WHERE verdict=?" if verdict else ""),
        [verdict.upper()] if verdict else [],
    ).fetchone()[0]
    return [_row_to_dict(r, False) for r in rows], total


def list_chain(inspection_id: str) -> list[dict]:
    """The first inspection of a cabinet and all its re-checks, oldest first."""
    db = get_db()
    row = db.execute("SELECT id, root_id FROM inspections WHERE id=?", (inspection_id,)).fetchone()
    if row is None:
        return []
    root = row["root_id"] or row["id"]
    rows = db.execute("SELECT * FROM inspections WHERE root_id=? OR id=? ORDER BY created_at", (root, root)).fetchall()
    chain = []
    for r in rows:
        item = _row_to_dict(r, False)
        failed = db.execute("SELECT COUNT(*) FROM defects WHERE inspection_id=? AND severity != 'minor'",
                            (r["id"],)).fetchone()[0]
        chain.append({**item, "open_issues": failed})
    return chain


def list_defects(inspection_id: str) -> list[dict]:
    rows = get_db().execute(
        "SELECT code, severity, item, expected, actual, message FROM defects WHERE inspection_id=? ORDER BY id",
        (inspection_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def delete_inspection(inspection_id: str) -> bool:
    db = get_db()
    cur = db.execute("DELETE FROM inspections WHERE id=?", (inspection_id,))
    db.commit()
    return cur.rowcount > 0


def get_stats() -> dict:
    """Numbers for the frontend dashboard."""
    db = get_db()
    row = db.execute(
        """SELECT COUNT(*)                                      AS total,
                  COALESCE(SUM(status = 'completed'), 0)        AS completed,
                  COALESCE(SUM(verdict = 'PASS'), 0)            AS passed,
                  COALESCE(SUM(verdict = 'FAIL'), 0)            AS failed,
                  COALESCE(SUM(status = 'failed'), 0)           AS errored,
                  AVG(score)                                    AS avg_score
             FROM inspections"""
    ).fetchone()
    by_code = db.execute(
        """SELECT d.code, d.severity, COUNT(*) AS count
             FROM defects d JOIN inspections i ON i.id = d.inspection_id
            GROUP BY d.code, d.severity ORDER BY count DESC"""
    ).fetchall()
    by_sev = {r["severity"]: r["count"] for r in db.execute(
        "SELECT severity, COUNT(*) AS count FROM defects GROUP BY severity").fetchall()}
    completed = row["completed"]
    return {
        "total": row["total"],
        "completed": completed,
        "passed": row["passed"],
        "failed": row["failed"],
        "errored": row["errored"],
        "pass_rate": round(100.0 * row["passed"] / completed, 1) if completed else 0.0,
        "avg_score": round(row["avg_score"], 1) if row["avg_score"] is not None else 0.0,
        "defects_by_code": [dict(r) for r in by_code],
        "defects_by_severity": {s: by_sev.get(s, 0) for s in ("critical", "major", "minor")},
    }
