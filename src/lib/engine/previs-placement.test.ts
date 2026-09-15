/**
 * previs-placement：布景项自动落位。
 *
 * 回归靶心：新增角色曾按「现有角色数量」推导网格槽位、粘贴曾按「源 + (1,1)」定死偏移。
 * 两者都会复用已占用的落点，产生**完全重叠**的布景项——叠加处 raycast 只能命中最近的一个，
 * 被压住的那个永远点不到，表现为「有时候无法选中，无法移动/旋转」。
 */

import { describe, expect, it } from "vitest"

import type { BlockingItem } from "@/lib/types"
import {
  COL_SPACING,
  GRID_ORIGIN_Z,
  ROW_SPACING,
  SLOT_MIN_DISTANCE,
  gridSlotPosition,
  isOverlapping,
  nextCharacterPosition,
  nextPastePosition,
} from "./previs-placement"

type Placement = [number, number, number]

function makeItem(id: string, position: Placement, kind: BlockingItem["kind"] = "character"): BlockingItem {
  return {
    id,
    kind,
    name: id,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  } as BlockingItem
}

const horizontal = (a: Placement, b: Placement) => Math.hypot(a[0] - b[0], a[2] - b[2])

describe("gridSlotPosition", () => {
  it("前 16 槽与旧「按数量推导」公式逐值一致（无行为回归）", () => {
    const round2 = (v: number) => Math.round(v * 100) / 100
    for (let n = 0; n < 16; n++) {
      const col = (n % 4) - 1.5
      const row = Math.floor(n / 4)
      expect(gridSlotPosition(n)).toEqual([
        round2(col * COL_SPACING),
        0,
        round2(GRID_ORIGIN_Z + row * ROW_SPACING),
      ])
    }
  })

  it("槽位互不相同（不因钳制而重合）", () => {
    const seen = new Set<string>()
    for (let n = 0; n < 32; n++) {
      const key = gridSlotPosition(n).join(",")
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })
})

describe("isOverlapping", () => {
  it("同类且水平距离小于阈值 → 视为叠加", () => {
    const existing = [makeItem("a", [1, 0, 1])]
    expect(isOverlapping(existing, [1, 0, 1], "character")).toBe(true)
    expect(isOverlapping(existing, [1 + SLOT_MIN_DISTANCE / 2, 0, 1], "character")).toBe(true)
    expect(isOverlapping(existing, [1 + SLOT_MIN_DISTANCE * 2, 0, 1], "character")).toBe(false)
  })

  it("只比较同类项——地形不阻挡角色落位（角色本就站在地面上）", () => {
    const existing = [makeItem("g", [0, 0, 1], "terrain")]
    expect(isOverlapping(existing, [0, 0, 1], "character")).toBe(false)
  })
})

describe("nextCharacterPosition", () => {
  it("空场落第一个槽位", () => {
    expect(nextCharacterPosition([])).toEqual(gridSlotPosition(0))
  })

  it("连续新增 24 个角色，两两不叠加", () => {
    const items: BlockingItem[] = []
    const placed: Placement[] = []
    for (let i = 0; i < 24; i++) {
      const pos = nextCharacterPosition(items)
      placed.push(pos)
      items.push(makeItem(`ch-${i}`, pos))
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(horizontal(placed[i], placed[j])).toBeGreaterThanOrEqual(SLOT_MIN_DISTANCE)
      }
    }
  })

  it("★ 添加 4 个、删掉第 1 个、再添加 → 不与任何存活角色重叠（原缺陷的复现路径）", () => {
    const items: BlockingItem[] = []
    for (let i = 0; i < 4; i++) items.push(makeItem(`ch-${i}`, nextCharacterPosition(items)))
    // 删掉第 1 个（原实现此后按 length=3 推导，会取到第 4 个已占用的槽位）
    items.splice(0, 1)

    const pos = nextCharacterPosition(items)
    for (const it of items) {
      expect(horizontal(pos, it.position as Placement)).toBeGreaterThanOrEqual(SLOT_MIN_DISTANCE)
    }
  })

  it("★ 第 17 个起不再堆叠（原实现自 row≥4 起被 z 钳制到同一点）", () => {
    const items: BlockingItem[] = []
    const placed: Placement[] = []
    for (let i = 0; i < 32; i++) {
      const pos = nextCharacterPosition(items)
      placed.push(pos)
      items.push(makeItem(`ch-${i}`, pos))
    }
    const last = placed.slice(16)
    for (let i = 0; i < last.length; i++) {
      for (let j = i + 1; j < last.length; j++) {
        expect(horizontal(last[i], last[j])).toBeGreaterThanOrEqual(SLOT_MIN_DISTANCE)
      }
    }
  })
})

describe("nextPastePosition", () => {
  it("首粘贴沿用源 +（1,1）偏移", () => {
    const source = makeItem("src", [2, 0, 3])
    expect(nextPastePosition([source], source)).toEqual([3, 0, 4])
  })

  it("★ 对同一源连续粘贴两次 → 两个副本不重叠（原实现两次都是 源+(1,1)）", () => {
    const source = makeItem("src", [2, 0, 3])
    const items: BlockingItem[] = [source]
    const first = nextPastePosition(items, source)
    items.push(makeItem("copy-1", first))
    const second = nextPastePosition(items, source)
    expect(horizontal(first, second)).toBeGreaterThanOrEqual(SLOT_MIN_DISTANCE)
  })

  it("沿同一方向逐步外推，保持 +x/+z 错位惯例", () => {
    const source = makeItem("src", [0, 0, 0])
    let items: BlockingItem[] = [source]
    for (let i = 1; i <= 3; i++) {
      const pos = nextPastePosition(items, source)
      expect(pos).toEqual([i, 0, i])
      items = [...items, makeItem(`copy-${i}`, pos)]
    }
  })
})
