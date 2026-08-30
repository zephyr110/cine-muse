/** 账号表单校验与登出工具（密码哈希与账号存储已服务端化，见 server/index.js） */

import { apiJson, clearToken, getToken } from "@/lib/api"

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/** 密码规则（与服务端 register/reset/change 一致：≥6 位） */
export const PASSWORD_MIN_LEN = 6

/** 校验密码；不合法时返回提示文案（合法返回 null）。前后端规则漂移以服务端为准 */
export function validatePassword(value: string): string | null {
  if (value.length < PASSWORD_MIN_LEN) {
    return `密码至少需要 ${PASSWORD_MIN_LEN} 位`
  }
  return null
}

/** 登出：通知服务端吊销会话并清理本地 token（服务不可用时本地清理兜底） */
export async function logout(): Promise<void> {
  if (getToken()) {
    try {
      await apiJson("/api/auth/logout", { method: "POST" })
    } catch {
      /* 服务不可用：本地清理即可 */
    }
  }
  clearToken()
}
