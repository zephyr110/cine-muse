/**
 * 相机数学（reframeCamera / getRigQuaternion）单元测试。
 *
 * 语义 1:1 对照 REF
 * `/Users/zephyr/.claude/jobs/19e19313/tmp/storyai-ref/src/editor/canvas/SceneRoot.tsx`：
 *   - reframeCamera ← commitCameraTransformFromViewport（视距保持；target = pos + 朝向 × 视距）
 *   - getRigQuaternion ← getViewportCameraQuaternion（局部 +Z = 朝向 target）
 */

import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { getRigQuaternion, reframeCamera } from "./previs-camera"

type V3 = [number, number, number]

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

describe("reframeCamera", () => {
  it("平移：position 移动时 target 同位移，视距保持", () => {
    const camera = { position: [1, 2, 3] as V3, target: [1, 2, 8] as V3 }
    const before = dist(camera.position, camera.target) // 5
    const out = reframeCamera(camera, [4, 2, 3])
    expect(out.position).toEqual([4, 2, 3])
    expect(out.target).toEqual([4, 2, 8]) // 与 position 同位移（+3x）
    expect(dist(out.position, out.target)).toBeCloseTo(before, 6)
  })

  it("旋转：target 重算于新 forward 上，视距不变", () => {
    const camera = { position: [0, 0, 0] as V3, target: [0, 0, 5] as V3 } // 视距 5，朝向 +Z
    const out = reframeCamera(camera, [0, 0, 0], [1, 0, 0])
    expect(out.target).toEqual([5, 0, 0])
    expect(dist(out.position, out.target)).toBeCloseTo(5, 6)
  })

  it("缺省 forward：沿用当前朝向", () => {
    const camera = { position: [0, 0, 0] as V3, target: [3, 4, 0] as V3 } // 视距 5，朝向 (0.6, 0.8, 0)
    const out = reframeCamera(camera, [0, 1, 0])
    expect(out.position).toEqual([0, 1, 0])
    expect(out.target[0]).toBeCloseTo(3, 6)
    expect(out.target[1]).toBeCloseTo(5, 6) // 1 + 4
    expect(out.target[2]).toBeCloseTo(0, 6)
    expect(dist(out.position, out.target)).toBeCloseTo(5, 6)
  })

  it("forward 非单位向量 → 归一化后使用", () => {
    // 视距 5、forward [0,3,0]：归一化后 [0,1,0]，target = pos + [0,1,0]×5 = [0,5,0]。
    // 未归一化 → [0,15,0]；照抄输入 target → [0,0,5]，两者均被本用例排除。
    const camera = { position: [0, 0, 0] as V3, target: [0, 0, 5] as V3 }
    const out = reframeCamera(camera, [0, 0, 0], [0, 3, 0])
    expect(out.target).toEqual([0, 5, 0])
    expect(dist(out.position, out.target)).toBeCloseTo(5, 6)
  })

  it("退化输入：零长 forward 回退 +Z；零视距钳到 REF 下限 0.1", () => {
    const camera = { position: [0, 0, 0] as V3, target: [0, 0, 0] as V3 }
    const out = reframeCamera(camera, [0, 0, 0], [0, 0, 0])
    expect(out.target).toEqual([0, 0, 0.1])
  })
})

describe("getRigQuaternion", () => {
  it("局部 +Z 指向 target（REF getViewportCameraQuaternion）", () => {
    const q = getRigQuaternion([0, 0, 0], [1, 2, -3])
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
    const want = new THREE.Vector3(1, 2, -3).normalize()
    expect(fwd.x).toBeCloseTo(want.x, 6)
    expect(fwd.y).toBeCloseTo(want.y, 6)
    expect(fwd.z).toBeCloseTo(want.z, 6)
  })

  it("朝向与世界上方平行 → up 退化为 +Z（无 NaN）", () => {
    const q = getRigQuaternion([0, 5, 0], [0, 0, 0])
    expect(Number.isNaN(q.x + q.y + q.z + q.w)).toBe(false)
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
    expect(fwd.y).toBeCloseTo(-1, 6)
  })

  it("position 与 target 重合 → 单位四元数", () => {
    const q = getRigQuaternion([1, 1, 1], [1, 1, 1])
    expect(q.toArray()).toEqual([0, 0, 0, 1])
  })
})
