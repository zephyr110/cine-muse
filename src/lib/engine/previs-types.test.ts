import { describe, expect, it } from "vitest"
import { isPrevisArtifact, makePrevisShot } from "./previs-types"

describe("isPrevisArtifact", () => {
  it("previs artifact 判定为真", () => {
    const a = { kind: "previs" as const, title: "t", summary: "", shots: [] }
    expect(isPrevisArtifact(a)).toBe(true)
  })
  it("其他 kind 判定为假", () => {
    expect(isPrevisArtifact({ kind: "video" as const, title: "t", summary: "" })).toBe(false)
    expect(isPrevisArtifact(undefined)).toBe(false)
  })
})

describe("makePrevisShot", () => {
  it("默认布景含 1 角色 + 1 地形 + 1 道具，中央机位", () => {
    const s = makePrevisShot(3)
    expect(s.shotIndex).toBe(3)
    expect(s.blocking.map((b) => b.kind)).toEqual(["terrain", "character", "prop"])
    expect(s.camera).toEqual({ position: [0, 2, 8], target: [0, 1, 0], fov: 45 })
    expect(s.depthSvg).toBe("")
  })
})
