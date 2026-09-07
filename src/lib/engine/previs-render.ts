import type { BlockingItem, PrevisShot } from "@/lib/types"

const W = 480
const H = 270
/** rotation 单位为度 → 弧度换算（三角函数输入） */
const DEG = Math.PI / 180

/** 默认机位（与 makePrevisShot 一致）：正面平视，target 落在地形中心 */
const DEFAULT_CAMERA: PrevisShot["camera"] = { position: [0, 2, 8], target: [0, 1, 0], fov: 45 }

/** 四舍五入到 0.1（并归一 -0 → 0），供 SVG 属性输出 */
function p1(v: number): number {
  const r = Math.round(v * 10) / 10
  return r === 0 ? 0 : r
}

/** 俯视投影：x/z 平面 → 画布坐标（z 向上，机位在下方；y 只参与视距/深度，不位移投影） */
function project(item: BlockingItem): { x: number; y: number } {
  const [x, , z] = item.position
  return { x: W / 2 + x * 48, y: H / 2 + (1 - z) * 48 }
}

/** 任意三维点 → 画布坐标（复用与布景一致的 x/z 投影） */
function projectPoint(pos: readonly [number, number, number]): { x: number; y: number } {
  return { x: W / 2 + pos[0] * 48, y: H / 2 + (1 - pos[2]) * 48 }
}

/** 镜头视锥：顶点 = 机位投影，沿 机位→目标 方向展开；底边中点落在目标投影处，半宽随 FOV 与视距 */
export function frustumPoints(camera: PrevisShot["camera"]): string {
  const apex = projectPoint(camera.position)
  const target = projectPoint(camera.target)
  const dx = target.x - apex.x
  const dy = target.y - apex.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return `${apex.x},${apex.y} ${apex.x - 80},${apex.y - 80} ${apex.x + 80},${apex.y - 80}`
  const ux = dx / len
  const uy = dy / len
  const halfWidth = len * Math.tan((camera.fov * Math.PI) / 360)
  const px = -uy * halfWidth
  const py = ux * halfWidth
  return [
    `${apex.x},${apex.y}`,
    `${p1(target.x - px)},${p1(target.y - py)}`,
    `${p1(target.x + px)},${p1(target.y + py)}`,
  ].join(" ")
}

/**
 * 给布景俯视图的角色/道具标记注入 data-bid（对应 blocking id），供编辑器命中检测与拖拽。
 * 标记按 blocking 数组顺序绘制，故按出现顺序与可拖拽项（排除地形）一一对应。
 */
export function injectMarkerIds(svg: string, items: BlockingItem[]): string {
  const draggable = items.filter((b) => b.kind !== "terrain")
  let i = 0
  const re = /<[^>]*?data-kind="(?:character|prop)"[^>]*>/g
  return svg.replace(re, (m) =>
    i < draggable.length ? m.replace('data-kind', `data-bid="${draggable[i++].id}" data-kind`) : m,
  )
}

/** 视距（画家算法排序键 / 深度灰度归一）：项中心世界点 (x, y, z) 到机位 [0,2,8] 的 3D 距离，y 真实参与 */
function viewDist(item: BlockingItem): number {
  const [x, y, z] = item.position
  const [cx, cy, cz] = DEFAULT_CAMERA.position
  return Math.hypot(x - cx, y - cy, z - cz)
}

/** 深度灰度：近亮(240) 远暗(60)，按视距归一化 */
function depthFill(dist: number, maxDist: number): number {
  return Math.round(240 - (dist / maxDist) * 180)
}

/**
 * 字符/道具足迹（俯视，v2）：中心投影 + 半宽/半深 = 基准（角色 12 / 道具 10）× scale，绕中心旋转 rotation[1]（度）。
 * 足迹局部尺寸取 scale.x/scale.z（未旋转的局部 w×d），由 SVG transform 精确呈现非等比旋转。
 */
function footprint(item: BlockingItem): { cx: number; cy: number; halfW: number; halfD: number; deg: number } {
  const { x, y } = project(item)
  const [sx, , sz] = item.scale
  const base = item.kind === "character" ? 12 : 10
  return { cx: x, cy: y, halfW: base * sx, halfD: base * sz, deg: item.rotation[1] }
}

/** 字符/道具标记矩形：旋转圆角矩形（填充/描边按图类传入），data-kind 恰一个元素、按 blocking 顺序输出 */
function itemRect(item: BlockingItem, style: { fill: string; stroke?: string; strokeWidth?: number }): string {
  const { cx, cy, halfW, halfD, deg } = footprint(item)
  const stroke = style.stroke
    ? ` stroke="${style.stroke}"${style.strokeWidth ? ` stroke-width="${style.strokeWidth}"` : ""}`
    : ""
  return (
    `<rect x="${p1(cx - halfW)}" y="${p1(cy - halfD)}" width="${p1(halfW * 2)}" height="${p1(halfD * 2)}"` +
    ` rx="${item.kind === "character" ? 6 : 3}" fill="${style.fill}"${stroke} transform="rotate(${p1(deg)} ${p1(cx)} ${p1(cy)})" data-kind="${item.kind}"/>`
  )
}

