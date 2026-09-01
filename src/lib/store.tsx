"use client"

/**
 * 全局状态层：Context + useReducer
 * - Electron：异步从 SQLite 恢复（cineStore 桥），恢复前先渲染种子骨架
 * - 浏览器：localStorage 同步恢复（开发环境）
 * - 状态变更防抖持久化（Electron → SQLite，浏览器 → localStorage）
 * - tick 定时器驱动模拟引擎推进（hydrated 后才启动）
 * - 事件流增量 → shadcn base toast 通知收口（按 type 渲染语义图标）
 */

import * as React from "react"
import { createContext, useContext, useEffect, useReducer, useRef } from "react"
import {
  CheckCircle2Icon,
  ClapperboardIcon,
  EyeIcon,
  FlagIcon,
  Link2Icon,
  LoaderCircleIcon,
  PenLineIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SkipForwardIcon,
  SlidersHorizontalIcon,
  ThumbsUpIcon,
  TriangleAlertIcon,
  Unlink2Icon,
  XCircleIcon,
} from "lucide-react"
import { toast } from "@/components/ui/toast"

import { createInitialState, engineReducer, LEGACY_STORAGE_KEY, migrateAppState, STORAGE_KEY } from "@/lib/engine/reducer"
import { API_URL, apiJson, clearToken, detectApi, getToken, isApiAvailable } from "@/lib/api"
import type { Action, AppState, EngineEvent, EventKind } from "@/lib/types"

const TICK_INTERVAL_MS = 1400

const AppContext = createContext<{
  state: AppState
  dispatch: React.Dispatch<Action>
  /** localStorage / SQLite 恢复完成（认证守卫依赖） */
  hydrated: boolean
} | null>(null)

const EVENT_TOAST: Partial<
  Record<EventKind, { type: "info" | "success" | "error" | "warning"; icon: React.ReactNode }>
