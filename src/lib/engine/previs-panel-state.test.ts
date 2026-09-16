import { describe, expect, it } from "vitest"

import {
  DEFAULT_OPEN_SECTIONS,
  SIDEBAR_RAIL_WIDTH_PX,
  SIDEBAR_SECTIONS,
  SIDEBAR_WIDTH_PX,
  applicableSections,
  openSection,
  sectionsForSelection,
  toggleSection,
  type SidebarSection,
} from "./previs-panel-state"

describe("previs-panel-state", () => {
  it("SIDEBAR_SECTIONS 为五分区，顺序即渲染顺序（light 紧随 camera）", () => {
    expect(SIDEBAR_SECTIONS).toEqual(["camera", "light", "items", "pose", "transform"])
  })

  it("默认展开集合恰为 机位 + 布景项", () => {
    expect([...DEFAULT_OPEN_SECTIONS].sort()).toEqual(["camera", "items"])
  })

  it("宽度常量为正且图标条窄于侧栏", () => {
    expect(SIDEBAR_WIDTH_PX).toBeGreaterThan(0)
    expect(SIDEBAR_RAIL_WIDTH_PX).toBeGreaterThan(0)
    expect(SIDEBAR_RAIL_WIDTH_PX).toBeLessThan(SIDEBAR_WIDTH_PX)
  })

  it("applicableSections：机位/布景项恒在，角色姿态仅角色，变换仅任意选中项", () => {
    expect(applicableSections(null)).toEqual(["camera", "items"])
    expect(applicableSections({ kind: "terrain" })).toEqual(["camera", "items", "transform"])
    expect(applicableSections({ kind: "prop" })).toEqual(["camera", "items", "transform"])
    expect(applicableSections({ kind: "character" })).toEqual(["camera", "items", "pose", "transform"])
  })

  it("applicableSections：光源分区仅该分镜已有光源时出现（无光源不占位）", () => {
    expect(applicableSections(null, true)).toEqual(["camera", "light", "items"])
    expect(applicableSections({ kind: "character" }, true)).toEqual([
      "camera", "light", "items", "pose", "transform",
    ])
    expect(applicableSections({ kind: "prop" }, false)).not.toContain("light")
  })

  it("sectionsForSelection：角色自动展开 姿态+变换，道具仅 变换，空选择为空", () => {
    expect(sectionsForSelection({ kind: "character" })).toEqual(["pose", "transform"])
    expect(sectionsForSelection({ kind: "prop" })).toEqual(["transform"])
    expect(sectionsForSelection(null)).toEqual([])
  })

  it("sectionsForSelection：有光源时自动展开光源分区（新增光源后面板自己露出来）", () => {
    expect(sectionsForSelection(null, true)).toEqual(["light"])
    expect(sectionsForSelection({ kind: "character" }, true)).toEqual(["light", "pose", "transform"])
  })

  it("toggleSection 往返回到原集合，且不改动入参", () => {
    const open: ReadonlySet<SidebarSection> = new Set(["camera"])
    const once = toggleSection(open, "pose")
    expect([...once].sort()).toEqual(["camera", "pose"])
    const twice = toggleSection(once, "pose")
    expect([...twice].sort()).toEqual(["camera"])
    expect([...open]).toEqual(["camera"]) // 入参未被污染
    expect(once).not.toBe(open) // 返回新 Set
  })

  it("openSection 幂等且不改动入参", () => {
    const open: ReadonlySet<SidebarSection> = new Set(["camera"])
    const a = openSection(open, "items")
    const b = openSection(a, "items")
    expect([...a].sort()).toEqual(["camera", "items"])
    expect([...b].sort()).toEqual(["camera", "items"])
    expect([...open]).toEqual(["camera"])
    expect(b).not.toBe(a)
  })
})
