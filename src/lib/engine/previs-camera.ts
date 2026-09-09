/**
 * 预演视口相机数学（纯函数，无 DOM/场景依赖）。
 *
 * 1:1 移植自 REF
 * `/Users/zephyr/.claude/jobs/19e19313/tmp/storyai-ref/src/editor/canvas/SceneRoot.tsx`：
 *   - `reframeCamera`      ← `commitCameraTransformFromViewport`（rig 拖动语义：视距保持）
 *   - `getRigQuaternion`   ← `getViewportCameraQuaternion`（rig 朝向：局部 +Z 指向 target）
 */

import * as THREE from "three"

/** 机位位姿（shot.camera 的几何子集；fov 不参与重算） */
export interface PrevisCameraPose {
  position: [number, number, number]
  target: [number, number, number]
}

/** REF commitCameraTransformFromViewport 的视距下限（position 与 target 重合时防退化） */
const MIN_VIEW_DISTANCE = 0.1
/** 朝向退化时的回退方向（与 REF VIEWPORT_CAMERA_FORWARD 一致：局部 +Z 为机位前方） */
const DEFAULT_FORWARD: [number, number, number] = [0, 0, 1]
/** REF VIEWPORT_CAMERA_WORLD_UP */
const WORLD_UP = new THREE.Vector3(0, 1, 0)

const toVec3 = (v: [number, number, number]) => new THREE.Vector3(v[0], v[1], v[2])

/**
 * 重算机位：保持 position→target 视距，`target = pos + forward × 视距`。
 * - `forward` 缺省沿用当前朝向（target - position 归一化）；零长时回退 +Z
 * - 平移语义：pos 改变 → target 同位移；旋转语义：改 forward → target 等距重算
 * - 视距下限 0.1（REF `Math.max(currentDistance, 0.1)` 1:1）
 */
export function reframeCamera(
  camera: PrevisCameraPose,
  pos: [number, number, number],
  forward?: [number, number, number],
): PrevisCameraPose {
  const position = toVec3(camera.position)
  const target = toVec3(camera.target)
  const distance = Math.max(position.distanceTo(target), MIN_VIEW_DISTANCE)
  const dir = forward ? toVec3(forward) : target.sub(position)
  if (dir.lengthSq() < 1e-12) dir.set(...DEFAULT_FORWARD)
  dir.normalize()
  const nextTarget = toVec3(pos).add(dir.multiplyScalar(distance))
  return {
    position: [pos[0], pos[1], pos[2]],
    target: [nextTarget.x, nextTarget.y, nextTarget.z],
  }
}

/**
 * rig 组朝向：局部 +Z 指向 target（REF `getViewportCameraQuaternion` 1:1）。
 * 朝向与世界上方平行（俯视/仰视）时 up 退化为 +Z，避免 lookAt 退化翻转；
 * position 与 target 重合 → 单位四元数。
 */
export function getRigQuaternion(
  position: [number, number, number],
  target: [number, number, number],
): THREE.Quaternion {
  const origin = toVec3(position)
  const direction = toVec3(target).sub(origin)
  if (direction.lengthSq() === 0) return new THREE.Quaternion()

  const forward = direction.normalize()
  const up = Math.abs(forward.dot(WORLD_UP)) > 0.999 ? new THREE.Vector3(0, 0, 1) : WORLD_UP
  const matrix = new THREE.Matrix4().lookAt(origin, origin.clone().sub(forward), up)
  return new THREE.Quaternion().setFromRotationMatrix(matrix)
}
