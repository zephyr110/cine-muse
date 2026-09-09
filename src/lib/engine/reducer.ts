/**
 * 模拟编排引擎 — 纯函数状态机
 * 对应方案 3.2 节点状态机与 3.3 项目状态机。
 * UI 通过 Action 契约驱动（见 types.ts），未来可将 Action 序列化至真实引擎。
 */

import {
  GATE_MAX_RETRIES,
  GATE_PASS_SCORE,
  buildArtifact,
  buildStages,
  gateFeedback,
  simulateAssessment,
  type BoundAsset,
} from "@/lib/engine/templates"
import { produce } from "immer"

import { createSeedState, uid } from "@/lib/engine/seed"
import { isPrevisArtifact } from "@/lib/engine/previs-types"
import { BODY_TYPE_MIGRATION_V2, POSE_ID_MIGRATION_V2, POSE_PRESET_BY_ID } from "@/lib/engine/previs-poses"
import { renderPrevisShot, svgDataUrl } from "@/lib/engine/previs-render"
import { MODE_LABEL } from "@/lib/types"
import type {
  Action,
  AppState,
  BlockingItem,
  EngineEvent,
  PrevisUndoSnapshot,
  Project,
  WorkflowStage,
} from "@/lib/types"

/** 数据形态版本：v3 = 姿势词表换装（8 体型 id / 20 姿势预设 / controls 单值字典）。
 * v2 = BlockingItem 全 3D 变换（rotation 欧拉 / scale 向量 / y 有效） */
export const DATA_VERSION = 3

export const STORAGE_KEY = "cine-muse-state-v2"
export const LEGACY_STORAGE_KEY = "cine-muse-state-v1"

/**
 * 恢复数据规范化：为旧版本存储补齐缺失字段（顶层与项目/节点级）。
 * 引擎内持久化格式的唯一迁移点 —— 新增字段默认值都在这里补。
 * 注意：必须在客户端水合之后才能使用（服务端渲染与客户端首帧必须一致，
 * 否则 localStorage 旧状态会导致 hydration mismatch —— 见 store.tsx 的恢复 effect）。
 */
function normalizeState(s: AppState): AppState {
  const projects = (Array.isArray(s.projects) ? s.projects : []).map((pr) => ({
    ...pr,
    interventionMode: pr.interventionMode ?? ("guided" as const),
    assets: Array.isArray(pr.assets) ? pr.assets : [],
    stages: (Array.isArray(pr.stages) ? pr.stages : []).map((st) => ({
      ...st,
      gateRetries: st.gateRetries ?? 0,
      iterations: Array.isArray(st.iterations) ? st.iterations : [],
      reviews: Array.isArray(st.reviews) ? st.reviews : [],
      progress: st.progress ?? 0,
      isCheckpoint: !!st.isCheckpoint,
    })),
  }))
  // 空壳迁移：早期版本曾持久化全空状态（目录、项目、资产皆空），导致各页面无数据。
  // 检测不到任何用户内容时整体回填种子（保留登录态）；有内容则只做字段级兜底。
  const emptyShell =
    projects.length === 0 &&
    !(Array.isArray(s.assets) && s.assets.length > 0) &&
    !(Array.isArray(s.agents) && s.agents.length > 0)
  if (emptyShell) {
    return { ...createSeedState(), user: s.user ?? null }
  }
  return {
    ...s,
    assets: Array.isArray(s.assets) ? s.assets : [],
    projects,
    events: Array.isArray(s.events) ? s.events : [],
    knowledgeBases: Array.isArray(s.knowledgeBases) ? s.knowledgeBases : [],
    agents: Array.isArray(s.agents) ? s.agents : [],
    models: Array.isArray(s.models) ? s.models : [],
    // 认证服务端化后不再保留本地 accounts（一次性迁移：旧 SHA-256 哈希数据自然丢弃）
    user: s.user ?? null,
  }
}

/** 客户端惰性初始化：固定种子状态（SSR 与首帧一致）。
 * localStorage/SQLite 恢复由 store 的引导 effect 在水合后异步完成并 dispatch HYDRATE。
 * createSeedState 自带 version: DATA_VERSION（reducer.ts:78 委托同一路径）。 */
