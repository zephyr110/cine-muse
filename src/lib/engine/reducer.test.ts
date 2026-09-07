import { describe, expect, it } from "vitest"
import { engineReducer, createInitialState, migrateAppState } from "./reducer"
import { makePrevisShot } from "./previs-types"
import { renderPrevisShot } from "./previs-render"
import type { AppState, Artifact, BlockingItem, PrevisShot } from "@/lib/types"

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

/** 构造 previs → video_gen 双环节项目（星尘余晖式 review/manual 场景）：previs 携带已渲染产物，video_gen 待启动 */
function stateWithPrevisFlow(
  previsStatus: "waiting_approval" | "completed" | "approved",
  projectStatus: "waiting_approval" | "queued",
): AppState {
  const shot = renderPrevisShot(makePrevisShot(0))
  // PrevisArtifact.shots 与 Artifact.shots?: number 冲突，工件放入 stage 时按 Artifact 边界收窄
  const artifact = { kind: "previs" as const, title: "t", summary: "", shots: [shot] } as unknown as Artifact
  const base = engineReducer(createInitialState(), { type: "HYDRATE", state: createInitialState() })
  const p = base.projects[0]
  const previsStage = { ...p.stages[0], id: "stg-previs", agentId: "previs", status: previsStatus, artifact }
  const videoStage = { ...p.stages[0], id: "stg-video", agentId: "video_gen", status: "pending" as const }
  return { ...base, projects: [{ ...p, status: projectStatus, stages: [previsStage, videoStage] }] }
}

