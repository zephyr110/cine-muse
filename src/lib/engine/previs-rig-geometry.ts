/**
 * 机位 rig 线框几何（纯数值表，无 three / React / DOM 依赖）。
 *
 * 自 previs-3d-viewport 抽出（T5 校准值，REF SceneRoot.tsx 逐值移植），以便表测试
 * （previs-rig-geometry.test.ts）锁定发射值；视口 buildCameraRig 仅消费，不再重定义。
 *   - cameraBodyWireframeLines：盒体 12 棱 + 镜头倒锥 6 线 + 后部双圆盘 2 线 = 20 线
 *   - cameraFrustumLines：镜头尖 → 16:9 远帧（4 棱 + 远帧 4 边 = 8 段）
 *   - cameraHitArea：全身线框包围盒 + CAM_HIT_PADDING（中心 / 尺寸）
 */

// —— 机位 rig 线框常量（REF SceneRoot.tsx 逐值移植；VIEWPORT_CAMERA_VISUAL_SCALE = 0.35） ——
/** REF VIEWPORT_CAMERA_VISUAL_SCALE */
export const CAM_SCALE = 0.35
/** REF VIEWPORT_CAMERA_LINE */
export const CAM_LINE_COLOR = 0xa9d8ff
/** REF VIEWPORT_CAMERA_LINE_OPACITY */
export const CAM_LINE_OPACITY = 0.92
/** REF VIEWPORT_CAMERA_HIT_PADDING */
const CAM_HIT_PADDING = 0.06
/** REF VIEWPORT_CAMERA_BODY_CENTER */
const CAM_BODY_CENTER: [number, number, number] = [0, 0, -0.52 * CAM_SCALE]
/** REF VIEWPORT_CAMERA_BODY_SIZE */
const CAM_BODY_SIZE: [number, number, number] = [0.4 * CAM_SCALE, 0.4 * CAM_SCALE, 1 * CAM_SCALE]
/** REF VIEWPORT_CAMERA_BODY_FRONT_Z = center.z + size.z / 2 */
const CAM_BODY_FRONT_Z = CAM_BODY_CENTER[2] + CAM_BODY_SIZE[2] / 2
/** REF VIEWPORT_CAMERA_LENS_TIP（局部 +Z 为机位前方） */
const CAM_LENS_TIP: [number, number, number] = [0, 0, 0.2 * CAM_SCALE]
/** REF VIEWPORT_CAMERA_FRUSTUM_DEPTH = 5.2 × scale */
const CAM_FRUSTUM_DEPTH = 5.2 * CAM_SCALE
/** REF VIEWPORT_CAMERA_FRUSTUM_FRAME_WIDTH = 3.2 × scale */
const CAM_FRUSTUM_FRAME_WIDTH = 3.2 * CAM_SCALE
/** REF VIEWPORT_CAMERA_ASPECT */
const CAM_ASPECT = 16 / 9

export type WirePoint = [number, number, number]

/** REF createBoxWireframeLines：盒体 8 角点 → 12 棱（bbl/bbr/btl/btr/fbl/fbr/ftl/ftr 顺序同 REF） */
function boxWireframeLines(center: WirePoint, size: WirePoint): WirePoint[][] {
  const [cx, cy, cz] = center
  const [width, height, depth] = size
  const x0 = cx - width / 2
  const x1 = cx + width / 2
  const y0 = cy - height / 2
  const y1 = cy + height / 2
  const z0 = cz - depth / 2
  const z1 = cz + depth / 2
  const c: Record<string, WirePoint> = {
    bbl: [x0, y0, z0], bbr: [x1, y0, z0], btl: [x0, y1, z0], btr: [x1, y1, z0],
    fbl: [x0, y0, z1], fbr: [x1, y0, z1], ftl: [x0, y1, z1], ftr: [x1, y1, z1],
  }
  return [
    [c.bbl, c.bbr], [c.bbr, c.btr], [c.btr, c.btl], [c.btl, c.bbl],
    [c.fbl, c.fbr], [c.fbr, c.ftr], [c.ftr, c.ftl], [c.ftl, c.fbl],
    [c.bbl, c.fbl], [c.bbr, c.fbr], [c.btr, c.ftr], [c.btl, c.ftl],
  ]
}

/** REF createCircleWireframeLine：闭合圆环（segments+1 点，末点回起点） */
function circleWireframeLine({
  center,
  radius,
  segments = 32,
  plane = "xy",
}: {
  center: WirePoint
  radius: number
  segments?: number
  plane?: "xy" | "xz" | "yz"
}): WirePoint[] {
  const [cx, cy, cz] = center
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / segments
    const a = Math.cos(angle) * radius
    const b = Math.sin(angle) * radius
    if (plane === "xz") return [cx + a, cy, cz + b] as WirePoint
    if (plane === "yz") return [cx, cy + a, cz + b] as WirePoint
    return [cx + a, cy + b, cz] as WirePoint
  })
}

