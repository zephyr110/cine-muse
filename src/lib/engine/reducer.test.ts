import { describe, expect, it } from "vitest"
import { engineReducer, createInitialState } from "./reducer"
import { makePrevisShot } from "./previs-types"
import { renderPrevisShot } from "./previs-render"
import type { AppState, Artifact } from "@/lib/types"

/** 构造含 previs 产物（首镜已渲染三图）的项目状态：stages[0] 替换为 previs 环节 */
function stateWithPrevis(): AppState {
  const shot = renderPrevisShot(makePrevisShot(0))
  // PrevisArtifact.shots 与 Artifact.shots?: number 冲突，工件放入 stage 时按 Artifact 边界收窄
  // （引擎内通过 isPrevisArtifact 运行时判别恢复 previs 语义）
  const artifact = { kind: "previs" as const, title: "t", summary: "", shots: [shot] } as unknown as Artifact
  const base = engineReducer(createInitialState(), { type: "HYDRATE", state: createInitialState() })
  const p = base.projects[0]
  const stg = { ...p.stages[0], agentId: "previs", status: "waiting_approval" as const, artifact }
  return { ...base, projects: [{ ...p, stages: [stg, ...p.stages.slice(1)] }] }
}

describe("previs reducer", () => {
  it("UPDATE_PREVIS_BLOCKING 更新摆位并重渲染三图", () => {
    const state = stateWithPrevis()
    const p = state.projects[0]
    const stg = p.stages[0]
    const next = engineReducer(state, {
      type: "UPDATE_PREVIS_BLOCKING", projectId: p.id, stageId: stg.id, shotIndex: 0,
      blocking: [{ id: "c1", kind: "character", name: "主角", position: [3, 0, 1], rotationY: 90, scale: 1 }],
    })
    const out = (next.projects[0].stages[0].artifact as any).shots[0]
    expect(out.blocking[0].position[0]).toBe(3)
    expect(out.previewSvg).toContain("<svg")
  })

  it("RERENDER_PREVIS 重新生成三图", () => {
    const state = stateWithPrevis()
    const p = state.projects[0]
    const stg = p.stages[0]
    const next = engineReducer(state, { type: "RERENDER_PREVIS", projectId: p.id, stageId: stg.id })
    expect(next.projects[0].stages[0].artifact).toBeDefined()
  })
})