export function createInitialState(): AppState {
  return createSeedState()
}

/** v1 blocking 项 → v2（旧 rotationY 标量 + scale 标量 → 欧拉/向量），v2 起原样保留 */
function migrateBlockingItemV2(item: Record<string, unknown>): Record<string, unknown> {
  const next = { ...item }
  if (typeof next.rotationY === "number") {
    const r = next.rotationY
    next.rotation = [0, r, 0]
    delete next.rotationY
  }
  if (typeof next.scale === "number") {
    const s = next.scale
    next.scale = [s, s, s]
  }
  return next
}

/** v1 撤销栈中的 blocking 快照 → v2（与产物同规则）：旧栈残留 v1 项会在撤销时污染 v2 镜头 */
function migratePrevisUndoV2(u: AppState["previsUndo"]): AppState["previsUndo"] {
  const conv = (snaps: PrevisUndoSnapshot[]) =>
    snaps.map((sn) => ({
      ...sn,
      shots: sn.shots.map((sh) => ({
        ...sh,
        blocking: sh.blocking.map(
          (b) => migrateBlockingItemV2(b as unknown as Record<string, unknown>) as unknown as BlockingItem,
        ),
      })),
    }))
  return { past: conv(u.past), future: conv(u.future) }
}

/** v2 blocking 项 → v3：体型/姿势 id 按 spec §3.2/§3.3 表换装，controls 由目标新预设重派生。
 * - 体型：命中 BODY_TYPE_MIGRATION_V2 才替换，未知名原样保留（宽容旧数据自定义 id）
 * - 姿势：命中 POSE_ID_MIGRATION_V2 才替换，未知名（或缺失）置 "stand"（v3 默认预设）
 * - controls：整体替换为 `{ ...新预设 controls }`（spec §3.4「微调归并」：v2 自定义微调
 *   不保留，重派生新预设字典）；深拷贝——预设对象是全局共享单例，直接别名进状态会被
 *   后续就地写回污染预设表。v2 旧预设相等性判定按 plan 可省（最终态一致）。
 * - 两张映射表一律 Object.hasOwn 查表：原型键（"constructor"/"toString" 等）不是合法映射项，
 *   必须走「未知名」分支，否则会把 Object.prototype 的函数值写进状态。 */
function migrateBlockingItemV3(item: Record<string, unknown>): Record<string, unknown> {
  const next = { ...item }
  const bodyType = next.bodyType
  if (typeof bodyType === "string" && Object.hasOwn(BODY_TYPE_MIGRATION_V2, bodyType)) {
    next.bodyType = BODY_TYPE_MIGRATION_V2[bodyType]
  }
  const poseId =
    typeof next.poseId === "string" && Object.hasOwn(POSE_ID_MIGRATION_V2, next.poseId)
      ? POSE_ID_MIGRATION_V2[next.poseId]
      : "stand"
  next.poseId = poseId
  next.controls = { ...(POSE_PRESET_BY_ID[poseId]?.controls ?? {}) }
  return next
}

/** v2 撤销栈中的 blocking 快照 → v3（与产物同规则）：旧栈残留 v2 词表项会在撤销时污染 v3 镜头 */
function migratePrevisUndoV3(u: AppState["previsUndo"]): AppState["previsUndo"] {
  const conv = (snaps: PrevisUndoSnapshot[]) =>
    snaps.map((sn) => ({
      ...sn,
      // 与产物迁移同规则的外部数据兜底：损坏快照缺 shots/blocking 时按空数组处理（不抛）
      shots: (sn.shots ?? []).map((sh) => ({
        ...sh,
        blocking: (sh.blocking ?? []).map(
          (b) => migrateBlockingItemV3(b as unknown as Record<string, unknown>) as unknown as BlockingItem,
        ),
      })),
    }))
  return { past: conv(u.past), future: conv(u.future) }
}