/** REF createInvertedTetrahedronLensWireframeLines：镜头倒锥——后小方口（0.10 半宽）→ 前大方口（0.25/0.2）
 *  + 4 条连接棱；两端口各成闭环。 */
function lensWireframeLines(): WirePoint[][] {
  const backTopLeft: WirePoint = [-0.10 * CAM_SCALE, 0.10 * CAM_SCALE, CAM_BODY_FRONT_Z]
  const backTopRight: WirePoint = [0.10 * CAM_SCALE, 0.10 * CAM_SCALE, CAM_BODY_FRONT_Z]
  const backBottomRight: WirePoint = [0.10 * CAM_SCALE, -0.10 * CAM_SCALE, CAM_BODY_FRONT_Z]
  const backBottomLeft: WirePoint = [-0.10 * CAM_SCALE, -0.10 * CAM_SCALE, CAM_BODY_FRONT_Z]
  const frontTopLeft: WirePoint = [-0.25 * CAM_SCALE, 0.2 * CAM_SCALE, CAM_LENS_TIP[2]]
  const frontTopRight: WirePoint = [0.25 * CAM_SCALE, 0.2 * CAM_SCALE, CAM_LENS_TIP[2]]
  const frontBottomRight: WirePoint = [0.25 * CAM_SCALE, -0.2 * CAM_SCALE, CAM_LENS_TIP[2]]
  const frontBottomLeft: WirePoint = [-0.25 * CAM_SCALE, -0.2 * CAM_SCALE, CAM_LENS_TIP[2]]
  return [
    [backTopLeft, backTopRight, backBottomRight, backBottomLeft, backTopLeft],
    [frontTopLeft, frontTopRight, frontBottomRight, frontBottomLeft, frontTopLeft],
    [backTopLeft, frontTopLeft],
    [backTopRight, frontTopRight],
    [backBottomRight, frontBottomRight],
    [backBottomLeft, frontBottomLeft],
  ]
}

/** REF getViewportCameraBodyWireframeLines：盒体 12 线 + 镜头倒锥 + 后部双圆盘（yz 平面） */
export function cameraBodyWireframeLines(): WirePoint[][] {
  return [
    ...boxWireframeLines(CAM_BODY_CENTER, CAM_BODY_SIZE),
    ...lensWireframeLines(),
    circleWireframeLine({
      center: [0, 0.44 * CAM_SCALE, -0.78 * CAM_SCALE],
      radius: 0.21 * CAM_SCALE,
      plane: "yz",
    }),
    circleWireframeLine({
      center: [0, 0.44 * CAM_SCALE, -0.34 * CAM_SCALE],
      radius: 0.21 * CAM_SCALE,
      plane: "yz",
    }),
  ]
}

/** REF getViewportCameraFrustumLines：镜头尖 → 16:9 远帧（4 棱 + 远帧 4 边；宽 3.2×scale @ depth 1.82） */
export function cameraFrustumLines(): [WirePoint, WirePoint][] {
  const halfWidth = CAM_FRUSTUM_FRAME_WIDTH / 2
  const halfHeight = CAM_FRUSTUM_FRAME_WIDTH / CAM_ASPECT / 2
  const topLeft: WirePoint = [-halfWidth, halfHeight, CAM_FRUSTUM_DEPTH]
  const topRight: WirePoint = [halfWidth, halfHeight, CAM_FRUSTUM_DEPTH]
  const bottomRight: WirePoint = [halfWidth, -halfHeight, CAM_FRUSTUM_DEPTH]
  const bottomLeft: WirePoint = [-halfWidth, -halfHeight, CAM_FRUSTUM_DEPTH]
  return [
    [CAM_LENS_TIP, topLeft],
    [CAM_LENS_TIP, topRight],
    [CAM_LENS_TIP, bottomRight],
    [CAM_LENS_TIP, bottomLeft],
    [topLeft, topRight],
    [topRight, bottomRight],
    [bottomRight, bottomLeft],
    [bottomLeft, topLeft],
  ]
}

/** REF getViewportCameraHitArea：全身线框包围盒 + padding（中心 / 尺寸） */
export function cameraHitArea(): { args: WirePoint; position: WirePoint } {
  const points = cameraBodyWireframeLines().flat()
  const axis = (i: 0 | 1 | 2) => points.map((p) => p[i])
  const min = [Math.min(...axis(0)), Math.min(...axis(1)), Math.min(...axis(2))]
  const max = [Math.max(...axis(0)), Math.max(...axis(1)), Math.max(...axis(2))]
  return {
    args: [
      max[0] - min[0] + CAM_HIT_PADDING * 2,
      max[1] - min[1] + CAM_HIT_PADDING * 2,
      max[2] - min[2] + CAM_HIT_PADDING * 2,
    ],
    position: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  }
}