> = {
  project_created: { type: "success", icon: <ClapperboardIcon className="size-4" /> },
  project_started: { type: "info", icon: <PlayIcon className="size-4" /> },
  stage_started: { type: "info", icon: <LoaderCircleIcon className="size-4" /> },
  stage_completed: { type: "success", icon: <CheckCircle2Icon className="size-4" /> },
  gate_passed: { type: "success", icon: <ShieldCheckIcon className="size-4" /> },
  gate_rejected: { type: "warning", icon: <TriangleAlertIcon className="size-4" /> },
  waiting_approval: { type: "warning", icon: <EyeIcon className="size-4" /> },
  approved: { type: "success", icon: <ThumbsUpIcon className="size-4" /> },
  rejected: { type: "warning", icon: <RotateCcwIcon className="size-4" /> },
  skipped: { type: "info", icon: <SkipForwardIcon className="size-4" /> },
  retry: { type: "info", icon: <RefreshCwIcon className="size-4" /> },
  project_completed: { type: "success", icon: <FlagIcon className="size-4" /> },
  project_failed: { type: "error", icon: <XCircleIcon className="size-4" /> },
  mode_changed: { type: "info", icon: <SlidersHorizontalIcon className="size-4" /> },
  asset_bound: { type: "info", icon: <Link2Icon className="size-4" /> },
  asset_unbound: { type: "info", icon: <Unlink2Icon className="size-4" /> },
  artifact_edited: { type: "info", icon: <PenLineIcon className="size-4" /> },
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(engineReducer, undefined, createInitialState)
  // 最新状态快照：退出前同步 flush 用（每次 commit 后同步，beforeunload 前必已最新）
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  // 事件增量锚点：记录上一次已通知的最新事件对象（引用对比，规避计数法在 HYDRATE/封顶时的误差）
  const prevNewestEvent = useRef<EngineEvent | null>(null)
  // 非 Electron 环境（浏览器开发）localStorage 同步恢复，无需异步引导
  const [hydrated, setHydrated] = React.useState(
    () => typeof window === "undefined" || !window.cineStore,
  )
  // SQLite 是否成功恢复：失败时禁止回写，避免种子状态覆盖可能仍可恢复的数据库
  const [loaded, setLoaded] = React.useState(
    () => typeof window === "undefined" || !window.cineStore,
  )
  // 引导完成前的用户操作：排队，HYDRATE 后按序应用
  const pendingActions = useRef<Action[]>([])
  // 恢复后的首次持久化回写跳过：bootstrap 刚读入的内容原样写回零收益
  const skipFirstPersist = useRef(false)

  // 恢复：本地服务优先（GET /api/state），失败回退 SQLite / localStorage
  // （水合后再替换，避免旧状态与 SSR 不一致；放到异步引导中，服务端探测耗时 1.5s 上限）
  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      let raw: string | null = null
      // 原始数据是否来自 localStorage 回退（迁移回写仅对该源执行）
      let fromLocalStorage = false
      let server = false
      try {
        server = await detectApi()
      } catch {
        server = false
      }
      if (cancelled) return
      if (server) {
        try {
          // 3s 超时：server 挂起时不能阻塞整个引导（hydrated 永不置位）
          const res = await fetch(`${API_URL}/api/state`, { signal: AbortSignal.timeout(3000) })
          if (res.status === 200) raw = await res.text()
          // 404 → 服务端首次运行；500/超时 → 视为读取失败
        } catch (err) {
          console.warn("[cine-store] server load failed, falling back to local:", err)
        }
      }
      // 服务端未读到（404/失败/不可用）时一律回退本地存储，避免以种子状态覆盖真实数据
      if (raw == null) {
        // fallback：Electron → SQLite，浏览器 → localStorage
        if (window.cineStore) {
          try {
            raw = await window.cineStore.load()
          } catch (err) {
            console.warn("[cine-store] load failed, keeping seed and skipping persist:", err)
            if (!cancelled) setHydrated(true)
            return
          }
        } else {
          fromLocalStorage = true
          try {
            // v2 新键优先；无新键时回退 v1 旧键（migrateAppState 迁移后统一回写 v2 并移除旧键）
            raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY)
          } catch {
            /* 隐私模式：忽略 */
          }
        }
      }
      if (cancelled) return
      if (raw) {
        try {
          // v1 → v2 迁移：localStorage / SQLite / 服务端旧数据统一经 migrateAppState 兜底补默认值（幂等）
          const migrated = migrateAppState(JSON.parse(raw) as AppState)
          prevNewestEvent.current = null // 恢复的事件不视为"新"事件，避免启动 toast 爆发
          dispatch({ type: "HYDRATE", state: migrated })
          setLoaded(true)
          skipFirstPersist.current = true
          if (fromLocalStorage) {
            // 迁移成功：回写 v2 新键并清除 v1 旧键，避免下次启动重复迁移
            try {
              window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
              window.localStorage.removeItem(LEGACY_STORAGE_KEY)
            } catch {
              /* 存储满/隐私模式：静默 */
            }
          }
        } catch {
          // 数据损坏：保持种子；loaded=false → 持久化 effect 短路，不回写覆盖本可修复的数据
          setLoaded(false)
        }
      }
      setHydrated(true)
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  // 引导完成前的 dispatch 排队，恢复后按序应用（过期项目 ID 在 reducer 内自然空操作）
  const queueDispatch = React.useCallback(
    (action: Action) => {
      if (!hydrated && window.cineStore) {
        pendingActions.current.push(action)
        return
      }
      dispatch(action)
    },
    [hydrated],
  )

  useEffect(() => {
    if (!hydrated) return
    if (pendingActions.current.length > 0) {
      const queued = pendingActions.current
      pendingActions.current = []
      for (const a of queued) dispatch(a)
    }
  }, [hydrated])

  // 持久化：防抖 400ms；本地服务可用 → PUT /api/state，否则回退 SQLite / localStorage
  // in-flight 串行化：连续变更的 PUT 按提交顺序到达服务端，避免旧快照后写覆盖新快照
  const persistChain = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    if (!hydrated || !loaded) return
    if (skipFirstPersist.current) {
      skipFirstPersist.current = false
      return
    }
    const put = async (json: string) => {
      if (await detectApi()) {
        try {
          const res = await fetch(`${API_URL}/api/state`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: json,
          })
          if (res.ok) return
        } catch (err) {
          console.warn("[cine-store] server save failed, falling back to local:", err)
        }
      }
      if (window.cineStore) {
        window.cineStore.save(json).catch((err) => console.warn("[cine-store] save failed:", err))
      } else {
        try {
          window.localStorage.setItem(STORAGE_KEY, json)
        } catch {
          /* 存储满/隐私模式：静默 */
        }
      }
    }
    const id = window.setTimeout(() => {
      const json = JSON.stringify(state)
      persistChain.current = persistChain.current.then(() => put(json)).catch(() => undefined)
    }, 400)
    return () => window.clearTimeout(id)
  }, [state, hydrated, loaded])

  // 退出前落盘（keepalive PUT 或 sendSync：保证最后一次变更不因防抖窗口丢失）
  useEffect(() => {
    const flushLocal = (json: string) => {
      if (window.cineStore) {
        try {
          window.cineStore.flush(json)
        } catch {
          /* 关闭竞态：忽略 */
        }
      } else {
        try {
          window.localStorage.setItem(STORAGE_KEY, json)
        } catch {
          /* 忽略 */
        }
      }
    }
    const flush = () => {
      const json = JSON.stringify(stateRef.current)
      if (isApiAvailable()) {
        // keepalive 请求体有 64KB 上限：超限同步抛错，降级本地同步落盘
        if (json.length > 60_000) {
          flushLocal(json)
          return
        }
        try {
          const sent = fetch(`${API_URL}/api/state`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: json,
            keepalive: true,
          })
          // 异步失败（服务已死）时兜底本地同步落盘，避免最后一次变更丢失
          sent.catch(() => flushLocal(json))
        } catch {
          flushLocal(json)
        }
        return
      }
      flushLocal(json)
    }
    window.addEventListener("beforeunload", flush)
    return () => window.removeEventListener("beforeunload", flush)
  }, [])

  // 幽灵登录防护：本地无 token 时，旧持久化 blob 恢复出的 user 一律清除
  //（登录态只由 token + 服务端会话决定，见下方会话恢复 effect）
  useEffect(() => {
    if (hydrated && !getToken() && state.user) {
      dispatch({ type: "LOGOUT" })
    }
  }, [hydrated, state.user])

  // 会话恢复：本地 token → /api/auth/me 补 user（刷新后保持登录态）
  useEffect(() => {
    if (!hydrated || !isApiAvailable()) return
    const token = getToken()
    if (!token) return
    let cancelled = false
    void (async () => {
      try {
        const me = await apiJson<{ email: string; name: string }>("/api/auth/me")
        // 响应返回前已登出/换号（token 已清或已变）：丢弃迟到响应，防止登出后"复活"登录
        if (cancelled || getToken() !== token) return
        if (!stateRef.current.user) {
          dispatch({ type: "LOGIN", email: me.email, name: me.name })
        }
      } catch (err) {
        if ((err as { status?: number }).status === 401) {
          // 服务端会话已失效：清 token 与本地登录态（避免半登录僵尸态）
          clearToken()
          dispatch({ type: "LOGOUT" })
        }
        /* 网络错误：保持现状 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hydrated])

  // 模拟引擎 tick（SQLite 恢复完成后才启动，避免种子状态空跑）
  useEffect(() => {
    if (!hydrated) return
    const id = window.setInterval(() => {
      dispatch({ type: "TICK", now: new Date().toISOString() })
    }, TICK_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [hydrated])

  // 新事件 → toast 通知（引用锚点：仅通知锚点之后新增的事件；HYDRATE 或封顶导致锚点丢失时只通知最新一条）
  useEffect(() => {
    const evts = state.events
    if (evts.length === 0) return
    if (prevNewestEvent.current == null) {
      // 首次运行 / 恢复后：仅记录锚点，不通知历史事件
      prevNewestEvent.current = evts[0]
      return
    }
    const idx = prevNewestEvent.current ? evts.indexOf(prevNewestEvent.current) : -1
    const fresh = idx === -1 ? [evts[0]] : evts.slice(0, idx)
    prevNewestEvent.current = evts[0]
    for (const ev of fresh.reverse()) {
      const cfg = EVENT_TOAST[ev.kind]
      if (!cfg) continue
      // shadcn base toast 渲染器按 type 驱动语义图标（不再使用自定义 icon）
      toast.add({ title: ev.text, type: cfg.type })
    }
  }, [state.events])

  const contextValue = React.useMemo(
    () => ({ state, dispatch: queueDispatch, hydrated }),
    [state, queueDispatch, hydrated],
  )

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp 必须在 <AppProvider> 内使用")
  return ctx
}

/* ---------- 派生选择器 ---------- */

export function useProjects() {
  const { state } = useApp()
  return state.projects
}

export function useProject(id?: string) {
  const projects = useProjects()
  return projects.find((p) => p.id === id)
}

/** 待人工确认数量（侧边栏徽标） */
export function usePendingApprovals(): number {
  const { state } = useApp()
  return React.useMemo(
    () =>
      state.projects.reduce(
        (acc, p) => acc + p.stages.filter((s) => s.status === "waiting_approval").length,
        0,
      ),
    [state.projects],
  )
}