/** 版本化迁移：v1 → v2 补字段默认值（references 等）并将 previs blocking 项升为全 3D 形状；
 * v2 → v3 换装 storyai 词表（体型/姿势 id 映射 + controls 由新预设重派生，见 migrateBlockingItemV3）。
 * 逐级串联（v1 数据 v1→v2→v3），产物与 previsUndo 快照同规则。
 * 合并基准为 createInitialState()：旧数据缺顶层字段时回落到种子默认，已有字段原样保留。
 * 幂等 —— 当前版本（DATA_VERSION）数据再次经过本函数结果不变，可在任意持久化源上安全调用。 */
export function migrateAppState(raw: unknown): AppState {
  const s = raw as Partial<AppState> | null
  const version = s?.version ?? 1
  let projects = (s?.projects ?? []).map((p) => ({
    ...p,
    stages: (p.stages ?? []).map((st) => ({
      ...st,
      references: st.references ?? undefined,
      iterations: st.iterations ?? [],
      reviews: st.reviews ?? [],
    })),
  }))
  if (version < 2) {
    projects = projects.map((p) => ({
      ...p,
      stages: (p.stages ?? []).map((st) => {
        const a = st.artifact as { kind?: string; shots?: { blocking?: Record<string, unknown>[] }[] } | undefined
        if (a?.kind === "previs" && Array.isArray(a.shots)) {
          // shots 数组与 Artifact.shots?: number 冲突：仿测试夹具经 unknown 收窄（引擎内以 isPrevisArtifact 运行时判别恢复语义）
          const artifact = { ...a, shots: a.shots.map((sh) => ({ ...sh, blocking: (sh.blocking ?? []).map(migrateBlockingItemV2) })) } as unknown as WorkflowStage["artifact"]
          return { ...st, artifact }
        }
        return st
      }),
    }))
  }
  if (version < 3) {
    projects = projects.map((p) => ({
      ...p,
      stages: (p.stages ?? []).map((st) => {
        const a = st.artifact as { kind?: string; shots?: { blocking?: Record<string, unknown>[] }[] } | undefined
        if (a?.kind === "previs" && Array.isArray(a.shots)) {
          const artifact = { ...a, shots: a.shots.map((sh) => ({ ...sh, blocking: (sh.blocking ?? []).map(migrateBlockingItemV3) })) } as unknown as WorkflowStage["artifact"]
          return { ...st, artifact }
        }
        return st
      }),
    }))
  }
  // v1/v2 栈内含旧形状 blocking 快照：撤销时会直接写回镜头 blocking，须与产物同规则逐级转换
  // （v1 数据两段都跑：先 v1→v2 形状，再 v2→v3 词表）
  const previsUndo =
    s?.previsUndo && version < 3
      ? migratePrevisUndoV3(version < 2 ? migratePrevisUndoV2(s.previsUndo) : s.previsUndo)
      : s?.previsUndo
  return {
    ...createInitialState(),
    ...(s ?? {}),
    version: DATA_VERSION,
    projects,
    ...(previsUndo ? { previsUndo } : {}),
  } as AppState
}

const EVT_CAP = 120

/** 不再流转的节点状态（进度计算与完成判断共用） */
const DONE_STATUSES = ["completed", "approved", "skipped", "failed"] as const
/** 执行中的节点状态 */
const LIVE_STATUSES = ["running", "iterating"] as const

function isDone(status: string): boolean {
  return (DONE_STATUSES as readonly string[]).includes(status)
}

function pushEvent(
  state: AppState,
  project: Project,
  kind: EngineEvent["kind"],
  text: string,
  now: string,
) {
  state.events = [
    { id: uid("evt"), projectId: project.id, projectTitle: project.title, kind, text, at: now },
    ...state.events,
  ].slice(0, EVT_CAP)
}

function eventText(project: Project): string {
  const done = project.stages.filter((s) => isDone(s.status)).length
  return `${project.title} 已完成 ${done}/${project.stages.length} 个环节`
}

