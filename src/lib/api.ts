/**
 * 本地后端服务 API 客户端
 * - 服务地址：NEXT_PUBLIC_CINE_API_URL 覆盖，默认 http://127.0.0.1:47832（Electron 主进程内嵌启动）
 * - 会话：token 存 localStorage，请求自动带 Authorization: Bearer
 * - 服务不可用时调用方回退本地存储（见 store.tsx）
 */

export const API_URL =
  process.env.NEXT_PUBLIC_CINE_API_URL ?? "http://127.0.0.1:47832"

const TOKEN_KEY = "cine-studio-token"

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* 隐私模式：忽略 */
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* 忽略 */
  }
}

/** 带 token 的 JSON 请求；非 2xx 时抛出服务端 error 文案 */
export async function apiJson<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json")
  const token = getToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)
  const res = await fetch(`${API_URL}${path}`, { ...init, headers })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error((body as { error?: string } | null)?.error ?? `请求失败（${res.status}）`)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  return body as T
}

/** 服务可用性探测（TTL 10s 缓存：启动竞速与服务中途崩溃后允许重探） */
const API_PROBE_TTL_MS = 10_000
let apiOkCache: { ok: boolean; at: number } | null = null
export function isApiAvailable(): boolean {
  return apiOkCache?.ok === true
}
export async function detectApi(): Promise<boolean> {
  if (apiOkCache && Date.now() - apiOkCache.at < API_PROBE_TTL_MS) return apiOkCache.ok
  let ok = false
  try {
    const res = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(1500) })
    ok = res.ok
  } catch {
    ok = false
  }
  apiOkCache = { ok, at: Date.now() }
  return ok
}
