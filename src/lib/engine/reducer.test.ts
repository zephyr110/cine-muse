import { describe, expect, it } from "vitest"
import { engineReducer, createInitialState, migrateAppState } from "./reducer"
import { makePrevisShot } from "./previs-types"
import { renderPrevisShot } from "./previs-render"
import type { AppState, Artifact, PrevisShot } from "@/lib/types"

/** 构造含 previs 产物（首镜已渲染三图，rendered=false 时为未渲染空镜头）的项目状态：stages[0] 替换为 previs 环节 */
function stateWithPrevis(rendered = true): AppState {
  const shot = rendered ? renderPrevisShot(makePrevisShot(0)) : makePrevisShot(0)
  // PrevisArtifact.shots 与 Artifact.shots?: number 冲突，工件放入 stage 时按 Artifact 边界收窄
  // （引擎内通过 isPrevisArtifact 运行时判别恢复 previs 语义）
  const artifact = { kind: "previs" as const, title: "t", summary: "", shots: [shot] } as unknown as Artifact
  const base = engineReducer(createInitialState(), { type: "HYDRATE", state: createInitialState() })
  const p = base.projects[0]
  const stg = { ...p.stages[0], agentId: "previs", status: "waiting_approval" as const, artifact }
  return { ...base, projects: [{ ...p, stages: [stg, ...p.stages.slice(1)] }] }
}

/** 测试内按 PrevisShot 边界读取产物（引擎内以 isPrevisArtifact 运行时判别恢复语义） */
const shotsOf = (state: AppState): PrevisShot[] =>
  (state.projects[0].stages[0].artifact as unknown as { shots: PrevisShot[] }).shots

describe("previs reducer", () => {
  it("UPDATE_PREVIS_BLOCKING 更新摆位并重渲染三图", () => {
    const state = stateWithPrevis()
    const p = state.projects[0]
    const stg = p.stages[0]
    const next = engineReducer(state, {
      type: "UPDATE_PREVIS_BLOCKING", projectId: p.id, stageId: stg.id, shotIndex: 0,
      blocking: [{ id: "c1", kind: "character", name: "主角", position: [3, 0, 1], rotationY: 90, scale: 1 }],
    })
    const out = shotsOf(next)[0]
    expect(out.blocking[0].position[0]).toBe(3)
    expect(out.previewSvg).toContain("<svg")
  })

  it("UPDATE_PREVIS_CAMERA 更新机位并重渲染", () => {
    const state = stateWithPrevis()
    const p = state.projects[0]
    const stg = p.stages[0]
    const next = engineReducer(state, {
      type: "UPDATE_PREVIS_CAMERA", projectId: p.id, stageId: stg.id, shotIndex: 0,
      camera: { position: [1, 3, 7], target: [2, 1, 0], fov: 60 },
    })
    const out = shotsOf(next)[0]
    expect(out.camera).toEqual({ position: [1, 3, 7], target: [2, 1, 0], fov: 60 })
    expect(out.previewSvg).toContain("<svg")
  })

  it("RERENDER_PREVIS 对未渲染镜头重新生成三图", () => {
    const state = stateWithPrevis(false) // 未渲染镜头：三图 svg 为空串
    const p = state.projects[0]
    const stg = p.stages[0]
    expect(shotsOf(state)[0].previewSvg).toBe("")
    const next = engineReducer(state, {
      type: "RERENDER_PREVIS", projectId: p.id, stageId: stg.id, now: "2026-09-01T00:00:00.000Z",
    })
    const out = shotsOf(next)[0]
    expect(out.previewSvg).toContain("<svg")
    expect(out.depthSvg).toContain("<svg")
    expect(out.edgeSvg).toContain("<svg")
  })

  it("RERENDER_PREVIS 重渲染后重新评估空间一致性", () => {
    const state = stateWithPrevis()
    const p = state.projects[0]
    const stg = p.stages[0]
    stg.assessment = { score: 1, confidence: 1, feedback: "旧评估（应被重算替换）", metrics: [] }
    const next = engineReducer(state, {
      type: "RERENDER_PREVIS", projectId: p.id, stageId: stg.id, now: "2026-09-01T00:00:00.000Z",
    })
    const assessment = next.projects[0].stages[0].assessment
    expect(assessment).toBeDefined()
    // 新对象身份：评估被重算替换而非保留旧引用
    expect(assessment).not.toBe(stg.assessment)
    expect(typeof assessment?.score).toBe("number")
    expect(assessment?.reviewer).toBe(stg.gateAgentName)
  })
})

describe("migrateAppState", () => {
  it("v1 数据迁移：旧项目无 previs 字段不崩溃", () => {
    const legacy = { version: 1, projects: [{ id: "p1", stages: [{ id: "s1", agentId: "video_gen", references: undefined }] }] }
    const migrated = migrateAppState(legacy)
    expect(Array.isArray(migrated.projects)).toBe(true)
    // 真实 v1 项目不被种子数据覆盖
    expect(migrated.projects[0]?.id).toBe("p1")
    // 缺省字段补默认值：iterations/reviews 为空数组，references 保持可选
    expect(migrated.projects[0]?.stages[0].iterations).toEqual([])
    expect(migrated.projects[0]?.stages[0].reviews).toEqual([])
    expect(migrated.projects[0]?.stages[0].references).toBeUndefined()
  })
})