/** 重算项目进度、均分与状态 */
function recomputeProject(p: Project, now: string): Project {
  const terminal = p.stages.filter((s) => isDone(s.status)).length
  p.progress = Math.round((terminal / Math.max(1, p.stages.length)) * 100)
  const scores = p.stages
    .map((s) => s.assessment?.score)
    .filter((v): v is number => typeof v === "number")
  p.avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : undefined

  const hasFailure = p.stages.some((s) => s.status === "failed")
  const allDone = p.stages.every((s) => isDone(s.status))
  const anyWaiting = p.stages.some((s) => s.status === "waiting_approval")
  const anyRunning = p.stages.some((s) => (LIVE_STATUSES as readonly string[]).includes(s.status))

  if (hasFailure) p.status = "failed"
  else if (allDone && !anyWaiting) p.status = "completed"
  else if (anyWaiting) p.status = "waiting_approval"
  else if (anyRunning) p.status = "executing"
  // 失败节点已被跳过（降级恢复）：重新回到执行态，让后续 pending 节点继续
  else if (p.status === "failed") p.status = "executing"
  p.updatedAt = now
  return p
}

/** 启动下一个 pending 节点（推进事件统一从这里发出，消除 tick 内重复推送）；返回是否启动 */
function startNextStage(state: AppState, project: Project, now: string): boolean {
  const next = project.stages.find((s) => s.status === "pending")
  if (!next) return false
  // previs 参考附件注入：启动视频生成时，从上游已完成的 previs 产物提取深度/边缘图。
  // approved 同样视为可用 —— review/manual 模式下人工确认节点以「approved」收尾（见 APPROVE_STAGE），
  // 若只认 completed，星尘余晖等 demo 的 previs 附件在人工确认后永远无法注入。
  if (next.agentId === "video_gen") {
    const previsStage = project.stages.find(
      (s) => s.agentId === "previs" && isPrevisArtifact(s.artifact) && ["completed", "approved"].includes(s.status),
    )
    const previs = previsStage?.artifact
    if (previs && isPrevisArtifact(previs)) {
      const first = previs.shots[0]
      // 3D 真实导出优先，2D SVG 兜底
      next.references = [
        {
          kind: "previs",
          depthUrl: first.depthUrl ?? svgDataUrl(first.depthSvg),
          edgeUrl: first.edgeUrl ?? svgDataUrl(first.edgeSvg),
        },
      ]
    }
  }
  next.status = "running"
  next.progress = 0
  next.startedAt = now
  pushEvent(state, project, "stage_started", `「${next.title}」开始执行`, now)
  return true
}

/** 完成一个节点：生成产出与评估，处理门禁/确认/终态 */
function finalizeStage(
  state: AppState,
  project: Project,
  stage: WorkflowStage,
  now: string,
): void {
  const input = {
    title: project.title,
    premise: project.premise,
    genre: project.genre,
    style: project.style,
    durationSec: project.durationSec,
    aspectRatio: project.aspectRatio,
    quality: project.quality,
    template: project.template,
    interventionMode: project.interventionMode,
    assetIds: project.assets.map((b) => b.assetId),
    boostAgentIds: project.boostAgentIds ?? [],
  }
  const iteratingRound = stage.iterations.length
  // 仅保留资产库中仍存在的绑定：悬挂绑定不参与消费与加成（角色归类兜底已无意义）
  const bindings: BoundAsset[] = project.assets.flatMap((b) => {
    const asset = state.assets.find((x) => x.id === b.assetId)
    return asset ? [{ assetId: b.assetId, role: b.role, category: asset.category }] : []
  })
  const assessment = simulateAssessment(stage, now, iteratingRound, bindings)
  assessment.reviewer = stage.gateAgentName
  if (stage.gate) {
    assessment.feedback = `${assessment.feedback}\n${gateFeedback(stage, assessment.score)}`
  }
  stage.assessment = assessment
  stage.artifact = buildArtifact(stage, input, bindings)
  stage.iterations = [
    ...stage.iterations,
    {
      round: stage.iterations.length + 1,
      reason: [...stage.reviews].reverse().find((r) => r.from === "human")?.text,
      assessment,
      at: now,
    },
  ]
  stage.progress = 100

  // 门禁判定：打回即重置进度（否则下一 tick 重复 finalize + 迭代加成，'failed' 分支永不触达）
  if (stage.gate && assessment.score < GATE_PASS_SCORE) {
    stage.gateRetries += 1
    pushEvent(
      state,
      project,
      "gate_rejected",
      `「${stage.title}」未过${stage.gateAgentName}门禁（${assessment.score} 分），第 ${stage.gateRetries} 次打回`,
      now,
    )
    if (stage.gateRetries >= GATE_MAX_RETRIES) {
      stage.status = "failed"
      stage.finishedAt = now
      pushEvent(state, project, "project_failed", `「${stage.title}」连续 ${GATE_MAX_RETRIES} 次未过门禁，项目已暂停，等待人工介入`, now)
    } else {
      stage.status = "iterating"
      stage.progress = 0
      pushEvent(state, project, "retry", `「${stage.title}」进入第 ${stage.gateRetries + 1} 轮迭代重写`, now)
    }
    return
  }

  // 人工确认节点：auto/guided 模式自动通过（不打断），review/manual 暂停等待
  if (stage.isCheckpoint) {
    const autoPass = project.interventionMode === "auto" || project.interventionMode === "guided"
    if (autoPass) {
      stage.status = "completed"
      stage.finishedAt = now
      pushEvent(state, project, "gate_passed", `「${stage.title}」自评通过（${assessment.score} 分），${project.interventionMode === "guided" ? "引导式模式自动确认" : "全自动模式自动确认"}`, now)
      return
    }
    stage.status = "waiting_approval"
    stage.finishedAt = now
    pushEvent(state, project, "waiting_approval", `「${stage.title}」完成自评（${assessment.score} 分），等待人工确认`, now)
    return
  }

  // 正常完成
  stage.status = "completed"
  stage.finishedAt = now
  pushEvent(
    state,
    project,
    stage.gate ? "gate_passed" : "stage_completed",
    stage.gate
      ? `「${stage.title}」通过${stage.gateAgentName}门禁（${assessment.score} 分）`
      : `「${stage.title}」完成（${assessment.score} 分）`,
    now,
  )
}