/** 地形固定大圆角矩形（不随 rotation/scale 变形） */
function terrainRect(item: BlockingItem, style: { fill: string; stroke?: string; strokeWidth?: number }): string {
  const { x, y } = project(item)
  const stroke = style.stroke
    ? ` stroke="${style.stroke}"${style.strokeWidth ? ` stroke-width="${style.strokeWidth}"` : ""}`
    : ""
  return `<rect x="${x - 96}" y="${y - 96}" width="192" height="192" rx="8" fill="${style.fill}"${stroke} data-kind="terrain"/>`
}

/** 角色朝向线：从足迹中心沿 rotation[1]（度）方向伸出 16px（屏幕 y 向下 → -cos） */
function headingLine(item: BlockingItem, stroke: string): string {
  const { x, y } = project(item)
  const rad = item.rotation[1] * DEG
  return (
    `<line x1="${p1(x)}" y1="${p1(y)}" x2="${p1(x + Math.sin(rad) * 16)}" y2="${p1(y - Math.cos(rad) * 16)}"` +
    ` stroke="${stroke}" stroke-width="2"/>`
  )
}

/** 布景俯视图：地形底图 + 角色旋转足迹(带朝向线) + 道具旋转小矩形 + 镜头视锥（随机位/目标变化） */
export function renderPreviewSvg(
  blocking: BlockingItem[],
  camera: PrevisShot["camera"] = DEFAULT_CAMERA,
): string {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#f4f4f5"/>`,
  ]
  for (const b of blocking) {
    if (b.kind === "terrain") {
      parts.push(terrainRect(b, { fill: "#e4e4e7", stroke: "#a1a1aa" }))
    } else if (b.kind === "character") {
      parts.push(itemRect(b, { fill: "#6366f1" }), headingLine(b, "#fff"))
    } else {
      parts.push(itemRect(b, { fill: "#f59e0b" }))
    }
  }
  // 镜头视锥（顶点 = 机位投影，指向 target 投影）
  parts.push(
    `<polygon points="${frustumPoints(camera)}" fill="none" stroke="#71717a" stroke-dasharray="4 3" data-kind="frustum"/>`,
  )
  parts.push(`</svg>`)
  return parts.join("")
}

/** 深度图：画家算法按 3D 视距远→近绘制，距离灰度渐变 */
export function renderDepthSvg(blocking: BlockingItem[]): string {
  const sorted = [...blocking].sort((a, b) => viewDist(b) - viewDist(a))
  const maxDist = Math.max(...blocking.map(viewDist), 12)
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#3c3c3c"/>`,
  ]
  for (const b of sorted) {
    const g = depthFill(viewDist(b), maxDist)
    const fill = `rgb(${g},${g},${g})`
    if (b.kind === "terrain") {
      parts.push(terrainRect(b, { fill }))
    } else if (b.kind === "character") {
      parts.push(itemRect(b, { fill }), headingLine(b, "#fff"))
    } else {
      parts.push(itemRect(b, { fill }))
    }
  }
  parts.push(`</svg>`)
  return parts.join("")
}

/** 边缘图：轮廓线段 + 遮挡断裂线（角色/道具描边 + 朝向线，地形外框） */
export function renderEdgeSvg(blocking: BlockingItem[]): string {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#18181b"/>`,
  ]
  for (const b of blocking) {
    if (b.kind === "terrain") {
      parts.push(terrainRect(b, { fill: "none", stroke: "#f4f4f5", strokeWidth: 2 }))
    } else if (b.kind === "character") {
      parts.push(itemRect(b, { fill: "none", stroke: "#f4f4f5", strokeWidth: 2 }), headingLine(b, "#f4f4f5"))
    } else {
      parts.push(itemRect(b, { fill: "none", stroke: "#f4f4f5", strokeWidth: 2 }))
    }
  }
  parts.push(`</svg>`)
  return parts.join("")
}

/** 渲染一镜全部三图，返回填充后的新 PrevisShot */
export function renderPrevisShot(shot: PrevisShot): PrevisShot {
  return {
    ...shot,
    previewSvg: renderPreviewSvg(shot.blocking, shot.camera),
    depthSvg: renderDepthSvg(shot.blocking),
    edgeSvg: renderEdgeSvg(shot.blocking),
  }
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
