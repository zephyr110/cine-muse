import { describe, expect, it } from "vitest"
import {
  renderPrevisShot, renderDepthSvg, renderEdgeSvg, renderPreviewSvg, injectMarkerIds, svgDataUrl,
} from "./previs-render"
import { makePrevisShot } from "./previs-types"
import type { PrevisShot } from "@/lib/types"

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

describe("renderPreviewSvg 镜头视锥", () => {
  const base = makePrevisShot(0).blocking

  const frustumVertices = (svg: string): [number, number][] =>
    (svg.match(/<polygon[^>]*points="([^"]+)"/)?.[1] ?? "")
      .split(" ")
      .map((p) => p.split(",").map(Number) as [number, number])

  it("顶点 = 机位投影，底边中点 = 目标投影", () => {
    const cam: PrevisShot["camera"] = { position: [0, 2, 8], target: [0, 1, 0], fov: 45 }
    const [apex, b1, b2] = frustumVertices(renderPreviewSvg(base, cam))
    expect(apex).toEqual([240, -201]) // project([0,2,8])
    expect((b1[0] + b2[0]) / 2).toBeCloseTo(240) // target x=0
    expect((b1[1] + b2[1]) / 2).toBeCloseTo(183) // project([0,1,0])
  })

  it("camera.target 变化 → 视锥随目标投影移动", () => {
    const camA: PrevisShot["camera"] = { position: [0, 2, 8], target: [0, 1, 0], fov: 45 }
    const camB: PrevisShot["camera"] = { position: [0, 2, 8], target: [4, 1, 0], fov: 45 }
    const centerOf = (svg: string) => {
      const [, b1, b2] = frustumVertices(svg)
      return [(b1[0] + b2[0]) / 2, (b1[1] + b2[1]) / 2]
    }
    const a = centerOf(renderPreviewSvg(base, camA))
    const b = centerOf(renderPreviewSvg(base, camB))
    expect(b[0]).toBeCloseTo(432) // project([4,1,0])
    expect(b[0]).toBeGreaterThan(a[0])
  })

  it("未传机位时使用默认机位（与 shot.camera 一致）", () => {
    const s = shot()
    expect(renderPreviewSvg(s.blocking)).toBe(renderPreviewSvg(s.blocking, s.camera))
  })
})

describe("injectMarkerIds", () => {
  it("为角色与道具标记注入 data-bid（地形不注入），顺序对应可拖拽项", () => {
    const blocking = makePrevisShot(0).blocking
    const svg = injectMarkerIds(renderPreviewSvg(blocking), blocking)
    expect(svg).toContain('data-bid="ch-0"')
    expect(svg).toContain('data-bid="prop-0"')
    expect(svg).not.toContain('data-bid="ter-0"')
    const bids = [...svg.matchAll(/data-bid="([^"]+)"/g)].map((m) => m[1])
    expect(bids).toEqual(["ch-0", "prop-0"])
  })
})