// 无任何推进时保持 draft 不动：immer 对无修改的 recipe 返回原引用，
// 避免无谓重渲染与每秒级持久化写入（等价于旧版的 original 回传，但契约更简单）
function tick(state: AppState, now: string): void {
  for (const p of state.projects) {
    let projectChanged = false
    for (const s of p.stages) {
      if (s.status !== "running" && s.status !== "iterating") continue
      projectChanged = true
      s.progress = Math.min(100, s.progress + 14 + Math.random() * 18)
      if (s.progress >= 100) {
        finalizeStage(state, p, s, now)
      }
    }
    if (projectChanged) {
      const wasCompleted = p.status === "completed"
      recomputeProject(p, now)
      // 串行推进：仅当无任何运行/迭代节点时才启动下一个 pending 节点，
      // 避免打回重写的节点与后续节点并行执行；等待确认/失败/完成时也不推进
      const anyLive = p.stages.some((s) => (LIVE_STATUSES as readonly string[]).includes(s.status))
      if (p.status === "executing" && !anyLive) startNextStage(state, p, now)
      // 项目完成
      if (p.status === "completed" && !wasCompleted) {
        pushEvent(state, p, "project_completed", eventText(p), now)
      }
    }
  }
}

function createProject(state: AppState, action: Extract<Action, { type: "CREATE_PROJECT" }>): AppState {
  const now = action.now
  const project: Project = {
    id: uid("prj"),
    title: action.input.title || "未命名项目",
    premise: action.input.premise,
    genre: action.input.genre,
    style: action.input.style,
    durationSec: action.input.durationSec,
    aspectRatio: action.input.aspectRatio,
    quality: action.input.quality,
    template: action.input.template,
    interventionMode: action.input.interventionMode ?? "guided",
    assets: (action.input.assetIds ?? []).map((id) => {
      const a = state.assets.find((x) => x.id === id)
      return { assetId: id, role: a?.name ?? id }
    }),
    status: "executing",
    stages: buildStages(action.input),
    boostAgentIds: action.input.boostAgentIds ?? [],
    progress: 0,
    cover: "from-teal-500/20 via-sky-500/10 to-cyan-500/20",
    createdAt: now,
    updatedAt: now,
  }
  pushEvent(state, project, "project_created", `项目「${project.title}」已创建并启动`, now)
  state.projects = [project, ...state.projects]
  startNextStage(state, project, now)
  recomputeProject(project, now)
  return state
}

