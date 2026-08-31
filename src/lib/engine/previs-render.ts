import type { BlockingItem, PrevisShot } from "@/lib/types"

const W = 480
const H = 270

/** 俯视投影：x/z 平面 → 画布坐标（z 向上，机位在下方） */
function project(item: BlockingItem): { x: number; y: number } {
  const [x, , z] = item.position
  return { x: W / 2 + x * 48, y: H / 2 + (1 - z) * 48 }
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

/** 布景俯视图：地形底图 + 角色圆点(带朝向箭头) + 道具方块 + 镜头视锥 */
export function renderPreviewSvg(blocking: BlockingItem[]): string {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#f4f4f5"/>`,
  ]
  for (const b of blocking) {
    const { x, y } = project(b)
    if (b.kind === "terrain") {
      parts.push(`<rect x="${x - 96}" y="${y - 96}" width="192" height="192" rx="8" fill="#e4e4e7" stroke="#a1a1aa" data-kind="terrain"/>`)
    } else if (b.kind === "character") {
      const dx = Math.sin(b.rotationY) * 16
      const dy = -Math.cos(b.rotationY) * 16
      parts.push(
        `<g data-kind="character"><circle cx="${x}" cy="${y}" r="12" fill="#6366f1"/><line x1="${x}" y1="${y}" x2="${x + dx}" y2="${y + dy}" stroke="#fff" stroke-width="2"/></g>`,
      )
    } else {
      parts.push(`<rect x="${x - 10}" y="${y - 10}" width="20" height="20" rx="3" fill="#f59e0b" data-kind="prop"/>`)
    }
  }
  // 镜头视锥（从机位指向布景）
  parts.push(
    `<polygon points="${W / 2},${H + 20} ${W / 2 - 90},${H / 2 + 10} ${W / 2 + 90},${H / 2 + 10}" fill="none" stroke="#71717a" stroke-dasharray="4 3" data-kind="frustum"/>`,
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
    previewSvg: renderPreviewSvg(shot.blocking),
    depthSvg: renderDepthSvg(shot.blocking),
    edgeSvg: renderEdgeSvg(shot.blocking),
  }
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
