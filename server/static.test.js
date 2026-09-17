/**
 * 桌面端同源静态站点（#82）。
 *
 * 靶心：桌面生产构建此前走 `win.loadFile(out/index.html)`，页面 origin 是 `file://`。
 * 渲染层里 `UE4_MODEL_URL = "/models/ue-mannequin-retopology.glb"`（previs-ue4-model.ts:39）
 * 是**根绝对路径**，`CINE_RELATIVE_ASSETS=1` 只改写 webpack 产物前缀（next.config.ts:8
 * 的 assetPrefix），改不动运行期字面量 —— 实测 out/index.html 用 `./_next/...` 而 chunk 内
 * 仍是 `/models/...`，file:// 下解析成 `file:///models/...` 加载失败，UE4 角色静默回退
 * 程序化人偶（previs-ue4-parity-design.md「桌面资产 URL 已知问题」）。
 *
 * 修法是把 out/ 交给**已经在内嵌运行的后端**同源提供，渲染层 loadURL(file 同源 http)：
 * 根绝对路径按 http 语义解析到服务根，与 API 同 origin，file:// 那一类问题整体消失。
 *
 * 本文件钉住该服务的对外契约（含 /api 不被静态站点遮蔽、目录式路由、404 回落）。
 */
import { createRequire } from "node:module"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const { startServer } = require("./index.js")

/** 造一个最小静态导出：顶层 index.html、目录式路由 dashboard/index.html、二进制 models/*.glb、404.html */
function makeExport(dir) {
  fs.mkdirSync(path.join(dir, "dashboard"), { recursive: true })
  fs.mkdirSync(path.join(dir, "models"), { recursive: true })
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>root</title>")
  fs.writeFileSync(path.join(dir, "dashboard", "index.html"), "<!doctype html><title>dashboard</title>")
  // 二进制断言用：GLB 里含 0x00，若静态层按文本处理会被截断
  fs.writeFileSync(path.join(dir, "models", "ue-mannequin-retopology.glb"), Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x00, 0x01, 0x02, 0xff]))
  fs.writeFileSync(path.join(dir, "404.html"), "<!doctype html><title>not found</title>")
}

let tmpRoot
let staticDir
let server
let base

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cine-static-test-"))
  staticDir = path.join(tmpRoot, "out")
  fs.mkdirSync(staticDir, { recursive: true })
  makeExport(staticDir)

  const port = await new Promise((resolve) => {
    server = startServer({
      port: 0, // 由内核分配，避免与开发/线上实例抢 47832
      dbPath: path.join(tmpRoot, "test.db"),
      staticDir,
      onReady: resolve,
    })
  })
  base = `http://127.0.0.1:${port}`
})

afterAll(() => {
  server?.close()
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe("同源静态站点", () => {
  it("GET / 返回导出根页", async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("root")
  })

  it("★ GET /models/ue-mannequin-retopology.glb 可取到且字节完整（#82 靶心）", async () => {
    const res = await fetch(`${base}/models/ue-mannequin-retopology.glb`)
    expect(res.status).toBe(200)
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf).toEqual(Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x00, 0x01, 0x02, 0xff]))
  })

  it("目录式路由：/dashboard/ 命中其 index.html", async () => {
    const res = await fetch(`${base}/dashboard/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("dashboard")
  })

  it("目录式路由：/dashboard（无斜杠）重定向到 /dashboard/", async () => {
    const res = await fetch(`${base}/dashboard`, { redirect: "manual" })
    expect([301, 302]).toContain(res.status)
    expect(res.headers.get("location")).toBe("/dashboard/")
  })

  it("★ /api 不被静态站点遮蔽", async () => {
    const res = await fetch(`${base}/api/health`)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it("未命中路径回落到导出的 404 页（状态码仍为 404）", async () => {
    const res = await fetch(`${base}/no-such-page`)
    expect(res.status).toBe(404)
    expect(await res.text()).toContain("not found")
  })
})

describe("不传 staticDir 时保持纯 API 服务", () => {
  let apiOnly
  let apiBase
  let apiTmp

  beforeAll(async () => {
    apiTmp = fs.mkdtempSync(path.join(os.tmpdir(), "cine-apionly-test-"))
    const port = await new Promise((resolve) => {
      apiOnly = startServer({ port: 0, dbPath: path.join(apiTmp, "t.db"), onReady: resolve })
    })
    apiBase = `http://127.0.0.1:${port}`
  })

  afterAll(() => {
    apiOnly?.close()
    if (apiTmp) fs.rmSync(apiTmp, { recursive: true, force: true })
  })

  it("独立运行（node server/index.js）不提供站点", async () => {
    const res = await fetch(`${apiBase}/`)
    expect(res.status).toBe(404)
  })

  it("API 照常可用", async () => {
    const res = await fetch(`${apiBase}/api/health`)
    expect(res.status).toBe(200)
  })
})
