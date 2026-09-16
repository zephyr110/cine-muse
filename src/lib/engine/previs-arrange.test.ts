import { describe, expect, it } from "vitest"

import type { BlockingItem } from "@/lib/types"
import { alignBottoms, itemBottomY, worldHalfHeightY } from "./previs-arrange"

function item(over: Partial<BlockingItem> & Pick<BlockingItem, "id" | "kind">): BlockingItem {
  return {
    name: over.id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...over,
  } as BlockingItem
}

describe("worldHalfHeightY", () => {
  it("未旋转的道具：半高 = 几何半高 × scale.y", () => {
    expect(worldHalfHeightY(item({ id: "p", kind: "prop", scale: [1, 2, 1] }))).toBeCloseTo(0.7, 6)
  })

  it("未旋转的地形薄板：半高 0.1", () => {
    expect(worldHalfHeightY(item({ id: "t", kind: "terrain" }))).toBeCloseTo(0.1, 6)
  })

  it("★ 薄板立起来（绕 Z 转 90°）后包围盒半高变成 1.5——旋转会让包围盒变高，不能只看 scale.y", () => {
    expect(worldHalfHeightY(item({ id: "t", kind: "terrain", rotation: [0, 0, 90] }))).toBeCloseTo(1.5, 6)
  })

  it("★ 绕 X 转 90°：薄板同样立起，半高 1.5", () => {
    expect(worldHalfHeightY(item({ id: "t", kind: "terrain", rotation: [90, 0, 0] }))).toBeCloseTo(1.5, 6)
  })

  it("角色不吃这套判定（脚底即 position.y，由 itemBottomY 直接返回）", () => {
    expect(worldHalfHeightY(item({ id: "c", kind: "character", rotation: [0, 0, 90] }))).toBe(0)
  })
})

describe("itemBottomY", () => {
  it("角色的底 = position.y（数据约定：角色 y 即脚底平面）", () => {
    expect(itemBottomY(item({ id: "c", kind: "character", position: [1, 0.9, 2] }))).toBeCloseTo(0.9, 6)
  })

  it("道具的底 = 中心 y − 世界半高", () => {
    expect(itemBottomY(item({ id: "p", kind: "prop", position: [0, 0.5, 0] }))).toBeCloseTo(0.15, 6)
  })

  it("地形薄板贴地时的底 = 0", () => {
    expect(itemBottomY(item({ id: "t", kind: "terrain", position: [0, 0.1, 0] }))).toBeCloseTo(0, 6)
  })
})

describe("alignBottoms", () => {
  it("把悬空的道具压回地面：底面 0.15 → 0，即中心 y 减 0.15", () => {
    const p = item({ id: "p", kind: "prop", position: [0, 0.5, 0] })
    expect(alignBottoms([p], ["p"])).toEqual([{ id: "p", y: 0.35 }])
  })

  it("角色已在地面时无需改动（不产生无谓写入，避免污染撤销栈）", () => {
    const c = item({ id: "c", kind: "character", position: [1, 0, 2] })
    expect(alignBottoms([c], ["c"])).toEqual([])
  })

  it("★ 多选混合：角色与道具各自算底，统一落到同一水平面", () => {
    const c = item({ id: "c", kind: "character", position: [0, 1.2, 0] })
    const p = item({ id: "p", kind: "prop", position: [2, 0.5, 0] })
    const t = item({ id: "t", kind: "terrain", position: [0, 0.6, 2] })
    const out = alignBottoms([c, p, t], ["c", "p", "t"])
    expect(out).toEqual(
      expect.arrayContaining([
        { id: "c", y: 0 },
        { id: "p", y: 0.35 },
        { id: "t", y: 0.1 },
      ]),
    )
    expect(out).toHaveLength(3)
    // 复核：整理后三者底面相等
    const byId = new Map(out.map((o) => [o.id, o.y]))
    const bottomOf = (it: BlockingItem) => itemBottomY({ ...it, position: [it.position[0], byId.get(it.id) ?? it.position[1], it.position[2]] })
    expect(bottomOf(c)).toBeCloseTo(bottomOf(p), 6)
    expect(bottomOf(p)).toBeCloseTo(bottomOf(t), 6)
  })

  it("★ 只动选中的项：未选中的悬空道具保持不动", () => {
    const a = item({ id: "a", kind: "prop", position: [0, 0.5, 0] })
    const b = item({ id: "b", kind: "prop", position: [3, 0.5, 0] })
    expect(alignBottoms([a, b], ["a"])).toEqual([{ id: "a", y: 0.35 }])
  })

  it("指定的水平面高度生效（如对齐到台面 0.8）", () => {
    const p = item({ id: "p", kind: "prop", position: [0, 0.5, 0] })
    expect(alignBottoms([p], ["p"], 0.8)).toEqual([{ id: "p", y: 1.15 }])
  })

  it("忽略不存在的 id", () => {
    expect(alignBottoms([], ["nope"])).toEqual([])
  })

  it("结果 y 保留两位小数（与其余变换写入口径一致）", () => {
    const p = item({ id: "p", kind: "prop", position: [0, 0.333, 0] })
    expect(alignBottoms([p], ["p"])).toEqual([{ id: "p", y: 0.35 }])
  })
})
