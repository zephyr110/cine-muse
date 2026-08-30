"use client"

/**
 * 极简主题层：替代 next-themes
 * - next-themes 会在组件树中渲染 <script>，触发 React 19 "script tag in component" 警告
 * - 职责：theme（light/dark/system）状态、DOM class 应用、localStorage 持久化、系统主题跟随
 * - resolvedTheme 由 useSyncExternalStore 派生（订阅 prefers-color-scheme），不存冗余 state
 * - 首帧防闪烁脚本由 layout 通过 next/script beforeInteractive 注入（不在 React 组件树内渲染）
 */

import * as React from "react"

export type Theme = "light" | "dark" | "system"

const THEME_KEY = "theme"
const THEME_VALUES: Theme[] = ["light", "dark", "system"]

function readStoredTheme(): Theme {
  try {
    const v = window.localStorage.getItem(THEME_KEY)
    return v && THEME_VALUES.includes(v as Theme) ? (v as Theme) : "system"
  } catch {
    return "system"
  }
}

function subscribeSystemTheme(callback: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)")
  mq.addEventListener("change", callback)
  return () => mq.removeEventListener("change", callback)
}

function getSystemThemeSnapshot(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement
  const resolved = theme === "system" ? getSystemThemeSnapshot() : theme
  root.classList.remove("light", "dark")
  root.classList.add(resolved)
  root.style.colorScheme = resolved
}

const ThemeContext = React.createContext<{
  theme: Theme
  resolvedTheme: "light" | "dark"
  setTheme: (theme: Theme) => void
} | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 初始值只在客户端读取（首帧前脚本已应用 class；水合期间图标由 mounted 门控，组件树不输出主题差异）
  const [theme, setTheme] = React.useState<Theme>(() =>
    typeof window === "undefined" ? "system" : readStoredTheme(),
  )
  const systemTheme = React.useSyncExternalStore(
    subscribeSystemTheme,
    getSystemThemeSnapshot,
    () => "light" as const,
  )
  const resolvedTheme: "light" | "dark" = theme === "system" ? systemTheme : theme

  // 主题变更副作用：应用到 DOM + 持久化（不 setState，不触发额外渲染）
  React.useEffect(() => {
    applyTheme(theme)
    try {
      window.localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* 存储不可用：静默 */
    }
  }, [theme])

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme 必须在 <ThemeProvider> 内使用")
  return ctx
}
