/**
 * Electron 主进程
 * - 生产：由内嵌后端同源提供 out/（Next static export），加载 http://127.0.0.1:<port>/
 * - 开发：加载 CINE_DEV_URL（如 http://localhost:3000，由 pnpm dev 提供）
 * - IPC：store:load / store:save 桥接 SQLite 持久化
 */

import fs from "node:fs"
import path from "node:path"
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import { initDb, loadStateJson, saveStateJson } from "./db"

// 本地后端服务（Express + SQLite）：认证、状态存储与静态导出同源服务
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { startServer, DEFAULT_PORT } = require("../server") as {
  startServer: (opts: {
    port?: number
    dbPath?: string
    staticDir?: string
    onReady?: (port: number) => void
    onError?: (err: NodeJS.ErrnoException) => void
  }) => { close: () => void }
  DEFAULT_PORT: number
}

let backendServer: { close: () => void } | undefined
/** 内嵌后端实际监听端口；null = 未起来（端口被占或初始化失败） */
let apiPort: number | null = null
/** apiPort 为 null 时的原因，用于给出对症的提示（数据库不可用已在后端降级处理，不在此列） */
let backendFailure: "listen" | "init" | null = null

// 主进程异常兜底：输出到 stderr 与日志文件（排障用）
process.on("uncaughtException", (err) => {
  console.error("[main] uncaughtException:", err)
  try {
    fs.writeFileSync(path.join(process.env.HOME ?? ".", ".cine-muse-main.log"), String(err?.stack ?? err))
  } catch {}
})
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", reason)
})

const DEV_URL = process.env.CINE_DEV_URL

const OUT_DIR = path.join(__dirname, "..", "out")
const OUT_INDEX = path.join(OUT_DIR, "index.html")

// 窗口/任务栏图标：与 web 端共用同一 logo（打包后位于 out/，开发环境可能尚未构建）
const WINDOW_ICON = path.join(OUT_DIR, "cine-muse-logo.png")

/**
 * 渲染层加载策略（仅生产）。
 *
 * 首选**同源 http**：由内嵌后端把 out/ 作为站点提供，页面 origin 即 API origin。这样
 * `/models/ue-mannequin-retopology.glb` 与 `/_next/*` 这些**根绝对路径**按 http 语义解析到
 * 服务根，UE4 角色能真正加载；`file://` 下它们会解析成 `file:///models/...` 而 404，角色
 * 静默回退程序化人偶（见 previs-ue4-parity-design.md 的「桌面资产 URL 已知问题」）。
 *
 * 产物缺失时仍走 loadFile，交给既有 did-fail-load 弹窗提示「先执行构建」。
 *
 * 产物在、但内嵌后端没起来（端口被占最常见）时不退回 loadFile：导出的资源引用是根绝对
 * 路径，file:// 下 `/…` 会解析成 `file:///…`，渲染出来是一片白 —— 与其如此，不如直说原因。
 */
function loadRenderer(win: BrowserWindow): void {
  if (DEV_URL) return void win.loadURL(DEV_URL)
  if (!fs.existsSync(OUT_INDEX)) return void win.loadFile(OUT_INDEX)
  if (apiPort == null) {
    dialog.showErrorBox(
      "Cine Muse 无法启动本地服务",
      backendFailure === "init"
        ? "本地服务初始化失败，详情见主进程日志。"
        : `端口 ${DEFAULT_PORT} 已被占用，界面与数据服务都需要它。\n\n` +
            `常见原因：另一个 Cine Muse 服务或桌面实例正在运行。\n请关闭后重试。`,
    )
    app.quit()
    return
  }
  void win.loadURL(`http://127.0.0.1:${apiPort}/`)
}

/** 启动内嵌后端并等到**绑定结果确定**为止（app.listen 是异步绑定，不 await 会与加载竞态）。
 *  返回监听端口；端口被占或初始化失败返回 null。 */
function startBackend(): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      backendServer = startServer({
        dbPath: path.join(app.getPath("userData"), "cine-muse.db"),
        staticDir: fs.existsSync(OUT_INDEX) ? OUT_DIR : undefined,
        onReady: (port: number) => resolve(port),
        onError: () => {
          backendFailure = "listen"
          resolve(null)
        },
      })
    } catch (err) {
      // 数据库不可用由后端自行降级（静态站点照常提供，渲染层回退 localStorage），
      // 这里只兜住真正起不来的情形
      console.error("[main] local backend failed:", err)
      backendFailure = "init"
      resolve(null)
    }
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "Cine Muse",
    backgroundColor: "#0a0a0a",
    icon: fs.existsSync(WINDOW_ICON) ? WINDOW_ICON : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 外部链接走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url)
    return { action: "deny" }
  })

  loadRenderer(win)

  // 渲染加载失败 / 渲染进程异常：弹出可操作提示而非白屏无响应
  win.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error("[main] did-fail-load:", code, desc)
    dialog.showErrorBox(
      "Cine Muse 加载失败",
      `渲染页面未能加载（${code}: ${desc}）。\n\n请确认已执行 pnpm build（静态产物 out/）或开发服务器（pnpm dev）正在运行。`,
    )
  })
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[main] render-process-gone:", details.reason)
    dialog.showErrorBox("Cine Muse 渲染进程异常退出", `原因：${details.reason}`)
  })
}

// 单实例锁：双开会同时抢 47832 端口（EADDRINUSE）并双写同一 SQLite
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  // 已有实例时聚焦其窗口
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    try {
      initDb()
    } catch (err) {
      // 数据库不可用（磁盘损坏/权限）：仍启动窗口，渲染层以种子数据运行且不会回写覆盖
      console.error("[main] initDb failed:", err)
    }

    // 内嵌启动本地后端服务（与主进程同生命周期，渲染层经 HTTP 访问）。
    // 等绑定结果确定后再开窗：loadRenderer 需要知道实际端口才能加载同源站点。
    apiPort = await startBackend()

    ipcMain.handle("store:load", () => loadStateJson())
    ipcMain.handle("store:save", (_event, json: string) => {
      // SQLite 不可用或写入失败时如实上报，渲染层回退本地持久化
      return { ok: saveStateJson(json) }
    })
    ipcMain.on("store:flush-sync", (event, json: string) => {
      event.returnValue = { ok: saveStateJson(json) }
    })

    createWindow()

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  // 退出前先停后端：给渲染层最后一次 keepalive flush（PUT /api/state）留出完成窗口
  let quitting = false
  app.on("before-quit", (e) => {
    if (quitting) return
    quitting = true
    e.preventDefault()
    setTimeout(() => {
      backendServer?.close()
      app.quit()
    }, 300)
  })
}
