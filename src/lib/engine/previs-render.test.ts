import { describe, expect, it } from "vitest"
import {
  renderPrevisShot, renderDepthSvg, renderEdgeSvg, renderPreviewSvg, injectMarkerIds, svgDataUrl,
} from "./previs-render"
import { makePrevisShot } from "./previs-types"
import type { BlockingItem, PrevisShot } from "@/lib/types"

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

describe("v2 投影语义", () => {
  it("角色足迹矩形随 rotation[1] 旋转、随非等比 scale 缩放", () => {
    const item: BlockingItem = {
      id: "c1", kind: "character", name: "主角",
      position: [0, 0, 1], rotation: [0, 90, 0], scale: [2, 1, 1],
    }
    const svg = renderPreviewSvg([item])
    // 中心投影 = project([0,0,1]) → (240, 135)；角色基准半宽/半深 12 → scale.x=2 足迹矩形宽 48、半深仍 12
    expect(svg).toContain(`data-kind="character"`)
    expect(svg).toMatch(/<rect[^>]*x="216"[^>]*y="123"[^>]*width="48"[^>]*height="24"[^>]*rx="6"/)
    // 矩形绕足迹中心旋转 90°（rotation 单位为度），宽轴转向 z
    expect(svg).toContain('transform="rotate(90 240 135)"')
  })
  it("rotation[1] 单位为度：90° 朝向线水平沿 +x、0° 时竖直向上（无弧度残留）", () => {
    const base: BlockingItem = {
      id: "c1", kind: "character", name: "主角",
      position: [0, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1],
    }
    const svg90 = renderPreviewSvg([{ ...base, rotation: [0, 90, 0] }])
    expect(svg90).toContain('<line x1="240" y1="135" x2="256" y2="135"') // 沿 +x 水平
    const svg0 = renderPreviewSvg([base])
    expect(svg0).toContain('<line x1="240" y1="135" x2="240" y2="119"') // 竖直向上
  })
  it("道具抬升到机位之上 → 视距更远：深度更暗且先绘制（近亮远暗、按 3D 距离）", () => {
    const near: BlockingItem = {
      id: "p1", kind: "prop", name: "近道具",
      position: [2, 0.35, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    }
    const far: BlockingItem = {
      id: "p2", kind: "prop", name: "高道具",
      position: [2, 7, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    }
    const svg = renderDepthSvg([near, far])
    // 同一足迹（相同 x/z 投影 → 相同矩形坐标）仅靠 y 高度拉开视距，须用填充色与绘制顺序区分
    const greys = [...svg.matchAll(/fill="rgb\((\d+),\1,\1\)"[^>]*transform="rotate\(0 336 183\)"[^>]*data-kind="prop"/g)].map((m) => Number(m[1]))
    // 3D 视距（到机位 [0,2,8]）：near dist=√(2²+1.65²+8²)≈8.41 → 灰 114；far(y=7) dist=√(2²+5²+8²)≈9.64 → 灰 95
    expect(greys).toEqual([95, 114]) // 远先画（更暗在下），近后画（更亮在上）
    expect(greys[0]).toBeLessThan(greys[1])
  })
})

describe("三图背景与标记契约", () => {
  it("背景色语义保持：preview #f4f4f5 / depth #3c3c3c / edge #18181b", () => {
    const s = shot()
    expect(renderPreviewSvg(s.blocking)).toMatch(/^<svg[^>]*><rect width="480" height="270" fill="#f4f4f5"\/>/)
    expect(renderDepthSvg(s.blocking)).toMatch(/^<svg[^>]*><rect width="480" height="270" fill="#3c3c3c"\/>/)
    expect(renderEdgeSvg(s.blocking)).toMatch(/^<svg[^>]*><rect width="480" height="270" fill="#18181b"\/>/)
  })
  it("角色/道具各恰一个带 data-kind 的元素（按 blocking 顺序），视锥保留 data-kind=frustum", () => {
    const s = shot()
    const svg = renderPreviewSvg(s.blocking)
    const markers = [...svg.matchAll(/<[^>]*?data-kind="(character|prop|frustum)"/g)].map((m) => m[1])
    expect(markers).toEqual(["character", "prop", "frustum"])
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
