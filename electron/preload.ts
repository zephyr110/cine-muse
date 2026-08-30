/**
 * 预加载脚本：以受控 API 暴露 SQLite 持久化桥（contextIsolation 下）
 * window.cineStore = { load(), save(), flush(json) }（flush 为同步落盘，退出前兜底）
 */

import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("cineStore", {
  load: (): Promise<string | null> => ipcRenderer.invoke("store:load"),
  save: (json: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("store:save", json),
  flush: (json: string): unknown => ipcRenderer.sendSync("store:flush-sync", json),
})