export function engineReducer(state: AppState, action: Action): AppState {
  // immer produce：draft 内就地修改自动生成不可变新状态（无修改时返回原引用）
  switch (action.type) {
    case "HYDRATE": {
      // 从 SQLite 恢复：规范化 + 旧版本存储字段兜底
      const s = action.state
      if (!s || !Array.isArray(s.projects)) return state
      return normalizeState(s)
    }

    case "CREATE_PROJECT":
      return produce(state, (draft) => {
        createProject(draft, action)
      })

    case "START_PROJECT":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        if (!p || p.status !== "queued") return
        p.status = "executing"
        pushEvent(draft, p, "project_started", `项目「${p.title}」开始执行`, action.now)
        startNextStage(draft, p, action.now)
        recomputeProject(p, action.now)
      })

    case "TICK":
      return produce(state, (draft) => {
        tick(draft, action.now)
      })

    case "APPROVE_STAGE":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        const s = p?.stages.find((x) => x.id === action.stageId)
        if (!p || !s || s.status !== "waiting_approval") return
        s.status = "approved"
        s.finishedAt = action.now
        s.reviews = [...s.reviews, { at: action.now, from: "human", text: "已批准，进入下一环节" }]
        pushEvent(draft, p, "approved", `「${s.title}」已通过人工确认`, action.now)
        if (p.status === "waiting_approval" || p.status === "executing") startNextStage(draft, p, action.now)
        recomputeProject(p, action.now)
        if (p.status === "completed") {
          pushEvent(draft, p, "project_completed", eventText(p), action.now)
        }
      })

    case "REJECT_STAGE":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        const s = p?.stages.find((x) => x.id === action.stageId)
        if (!p || !s || s.status !== "waiting_approval") return
        s.reviews = [...s.reviews, { at: action.now, from: "human", text: action.reason }]
        pushEvent(draft, p, "rejected", `「${s.title}」被人工打回：${action.reason}`, action.now)
        // 打回即重跑：进入下一轮迭代
        s.status = "iterating"
        s.progress = 0
        s.gateRetries = 0
        pushEvent(draft, p, "retry", `「${s.title}」已按反馈进入第 ${s.iterations.length + 1} 轮重写`, action.now)
        recomputeProject(p, action.now)
      })

    case "SKIP_STAGE":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        const s = p?.stages.find((x) => x.id === action.stageId)
        // 允许跳过 failed 节点：失败节点可跳过以恢复流程（UI 提供"降级跳过"入口）
        if (!p || !s || !["pending", "running", "iterating", "waiting_approval", "failed"].includes(s.status)) return
        s.status = "skipped"
        s.finishedAt = action.now
        pushEvent(draft, p, "skipped", `「${s.title}」已跳过（降级处理）`, action.now)
        // 先重算状态：跳过 failed 节点后项目从 failed 恢复为 executing，随后才允许启动后续节点
        recomputeProject(p, action.now)
        if (p.status === "waiting_approval" || p.status === "executing") startNextStage(draft, p, action.now)
        if (p.status === "completed") pushEvent(draft, p, "project_completed", eventText(p), action.now)
      })

    case "TOGGLE_KNOWLEDGE_BASE":
      return produce(state, (draft) => {
        const kb = draft.knowledgeBases.find((x) => x.id === action.kbId)
        if (!kb) return
        kb.enabled = !kb.enabled
        kb.updatedAt = action.now
      })

    case "SELECT_MODEL":
      return produce(state, (draft) => {
        const m = draft.models.find((x) => x.id === action.kind)
        if (!m) return
        m.selected = action.modelId
      })

    case "CREATE_ASSET":
      return produce(state, (draft) => {
        draft.assets = [
          {
            ...action.input,
            id: uid("ast"),
            createdAt: action.now,
            updatedAt: action.now,
          },
          ...draft.assets,
        ]
      })

    case "UPDATE_ASSET":
      return produce(state, (draft) => {
        const a = draft.assets.find((x) => x.id === action.assetId)
        if (!a) return
        Object.assign(a, action.patch, { id: a.id, updatedAt: action.now })
      })

    case "DELETE_ASSET": {
      const referenced = state.projects.some((p) => p.assets.some((b) => b.assetId === action.assetId))
      if (referenced) return state // 被项目引用：拒绝硬删（UI 层已禁用并提示）
      return produce(state, (draft) => {
        draft.assets = draft.assets.filter((a) => a.id !== action.assetId)
      })
    }

    case "BIND_ASSET":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        if (!p) return
        const asset = draft.assets.find((a) => a.id === action.assetId)
        if (!asset || p.assets.some((b) => b.assetId === action.assetId)) return
        p.assets = [...p.assets, { assetId: action.assetId, role: action.role ?? asset.name }]
        p.updatedAt = action.now
        pushEvent(draft, p, "asset_bound", `已绑定资产「${asset.name}」到「${p.title}」`, action.now)
      })

    case "UNBIND_ASSET":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        if (!p) return
        const removed = p.assets.find((b) => b.assetId === action.assetId)
        if (!removed) return
        p.assets = p.assets.filter((b) => b.assetId !== action.assetId)
        p.updatedAt = action.now
        pushEvent(draft, p, "asset_unbound", `已解除资产绑定「${removed.role}」`, action.now)
      })

    case "SET_INTERVENTION_MODE":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        if (!p || p.interventionMode === action.mode) return
        p.interventionMode = action.mode
        p.updatedAt = action.now
        // 切到 auto/guided：挂起中的全部确认节点自动批准并继续推进
        if (action.mode === "auto" || action.mode === "guided") {
          const waiting = p.stages.filter((s) => s.status === "waiting_approval")
          for (const w of waiting) {
            w.status = "approved"
            w.finishedAt = action.now
            w.reviews = [...w.reviews, { at: action.now, from: "engine", text: "干预模式切换为自动确认" }]
            pushEvent(draft, p, "approved", `「${w.title}」已随干预模式切换自动确认`, action.now)
          }
          if (waiting.length > 0) {
            if (p.status === "waiting_approval" || p.status === "executing") startNextStage(draft, p, action.now)
            recomputeProject(p, action.now)
            if (p.status === "completed") pushEvent(draft, p, "project_completed", eventText(p), action.now)
          }
        }
        pushEvent(draft, p, "mode_changed", `「${p.title}」干预模式已切换为 ${MODE_LABEL[action.mode]}`, action.now)
      })

