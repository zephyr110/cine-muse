/**
 * Electron 主进程
 * - 生产：加载 out/index.html（Next static export）
 * - 开发：加载 CINE_DEV_URL（如 http://localhost:3000，由 pnpm dev 提供）
 * - IPC：store:load / store:save 桥接 SQLite 持久化
 */

import fs from "node:fs"
import path from "node:path"
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import { initDb, loadStateJson, saveStateJson } from "./db"

// 本地后端服务（Express + SQLite）：认证与状态存储服务端化
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { startServer } = require("../server") as {
  startServer: (opts: { port?: number; dbPath?: string }) => { close: () => void }
}

let backendServer: { close: () => void } | undefined

// 主进程异常兜底：输出到 stderr 与日志文件（排障用）
process.on("uncaughtException", (err) => {
  console.error("[main] uncaughtException:", err)
  try {
    fs.writeFileSync(path.join(process.env.HOME ?? ".", ".cine-studio-main.log"), String(err?.stack ?? err))
  } catch {}
})
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", reason)
})

const DEV_URL = process.env.CINE_DEV_URL

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "Cine Studio",
    backgroundColor: "#0a0a0a",
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

  if (DEV_URL) {
    void win.loadURL(DEV_URL)
  } else {
    void win.loadFile(path.join(__dirname, "../out/index.html"))
  }

  // 渲染加载失败 / 渲染进程异常：弹出可操作提示而非白屏无响应
  win.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error("[main] did-fail-load:", code, desc)
    dialog.showErrorBox(
      "Cine Studio 加载失败",
      `渲染页面未能加载（${code}: ${desc}）。\n\n请确认已执行 pnpm build（静态产物 out/）或开发服务器（pnpm dev）正在运行。`,
    )
  })
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[main] render-process-gone:", details.reason)
    dialog.showErrorBox("Cine Studio 渲染进程异常退出", `原因：${details.reason}`)
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

  app.whenReady().then(() => {
    try {
      initDb()
    } catch (err) {
      // 数据库不可用（磁盘损坏/权限）：仍启动窗口，渲染层以种子数据运行且不会回写覆盖
      console.error("[main] initDb failed:", err)
    }

    // 内嵌启动本地后端服务（与主进程同生命周期，渲染层经 HTTP 访问）
    try {
      backendServer = startServer({ dbPath: path.join(app.getPath("userData"), "cine-studio.db") })
    } catch (err) {
      console.error("[main] local backend failed, renderer falls back to local storage:", err)
    }

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
