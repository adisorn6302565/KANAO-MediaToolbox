//! ฐานข้อมูล SQLite: ประวัติงาน, key-value, log
use crate::error::AppResult;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub struct Db {
    pub conn: Connection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub input: String,
    pub output: String,
    pub status: String,
    pub size_before: i64,
    pub size_after: i64,
    pub message: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogItem {
    pub id: i64,
    pub level: String,
    pub source: String,
    pub message: String,
    pub created_at: String,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS history(
                id TEXT PRIMARY KEY, kind TEXT, title TEXT, input TEXT, output TEXT,
                status TEXT, size_before INTEGER, size_after INTEGER, message TEXT,
                created_at TEXT);
             CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at);
             CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT);
             CREATE TABLE IF NOT EXISTS logs(
                id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT, source TEXT,
                message TEXT, created_at TEXT);",
        )?;
        Ok(Self { conn })
    }

    pub fn add_history(&self, h: &HistoryItem) -> AppResult<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO history VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                h.id,
                h.kind,
                h.title,
                h.input,
                h.output,
                h.status,
                h.size_before,
                h.size_after,
                h.message,
                h.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_history(&self, limit: i64) -> AppResult<Vec<HistoryItem>> {
        let mut st = self.conn.prepare(
            "SELECT id,kind,title,input,output,status,size_before,size_after,message,created_at
             FROM history ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = st.query_map([limit], |r| {
            Ok(HistoryItem {
                id: r.get(0)?,
                kind: r.get(1)?,
                title: r.get(2)?,
                input: r.get(3)?,
                output: r.get(4)?,
                status: r.get(5)?,
                size_before: r.get(6)?,
                size_after: r.get(7)?,
                message: r.get(8)?,
                created_at: r.get(9)?,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn delete_history(&self, ids: &[String]) -> AppResult<()> {
        for id in ids {
            self.conn.execute("DELETE FROM history WHERE id=?1", [id])?;
        }
        Ok(())
    }

    pub fn clear_history(&self) -> AppResult<()> {
        self.conn.execute("DELETE FROM history", [])?;
        Ok(())
    }

    pub fn kv_get(&self, key: &str) -> AppResult<Option<String>> {
        let mut st = self.conn.prepare("SELECT value FROM kv WHERE key=?1")?;
        let mut rows = st.query([key])?;
        Ok(match rows.next()? {
            Some(r) => Some(r.get(0)?),
            None => None,
        })
    }

    pub fn kv_set(&self, key: &str, value: &str) -> AppResult<()> {
        self.conn
            .execute("INSERT OR REPLACE INTO kv VALUES(?1,?2)", params![key, value])?;
        Ok(())
    }

    pub fn log(&self, level: &str, source: &str, message: &str) {
        let _ = self.conn.execute(
            "INSERT INTO logs(level,source,message,created_at) VALUES(?1,?2,?3,?4)",
            params![level, source, message, chrono::Local::now().to_rfc3339()],
        );
        // เก็บ log ไว้ไม่เกิน 5,000 แถว
        let _ = self.conn.execute(
            "DELETE FROM logs WHERE id <= (SELECT MAX(id) - 5000 FROM logs)",
            [],
        );
    }

    pub fn list_logs(&self, limit: i64) -> AppResult<Vec<LogItem>> {
        let mut st = self.conn.prepare(
            "SELECT id,level,source,message,created_at FROM logs ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = st.query_map([limit], |r| {
            Ok(LogItem {
                id: r.get(0)?,
                level: r.get(1)?,
                source: r.get(2)?,
                message: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn clear_logs(&self) -> AppResult<()> {
        self.conn.execute("DELETE FROM logs", [])?;
        Ok(())
    }
}