describe("previs reducer", () => {
  it("UPDATE_PREVIS_BLOCKING 更新摆位并重渲染三图", () => {
    const state = stateWithPrevis()
    const p = state.projects[0]
    const stg = p.stages[0]
    const next = engineReducer(state, {
      type: "UPDATE_PREVIS_BLOCKING", projectId: p.id, stageId: stg.id, shotIndex: 0,
      blocking: [{ id: "c1", kind: "character", name: "主角", position: [3, 0, 1], rotation: [0, 90, 0], scale: [1, 1, 1] }],
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

describe("previs 参考附件注入（video_gen 启动时）", () => {
  /** 断言 video_gen 已从 previs 产物注入参考附件 */
  const expectPrevisRefs = (state: AppState) => {
    const video = state.projects[0].stages[1]
    expect(video.status).toBe("running")
    expect(video.references?.[0]?.kind).toBe("previs")
    expect(video.references?.[0]?.depthUrl.startsWith("data:image/svg+xml")).toBe(true)
    expect(video.references?.[0]?.edgeUrl.startsWith("data:image/svg+xml")).toBe(true)
  }

  it("approved 状态（review/manual 人工确认）的 previs 环节注入参考附件", () => {
    const state = stateWithPrevisFlow("waiting_approval", "waiting_approval")
    const p = state.projects[0]
    const previsStage = p.stages[0]
    // 复现 C-1 缺陷路径：人工确认 → approved → startNextStage 启动 video_gen
    const next = engineReducer(state, {
      type: "APPROVE_STAGE", projectId: p.id, stageId: previsStage.id, now: "2026-09-01T00:00:00.000Z",
    })
    expect(next.projects[0].stages[0].status).toBe("approved")
    expectPrevisRefs(next)
  })

  it("completed 状态（auto/guided 自动确认）的 previs 环节注入参考附件", () => {
    const state = stateWithPrevisFlow("completed", "queued")
    const p = state.projects[0]
    // 启动项目即触发 startNextStage：previs 已完成、video_gen 待启动
    const next = engineReducer(state, { type: "START_PROJECT", projectId: p.id, now: "2026-09-01T00:00:00.000Z" })
    expectPrevisRefs(next)
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

  it("v1 previs blocking 迁移到 v2 全 3D 形状（rotation/scale 向量化）", () => {
    const legacy = {
      version: 1,
      projects: [
        {
          id: "p1",
          stages: [
            {
              id: "s1",
              agentId: "previs",
              artifact: {
                kind: "previs",
                shots: [
                  {
                    shotIndex: 0,
                    camera: { position: [0, 2, 8], target: [0, 1, 0], fov: 45 },
                    blocking: [
                      { id: "c1", kind: "character", name: "主角", position: [0, 0, 1], rotationY: 90, scale: 1.2 },
                      { id: "t1", kind: "terrain", name: "地形", position: [0, 0, 0], rotationY: 0, scale: 1 },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    }
    const migrated = migrateAppState(legacy as unknown)
    const shot = (migrated.projects[0]?.stages[0]?.artifact as unknown as { shots: { blocking: BlockingItem[] }[] }).shots[0]
    const char = shot.blocking.find((b) => b.kind === "character")!
    expect(char.rotation).toEqual([0, 90, 0])
    expect(char.scale).toEqual([1.2, 1.2, 1.2])
    expect(char).not.toHaveProperty("rotationY")
    expect(migrated.version).toBe(2)
  })

  it("v1 previs 撤销栈中的 blocking 快照同样迁移为 v2（撤销不会回灌旧形状）", () => {
    const legacy = {
      version: 1,
      projects: [],
      previsUndo: {
        past: [{ stageId: "s1", shots: [{ shotIndex: 0, blocking: [{ id: "c1", kind: "character", name: "主角", position: [1, 0, 1], rotationY: 45, scale: 2 }], camera: { position: [0, 2, 8], target: [0, 1, 0], fov: 45 } }] }],
        future: [],
      },
    }
    const migrated = migrateAppState(legacy as unknown)
    const snap = migrated.previsUndo.past[0]
    const item = snap?.shots[0]?.blocking[0]
    expect(item?.rotation).toEqual([0, 45, 0])
    expect(item?.scale).toEqual([2, 2, 2])
    expect(item).not.toHaveProperty("rotationY")
  })

  it("PREVIS_UNDO 恢复上一次提交的摆位，PREVIS_REDO 重做", () => {
    const state = stateWithPrevis()
    const p = state.projects[0]
    const stg = p.stages[0]
    const move = (s: AppState, x: number): AppState =>
      engineReducer(s, {
        type: "UPDATE_PREVIS_BLOCKING", projectId: p.id, stageId: stg.id, shotIndex: 0, commit: true,
        blocking: [{ id: "c1", kind: "character", name: "主角", position: [x, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] }],
      })
    const s1 = move(state, 1)
    const s2 = move(s1, 2)
    expect(shotsOf(s2)[0].blocking[0].position[0]).toBe(2)
    const undone = engineReducer(s2, { type: "PREVIS_UNDO", projectId: p.id, stageId: stg.id })
    expect(shotsOf(undone)[0].blocking[0].position[0]).toBe(1)
    const redone = engineReducer(undone, { type: "PREVIS_REDO", projectId: p.id, stageId: stg.id })
    expect(shotsOf(redone)[0].blocking[0].position[0]).toBe(2)
    // 撤销到顶后不再变化
    const undone2 = engineReducer(undone, { type: "PREVIS_UNDO", projectId: p.id, stageId: stg.id })
    expect(shotsOf(undone2)[0].blocking[0].position[0]).toBe(0)
    const undone3 = engineReducer(undone2, { type: "PREVIS_UNDO", projectId: p.id, stageId: stg.id })
    expect(shotsOf(undone3)[0].blocking[0].position[0]).toBe(0)
  })

  it("commit=false 的中间帧不产生撤销快照", () => {
    const state = stateWithPrevis()
    const p = state.projects[0]
    const stg = p.stages[0]
    const s1 = engineReducer(state, {
      type: "UPDATE_PREVIS_BLOCKING", projectId: p.id, stageId: stg.id, shotIndex: 0, commit: false,
      blocking: [{ id: "c1", kind: "character", name: "主角", position: [3, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] }],
    })
    const undone = engineReducer(s1, { type: "PREVIS_UNDO", projectId: p.id, stageId: stg.id })
    // 无快照 → 撤销无效果
    expect(shotsOf(undone)[0].blocking[0].position[0]).toBe(3)
  })

  it("一次逻辑编辑（blocking+camera 组合提交）仅产生一个撤销快照", () => {
    const state = stateWithPrevis()
    const p = state.projects[0]
    const stg = p.stages[0]
    const s1 = engineReducer(state, {
      type: "UPDATE_PREVIS_BLOCKING", projectId: p.id, stageId: stg.id, shotIndex: 0, commit: true,
      blocking: [{ id: "c1", kind: "character", name: "主角", position: [2, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] }],
    })
    const s2 = engineReducer(s1, {
      type: "UPDATE_PREVIS_CAMERA", projectId: p.id, stageId: stg.id, shotIndex: 0, commit: false,
      camera: { position: [1, 3, 7], target: [0, 1, 0], fov: 45 },
    })
    expect(s2.previsUndo.past).toHaveLength(1)
    // 一次撤销同时还原摆位与机位
    const undone = engineReducer(s2, { type: "PREVIS_UNDO", projectId: p.id, stageId: stg.id })
    expect(shotsOf(undone)[0].blocking[0].position[0]).toBe(0)
    expect(shotsOf(undone)[0].camera.position).toEqual([0, 2, 8])
  })

  it("跨 stage 的撤销不弹出其他 stage 的快照", () => {
    const state = stateWithPrevis()
    const p = state.projects[0]
    const stgA = p.stages[0]
    const stgB = { ...p.stages[1], agentId: "previs", status: "waiting_approval" as const, artifact: stgA.artifact }
    const withB = { ...state, projects: [{ ...p, stages: [stgA, stgB, ...p.stages.slice(2)] }] }
    const s1 = engineReducer(withB, {
      type: "UPDATE_PREVIS_BLOCKING", projectId: p.id, stageId: stgA.id, shotIndex: 0, commit: true,
      blocking: [{ id: "c1", kind: "character", name: "主角", position: [2, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] }],
    })
    expect(s1.previsUndo.past).toHaveLength(1)
    // 对 B 撤销：栈顶是 A 的快照 → 不弹出、不丢失
    const undoneB = engineReducer(s1, { type: "PREVIS_UNDO", projectId: p.id, stageId: stgB.id })
    expect(undoneB.previsUndo.past).toHaveLength(1)
    // 对 A 撤销仍可用
    const undoneA = engineReducer(undoneB, { type: "PREVIS_UNDO", projectId: p.id, stageId: stgA.id })
    expect(shotsOf(undoneA)[0].blocking[0].position[0]).toBe(0)
  })
})
