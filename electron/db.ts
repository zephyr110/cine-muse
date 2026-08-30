/**
 * SQLite 持久化层（主进程）
 * - better-sqlite3 直连（单表 kv 不值得引入 ORM 查询构建层；建表 DDL 已在下方显式管理）
 * - 当前为单表 kv（整个 AppState 序列化存储），后续可拆实体表
 * - 数据库文件位于 app.getPath("userData")/cine-studio.db
 */

import path from "node:path"
import fs from "node:fs"
import { app } from "electron"
import Database from "better-sqlite3"

const STATE_KEY = "app_state"

let sqlite: Database.Database | null = null

export function initDb(): void {
  if (sqlite) return
  const dbPath = path.join(app.getPath("userData"), "cine-studio.db")
  // userData 目录首次运行不存在，需显式创建（better-sqlite3 不自动建父目录）
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  sqlite = new Database(dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
}

export function loadStateJson(): string | null {
  if (!sqlite) return null
  const row = sqlite.prepare(`SELECT value FROM kv WHERE key = ?`).get(STATE_KEY) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function saveStateJson(json: string): boolean {
  if (!sqlite) return false
  try {
    sqlite
      .prepare(
        `INSERT INTO kv (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(STATE_KEY, json)
    return true
  } catch (err) {
    console.error("[db] saveStateJson failed:", err)
    return false
  }
}
