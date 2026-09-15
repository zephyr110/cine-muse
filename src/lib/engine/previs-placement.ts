/**
 * previs-placement：布景项自动落位。
 *
 * 解决的是**完全重叠**：叠加处 raycast 只能命中最近的一个，被压住的那个永远点不到，
 * 表现为「有时候无法选中，无法移动/旋转」。原来有两条路径会制造重叠——
 *   1) 新增角色按「现有角色数量」推导网格槽位：删除任意一个后数量回退，下一个新增会复用已占用的槽；
 *   2) 粘贴一律按「源 +（1,1）」：对同一源连续粘贴两次，两个副本落在同一点。
 * 本模块把「取第一个空闲位置」收口成纯函数，两条路径共用。
 *
 * 与 previs-render 俯视投影同口径：480×270 画布、48px/世界单位（z 向上）。
 */

import type { BlockingItem } from "@/lib/types"

export type Placement = [number, number, number]

/** 网格列数（4 列；与既有外观一致，不改变 ≤16 个角色时的落位） */
export const GRID_COLUMNS = 4
/** 列间距（世界单位） */
export const COL_SPACING = 1.25
/** 行间距（世界单位） */
export const ROW_SPACING = 0.8
/** 首行 z（与默认布景同区） */
export const GRID_ORIGIN_Z = 1
/** 同类项最小水平间距：小于此值视为叠加。远小于相邻槽间距（0.8），不会误判正常摆位 */
export const SLOT_MIN_DISTANCE = 0.4
/** 槽位 / 偏移探测上限；超出则退回最后候选（仍不叠加，只是不再继续外推） */
const MAX_PROBE = 256

const round2 = (v: number) => Math.round(v * 100) / 100
const horizontalDistance = (a: Placement, b: Placement) => Math.hypot(a[0] - b[0], a[2] - b[2])

/**
 * 网格槽位 n → 位置（第 ⌊n/4⌋ 行、第 n%4 列，逐行向后排）。
 *
 * 不钳制 z：原实现对 z 钳制到俯视可视区上界，自 row≥4 起所有行被压到同一条线上，
 * 与前一轮 4 个槽位完全重合（第 17 个角色起堆叠）。宁可排到可视区外，也不叠加——
 * 排在区外仍可选中、可用 3D 视角找到并拖回；叠在一起则永远点不到。
 */
export function gridSlotPosition(n: number): Placement {
  const col = (n % GRID_COLUMNS) - (GRID_COLUMNS - 1) / 2
  const row = Math.floor(n / GRID_COLUMNS)
  return [round2(col * COL_SPACING), 0, round2(GRID_ORIGIN_Z + row * ROW_SPACING)]
}

/** 位置是否与任一**同类**已有项叠加（y 不参与：布景按平面摆位，角色/道具 y 语义不同） */
export function isOverlapping(
  existing: readonly BlockingItem[],
  position: Placement,
  kind: BlockingItem["kind"],
  minDistance: number = SLOT_MIN_DISTANCE,
): boolean {
  return existing.some(
    (item) =>
      item.kind === kind && horizontalDistance(item.position as Placement, position) < minDistance,
  )
}

/** 新增角色落位：自第 0 槽起取第一个空闲槽（删除留下的空槽会被回填；无删除时与逐行递增一致） */
export function nextCharacterPosition(existing: readonly BlockingItem[]): Placement {
  for (let n = 0; n < MAX_PROBE; n++) {
    const pos = gridSlotPosition(n)
    if (!isOverlapping(existing, pos, "character")) return pos
  }
  return gridSlotPosition(existing.length)
}

/** 粘贴落位：自「源 +（1,1）」起沿同一方向逐步外推，取第一个不通叠的位置（保留既有错位惯例） */
export function nextPastePosition(existing: readonly BlockingItem[], source: BlockingItem): Placement {
  const base = source.position as Placement
  for (let step = 1; step <= MAX_PROBE; step++) {
    const pos: Placement = [round2(base[0] + step), base[1], round2(base[2] + step)]
    if (!isOverlapping(existing, pos, source.kind)) return pos
  }
  return [round2(base[0] + MAX_PROBE), base[1], round2(base[2] + MAX_PROBE)]
}