/** 预演撤销快照：仅取纯数据字段（blocking/camera/controls），排除 SVG/位图防膨胀 */
function previsSnapshot(stage: WorkflowStage): PrevisUndoSnapshot | null {
  if (!isPrevisArtifact(stage.artifact)) return null
  return {
    stageId: stage.id,
    shots: stage.artifact.shots.map((s) => ({
      shotIndex: s.shotIndex,
      blocking: s.blocking,
      camera: s.camera,
    })),
  }
}

/** 提交一次编辑：当前状态压入 past（与栈顶相同则跳过），清空 future */
function pushUndo(draft: AppState, snapshot: PrevisUndoSnapshot | null) {
  if (!snapshot) return
  const past = draft.previsUndo.past
  const top = past[past.length - 1]
  if (top && top.stageId === snapshot.stageId && JSON.stringify(top.shots) === JSON.stringify(snapshot.shots)) return
  past.push(snapshot)
  if (past.length > 50) past.shift()
  draft.previsUndo.future = []
}

/** 应用撤销快照到 stage（恢复 blocking/camera 并重渲染 SVG 三图） */
function applyPrevisSnapshot(draft: AppState, stage: WorkflowStage, snapshot: PrevisUndoSnapshot) {
  if (!isPrevisArtifact(stage.artifact)) return
  for (const s of snapshot.shots) {
    const shot = stage.artifact.shots.find((x) => x.shotIndex === s.shotIndex)
    if (!shot) continue
    shot.blocking = s.blocking
    shot.camera = s.camera
    Object.assign(shot, renderPrevisShot(shot))
  }
}

    case "UPDATE_PREVIS_BLOCKING":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        const s = p?.stages.find((x) => x.id === action.stageId)
        if (!p || !s || !isPrevisArtifact(s.artifact)) return
        if (action.commit !== false) pushUndo(draft, previsSnapshot(s))
        const shot = s.artifact.shots[action.shotIndex]
        if (!shot) return
        shot.blocking = action.blocking
        Object.assign(shot, renderPrevisShot(shot))
      })

    case "UPDATE_PREVIS_MAPS":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        const s = p?.stages.find((x) => x.id === action.stageId)
        if (!p || !s || !isPrevisArtifact(s.artifact)) return
        const shot = s.artifact.shots[action.shotIndex]
        if (!shot) return
        shot.previewUrl = action.maps.previewUrl
        shot.depthUrl = action.maps.depthUrl
        shot.edgeUrl = action.maps.edgeUrl
      })

    case "UPDATE_PREVIS_CAMERA":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        const s = p?.stages.find((x) => x.id === action.stageId)
        if (!p || !s || !isPrevisArtifact(s.artifact)) return
        if (action.commit !== false) pushUndo(draft, previsSnapshot(s))
        const shot = s.artifact.shots[action.shotIndex]
        if (!shot) return
        shot.camera = action.camera
        Object.assign(shot, renderPrevisShot(shot))
      })

    case "PREVIS_UNDO":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        const s = p?.stages.find((x) => x.id === action.stageId)
        if (!p || !s) return
        // 先窥视后弹出：跨 stage 的快照不匹配时保留栈顶（撤销按钮按全局栈启用）
        const snap = draft.previsUndo.past[draft.previsUndo.past.length - 1]
        if (!snap || snap.stageId !== s.id) return
        draft.previsUndo.past.pop()
        const current = previsSnapshot(s)
        if (current) draft.previsUndo.future.push(current)
        applyPrevisSnapshot(draft, s, snap)
      })

    case "PREVIS_REDO":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        const s = p?.stages.find((x) => x.id === action.stageId)
        if (!p || !s) return
        const snap = draft.previsUndo.future[draft.previsUndo.future.length - 1]
        if (!snap || snap.stageId !== s.id) return
        draft.previsUndo.future.pop()
        const current = previsSnapshot(s)
        if (current) draft.previsUndo.past.push(current)
        applyPrevisSnapshot(draft, s, snap)
      })

    case "RERENDER_PREVIS":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        const s = p?.stages.find((x) => x.id === action.stageId)
        if (!p || !s || !isPrevisArtifact(s.artifact)) return
        // isPrevisArtifact 收窄为 Artifact & PrevisArtifact（shots 冲突），用 Object.assign 规避属性写入
        const shots = s.artifact.shots.map((shot) => renderPrevisShot(shot))
        Object.assign(s.artifact, { shots })
        // 重新评估空间一致性（spec §6：修改后「重新渲染」= 三图即时更新 + 重新评估）。
        // 与 finalizeStage 同构：以本轮迭代次数 + 现存资产绑定重算评估并重置审查人
        const bindings: BoundAsset[] = p.assets.flatMap((b) => {
          const asset = draft.assets.find((x) => x.id === b.assetId)
          return asset ? [{ assetId: b.assetId, role: b.role, category: asset.category }] : []
        })
        const assessment = simulateAssessment(s, action.now, s.iterations.length, bindings)
        assessment.reviewer = s.gateAgentName
        s.assessment = assessment
      })

    case "EDIT_ARTIFACT":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        const s = p?.stages.find((x) => x.id === action.stageId)
        // 仅手作式（L3）允许改写产出；引擎层强制，不依赖 UI 状态
        if (!p || !s || !s.artifact || p.interventionMode !== "manual") return
        s.artifact = { ...s.artifact, content: action.content }
        s.reviews = [...s.reviews, { at: action.now, from: "human", text: "手动修订了本轮产出" }]
        p.updatedAt = action.now
        pushEvent(draft, p, "artifact_edited", `「${s.title}」产出已手动修订`, action.now)
      })

    case "RESET_DEMO":
      return createSeedState()

    case "LOGIN":
      return produce(state, (draft) => {
        draft.user = { email: action.email, name: action.name }
      })

    case "LOGOUT":
      return produce(state, (draft) => {
        draft.user = null
      })

    default:
      return state
  }
}
