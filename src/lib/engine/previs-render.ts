import type { BlockingItem, PrevisShot } from "@/lib/types"

const W = 480
const H = 270

/** 默认机位（与 makePrevisShot 一致）：正面平视，target 落在地形中心 */
const DEFAULT_CAMERA: PrevisShot["camera"] = { position: [0, 2, 8], target: [0, 1, 0], fov: 45 }

/** 俯视投影：x/z 平面 → 画布坐标（z 向上，机位在下方） */
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
  const r1 = (v: number) => Math.round(v * 10) / 10
  return [
    `${apex.x},${apex.y}`,
    `${r1(target.x - px)},${r1(target.y - py)}`,
    `${r1(target.x + px)},${r1(target.y + py)}`,
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

/** 视距（画家算法排序键）：近大远小、近亮远暗 */
function viewDist(item: BlockingItem): number {
  const [, y, z] = item.position
  return Math.hypot(y - 2, z - 8) // 机位 [0,2,8]
}

/** 深度灰度：近亮(240) 远暗(60)，按视距归一化 */
function depthFill(dist: number, maxDist: number): number {
  return Math.round(240 - (dist / maxDist) * 180)
}

/** 布景俯视图：地形底图 + 角色圆点(带朝向箭头) + 道具方块 + 镜头视锥（随机位/目标变化） */
export function renderPreviewSvg(
  blocking: BlockingItem[],
  camera: PrevisShot["camera"] = DEFAULT_CAMERA,
): string {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#f4f4f5"/>`,
  ]
  for (const b of blocking) {
    const { x, y } = project(b)
    if (b.kind === "terrain") {
      parts.push(`<rect x="${x - 96}" y="${y - 96}" width="192" height="192" rx="8" fill="#e4e4e7" stroke="#a1a1aa" data-kind="terrain"/>`)
    } else if (b.kind === "character") {
      const dx = Math.sin(b.rotation[1]) * 16
      const dy = -Math.cos(b.rotation[1]) * 16
      parts.push(
        `<g data-kind="character"><circle cx="${x}" cy="${y}" r="12" fill="#6366f1"/><line x1="${x}" y1="${y}" x2="${x + dx}" y2="${y + dy}" stroke="#fff" stroke-width="2"/></g>`,
      )
    } else {
      parts.push(`<rect x="${x - 10}" y="${y - 10}" width="20" height="20" rx="3" fill="#f59e0b" data-kind="prop"/>`)
    }
  }
  // 镜头视锥（顶点 = 机位投影，指向 target 投影）
  parts.push(
    `<polygon points="${frustumPoints(camera)}" fill="none" stroke="#71717a" stroke-dasharray="4 3" data-kind="frustum"/>`,
  )
  parts.push(`</svg>`)
  return parts.join("")
}

/** 深度图：画家算法按视距远→近绘制，距离灰度渐变 */
export function renderDepthSvg(blocking: BlockingItem[]): string {
  const sorted = [...blocking].sort((a, b) => viewDist(b) - viewDist(a))
  const maxDist = Math.max(...blocking.map(viewDist), 12)
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#3c3c3c"/>`,
  ]
  for (const b of sorted) {
    const { x, y } = project(b)
    const fill = depthFill(viewDist(b), maxDist)
    if (b.kind === "terrain") {
      parts.push(`<rect x="${x - 96}" y="${y - 96}" width="192" height="192" rx="8" fill="rgb(${fill},${fill},${fill})" data-kind="terrain"/>`)
    } else if (b.kind === "character") {
      parts.push(`<circle cx="${x}" cy="${y}" r="12" fill="rgb(${fill},${fill},${fill})" data-kind="character"/>`)
    } else {
      parts.push(`<rect x="${x - 10}" y="${y - 10}" width="20" height="20" rx="3" fill="rgb(${fill},${fill},${fill})" data-kind="prop"/>`)
    }
  }
  parts.push(`</svg>`)
  return parts.join("")
}

/** 边缘图：轮廓线段 + 遮挡断裂线（角色/道具描边，地形外框） */
export function renderEdgeSvg(blocking: BlockingItem[]): string {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#18181b"/>`,
  ]
  for (const b of blocking) {
    const { x, y } = project(b)
    if (b.kind === "terrain") {
      parts.push(`<rect x="${x - 96}" y="${y - 96}" width="192" height="192" rx="8" fill="none" stroke="#f4f4f5" stroke-width="2" data-kind="terrain"/>`)
    } else if (b.kind === "character") {
      parts.push(`<circle cx="${x}" cy="${y}" r="12" fill="none" stroke="#f4f4f5" stroke-width="2" data-kind="character"/><line x1="${x - 12}" y1="${y}" x2="${x + 12}" y2="${y}" stroke="#f4f4f5" stroke-width="2"/>`)
    } else {
      parts.push(`<rect x="${x - 10}" y="${y - 10}" width="20" height="20" rx="3" fill="none" stroke="#f4f4f5" stroke-width="2" data-kind="prop"/>`)
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
