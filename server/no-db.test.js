/**
 * 数据库不可用时，HTTP 服务仍须起来（桌面端 loadURL 依赖它）。
 *
 * 靶心：桌面端生产改由内嵌后端同源提供 out/（取代 file://），界面能不能显示**取决于这个
 * 服务能不能 listen**。若 `db.initDb` 失败就把整个 startServer 抛出，界面将无从加载 ——
 * 而既有约定是「数据库不可用也要降级可用、不静默覆盖」（electron/main.ts 的 initDb catch
 * 同此意）。db 层每个访问器本就有 `sqlite === null` 容错，故失败只降级持久化，不降级服务。
 *
 * 单独成文件：db.js 的 sqlite 是**模块级单例**（`if (sqlite) return sqlite`），同一模块图里
 * 首个成功的 initDb 会让后续调用短路 —— 要制造失败就必须是该进程里的第一次 initDb。
 */
import { createRequire } from "node:module"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const { startServer } = require("./index.js")

let tmpRoot
let server
let base

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cine-nodb-test-"))
  // 让 initDb 必失败：把 dbPath 的父目录挂在一个**普通文件**下面（mkdirSync → ENOTDIR）
  const blocker = path.join(tmpRoot, "blocker")
  fs.writeFileSync(blocker, "not a directory")
  const badDbPath = path.join(blocker, "sub", "cine-muse.db")

  const staticDir = path.join(tmpRoot, "out")
  fs.mkdirSync(staticDir, { recursive: true })
  fs.writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>root</title>")

  const port = await new Promise((resolve) => {
    server = startServer({ port: 0, dbPath: badDbPath, staticDir, onReady: resolve })
  })
  base = `http://127.0.0.1:${port}`
})

afterAll(() => {
  server?.close()
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe("数据库不可用时的降级", () => {
  it("★ 服务照常 listen 并提供静态站点（界面起得来）", async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("root")
  })

  it("状态读取降级为 404（渲染层据此回退 localStorage，而非静默覆盖）", async () => {
    const res = await fetch(`${base}/api/state`)
    expect(res.status).toBe(404)
  })

  it("健康检查仍可用", async () => {
    const res = await fetch(`${base}/api/health`)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})
