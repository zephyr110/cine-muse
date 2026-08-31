import { describe, expect, it } from "vitest"
import { renderPrevisShot, renderDepthSvg, renderEdgeSvg, svgDataUrl } from "./previs-render"
import { makePrevisShot } from "./previs-types"

const shot = (): ReturnType<typeof makePrevisShot> => {
  const s = makePrevisShot(0)
  s.camera = { position: [0, 2, 8], target: [0, 1, 0], fov: 45 }
  return s
}

describe("renderPrevisShot", () => {
  it("填充三张 SVG 且可序列化为 data URL", () => {
    const out = renderPrevisShot(shot())
    expect(out.previewSvg).toContain("<svg")
    expect(out.depthSvg).toContain("<svg")
    expect(out.edgeSvg).toContain("<svg")
    expect(svgDataUrl(out.depthSvg)).toMatch(/^data:image\/svg\+xml;utf8,/i)
  })
})

describe("renderDepthSvg", () => {
  it("角色在画面前景 → 更亮（灰度更高）", () => {
    const s = shot()
    s.blocking = [
      { ...s.blocking[0], position: [0, 0, -8] }, // 地形远处 (dist≈16.1)
      { ...s.blocking[1], position: [0, 0, 7] },  // 角色近处 (dist≈2.24)
    ]
    const svg = renderDepthSvg(s.blocking)
    const terrainFill = svg.match(/fill="rgb\(([^)]+)\)"[^>]*data-kind="terrain"/)
    const charFill = svg.match(/fill="rgb\(([^)]+)\)"[^>]*data-kind="character"/)
    expect(charFill?.[1]).toBeTruthy()
    expect(terrainFill?.[1]).toBeTruthy()
    const terrainGray = Number(terrainFill?.[1].split(",")[0])
    const charGray = Number(charFill?.[1].split(",")[0])
    expect(charGray).toBeGreaterThan(terrainGray)
  })
})

describe("renderEdgeSvg", () => {
  it("含角色与道具轮廓线段", () => {
    const s = shot()
    const svg = renderEdgeSvg(s.blocking)
    expect(svg).toContain("<line")
    expect(svg).toContain("character")
    expect(svg).toContain("prop")
  })
})
