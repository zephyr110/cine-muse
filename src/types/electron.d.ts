/**
 * Electron preload 暴露的桥类型（浏览器环境无 cineStore，走 localStorage 回退）
 */
interface Window {
  cineStore?: {
    load(): Promise<string | null>
    save(json: string): Promise<{ ok: boolean }>
    /** 同步落盘（sendSync），用于 beforeunload 退出兜底 */
    flush(json: string): unknown
  }
}
