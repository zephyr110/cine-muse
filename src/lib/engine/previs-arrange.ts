/**
 * previs-arrange：「一键整理」——把选中图元的底面统一对齐到同一水平面。
 *
 * 难点在「底」怎么算，三种 kind 语义不同（v2 数据约定，见 BlockingItem.position 注释）：
 *   - character：y **就是**脚底平面高度 → 底 = y，与旋转/缩放无关（骨缩放不影响落脚点）；
 *   - prop/terrain：y 是**几何中心** → 底 = y − 世界包围盒半高。
 *
 * 半高不能只看 scale.y：**旋转会让包围盒变高**（一块 0.2 厚的薄板立起来后半高是 1.5），
 * 故按旋转矩阵的 y 行取绝对值加权三个半轴，与 three 的 Matrix4（Euler 默认 XYZ 序）
 * 同口径——视口的 object.rotation.set(rx, ry, rz) 用的正是该默认序。
 *
 * 几何半尺寸与视口 buildMesh 的构造同源，改那边务必同步这里。
 */

import * as THREE from "three"

import type { BlockingItem } from "@/lib/types"

const DEG = Math.PI / 180
const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * 图元几何半尺寸（世界单位，**未**乘 scale）——与视口 buildMesh 的几何一一对应：
 * prop = BoxGeometry(0.7, 0.7, 0.7)，terrain = BoxGeometry(3, 0.2, 3)。
 * character 不入表：其底由 position.y 直接给出（见 itemBottomY）。
 */
export const ITEM_HALF_EXTENTS: Record<"prop" | "terrain", readonly [number, number, number]> = {
  prop: [0.35, 0.35, 0.35],
  terrain: [1.5, 0.1, 1.5],
}

const _euler = new THREE.Euler()
const _mat = new THREE.Matrix4()

/**
 * 图元世界包围盒的 y 半高（角色恒为 0，其底不走包围盒）。
 *
 * 世界 y 行 = 旋转矩阵第二行 (m10, m11, m12)；列主序下落在 elements[1]/[5]/[9]。
 * 半高 = Σ |m1i| × 半尺寸_i × scale_i（AABB 的支撑函数，旋转下取绝对值即可）。
 */
export function worldHalfHeightY(item: BlockingItem): number {
  if (item.kind === "character") return 0
  const he = ITEM_HALF_EXTENTS[item.kind as "prop" | "terrain"]
  if (!he) return 0
  _euler.set(item.rotation[0] * DEG, item.rotation[1] * DEG, item.rotation[2] * DEG)
  _mat.makeRotationFromEuler(_euler)
  const e = _mat.elements
  return (
    Math.abs(e[1]) * he[0] * item.scale[0] +
    Math.abs(e[5]) * he[1] * item.scale[1] +
    Math.abs(e[9]) * he[2] * item.scale[2]
  )
}

/** 图元底面所在的世界 y。角色按数据约定直接用 position.y，其余减世界半高。 */
export function itemBottomY(item: BlockingItem): number {
  return item.position[1] - worldHalfHeightY(item)
}

/** 整理结果：仅含**需要改动**的项（y 与现值相同的直接省略，避免无谓写入污染撤销栈） */
export interface ArrangePatch {
  id: string
  y: number
}

/**
 * 把 ids 指定的图元底面统一对齐到 planeY（默认 0，即舞台地面）。
 *
 * 只处理选中的项——未选中的悬空图元保持原样。对已经对齐的项不产出 patch，
 * 于是「选中一批本就整齐的模型再点整理」是一次空操作（不入撤销栈）。
 */
export function alignBottoms(
  items: readonly BlockingItem[],
  ids: readonly string[],
  planeY = 0,
): ArrangePatch[] {
  const wanted = new Set(ids)
  const out: ArrangePatch[] = []
  for (const item of items) {
    if (!wanted.has(item.id)) continue
    const y = round2(planeY + worldHalfHeightY(item))
    if (y === round2(item.position[1])) continue
    out.push({ id: item.id, y })
  }
  return out
}
