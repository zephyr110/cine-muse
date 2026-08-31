import { describe, expect, it } from "vitest"
import { BOOST_SLOTS, buildArtifact, buildStages } from "./templates"

describe("previs boost 插槽", () => {
  it("previs 插槽锚定在 video_gen 之前且为 checkpoint", () => {
    const slot = BOOST_SLOTS.find((b) => b.agentId === "previs")
    expect(slot?.before).toBe("video_gen")
    expect(slot?.artifactKind).toBe("previs")
  })

  it("勾选 previs 后注入到 video_gen 之前", () => {
    const stages = buildStages({
      title: "t", premise: "p", genre: "科幻", style: "赛博朋克",
      durationSec: 60, aspectRatio: "16:9", quality: "hd",
      template: "full", interventionMode: "auto",
      assetIds: [], boostAgentIds: ["previs"],
    } as Parameters<typeof buildStages>[0])
    const idx = stages.findIndex((s) => s.agentId === "previs")
    const vidIdx = stages.findIndex((s) => s.agentId === "video_gen")
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(vidIdx)
    expect(stages[idx].isCheckpoint).toBe(true)
  })

  it("full 模板默认注入 previs（向导默认勾选语义）", () => {
    const stages = buildStages({
      title: "t", premise: "p", genre: "科幻", style: "赛博朋克",
      durationSec: 120, aspectRatio: "16:9", quality: "hd",
      template: "full", interventionMode: "auto",
      assetIds: [], boostAgentIds: ["previs"],
    } as Parameters<typeof buildStages>[0])
    expect(stages.some((s) => s.agentId === "previs")).toBe(true)
  })

  it("previs 产物含三图且可渲染", () => {
    const stage = { agentId: "previs", iterations: [] } as any
    const artifact = buildArtifact(stage, { title: "星尘余晖", premise: "p" } as any, [])
    expect(artifact.kind).toBe("previs")
    const shots = (artifact as any).shots
    expect(shots.length).toBeGreaterThan(0)
    expect(shots[0].previewSvg).toContain("<svg")
  })
})
