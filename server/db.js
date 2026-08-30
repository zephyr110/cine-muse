/**
 * 服务端 SQLite 层（本地后端服务）
 * - better-sqlite3 直连；实体表：accounts / sessions / kv（AppState 全量）
 * - 密码使用 node:crypto scrypt（内存安全参数）哈希，不存明文
 * - dbPath 由调用方注入：Electron 主进程传 userData，独立运行用默认目录
 */

const path = require("node:path")
const fs = require("node:fs")
const os = require("node:os")
const Database = require("better-sqlite3")

let sqlite = null

function resolveDefaultDbPath() {
  return path.join(os.homedir(), ".cine-studio", "cine-studio.db")
}

function initDb(dbPath = resolveDefaultDbPath()) {
  if (sqlite) return sqlite
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  sqlite = new Database(dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt          TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
  return sqlite
}

/* ---------- kv：AppState 全量 ---------- */

function loadStateJson() {
  if (!sqlite) return null
  const row = sqlite.prepare("SELECT value FROM kv WHERE key = ?").get("app_state")
  return row?.value ?? null
}

function saveStateJson(json) {
  if (!sqlite) return false
  sqlite
    .prepare(
      `INSERT INTO kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run("app_state", json)
}

/* ---------- accounts ---------- */

function findAccount(email) {
  if (!sqlite) return undefined
  return sqlite.prepare("SELECT * FROM accounts WHERE email = ?").get(email)
}

function insertAccount({ id, email, name, passwordHash, salt, createdAt }) {
  if (!sqlite) return
  sqlite
    .prepare(
      `INSERT INTO accounts (id, email, name, password_hash, salt, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, email, name, passwordHash, salt, createdAt)
}

function updatePassword(email, passwordHash, salt) {
  if (!sqlite) return
  sqlite
    .prepare("UPDATE accounts SET password_hash = ?, salt = ? WHERE email = ?")
    .run(passwordHash, salt, email)
}

/* ---------- sessions ---------- */

function createSession(token, email, now) {
  if (!sqlite) return
  sqlite.prepare("INSERT OR REPLACE INTO sessions (token, email, created_at) VALUES (?, ?, ?)").run(token, email, now)
}

function findSession(token) {
  if (!sqlite) return undefined
  return sqlite.prepare("SELECT * FROM sessions WHERE token = ?").get(token)
}

function deleteSession(token) {
  if (!sqlite) return
  sqlite.prepare("DELETE FROM sessions WHERE token = ?").run(token)
}

/** 吊销某账号会话（改密后除当前 token 外全部吊销；重置密码后全部吊销） */
function deleteSessionsByEmail(email, exceptToken) {
  if (!sqlite) return
  if (exceptToken) {
    sqlite.prepare("DELETE FROM sessions WHERE email = ? AND token != ?").run(email, exceptToken)
  } else {
    sqlite.prepare("DELETE FROM sessions WHERE email = ?").run(email)
  }
}

module.exports = {
  initDb,
  loadStateJson,
  saveStateJson,
  findAccount,
  insertAccount,
  updatePassword,
  createSession,
  findSession,
  deleteSession,
  deleteSessionsByEmail,
}
