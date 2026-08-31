"use client"

import * as React from "react"
import { RotateCcwIcon } from "lucide-react"

import { useApp } from "@/lib/store"
import { renderPrevisShot } from "@/lib/engine/previs-render"
import { isPrevisArtifact } from "@/lib/engine/previs-types"
import type { BlockingItem, WorkflowStage } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/** 与 previs-render 俯视投影保持一致：480×270 画布、48px/世界单位（z 向上） */
const SVG_W = 480
const SVG_H = 270
const PX_PER_UNIT = 48

const round2 = (v: number) => Math.round(v * 100) / 100

/** 给俯视图的角色/道具标记注入 data-bid（对应 blocking id），供命中检测与选中高亮 */
function withMarkerIds(svg: string, items: BlockingItem[]): string {
  const draggable = items.filter((b) => b.kind !== "terrain")
  let i = 0
  const re = /<g data-kind="character">|<rect data-kind="prop"/g
  return svg.replace(re, (m) =>
    i < draggable.length ? m.replace("data-kind", `data-bid="${draggable[i++].id}" data-kind`) : m,
  )
}

/**
 * 2D 布景干预：拖拽角色/道具标记 + 选中后方向键微调 + 精确坐标输入 + 重新渲染
 * （manual 干预模式专用；地形与机位视为固定，机位参数仅展示）
 */
export function PrevisBlockingEditor({
  projectId, stage, shotIndex, onDone,
}: {
  projectId: string
  stage: WorkflowStage
  shotIndex: number
  onDone: () => void
}) {
  const { dispatch } = useApp()
  const artifact = stage.artifact
  const shot = artifact && isPrevisArtifact(artifact) ? artifact.shots[shotIndex] : undefined
  const [items, setItems] = React.useState<BlockingItem[]>(shot?.blocking ?? [])
  const [selected, setSelected] = React.useState<string | null>(null)
  const [dragId, setDragId] = React.useState<string | null>(null)
  const svgBoxRef = React.useRef<HTMLDivElement | null>(null)

  const previewSvg = shot
    ? withMarkerIds(renderPrevisShot({ ...shot, blocking: items }).previewSvg, items)
    : ""

  // 选中标记高亮（每次重新注入 SVG 后同步一次；data-selected 由 style 标签描边）
  React.useEffect(() => {
    const host = svgBoxRef.current
    if (!host) return
    for (const el of Array.from(host.querySelectorAll<SVGElement>("[data-bid]"))) {
      if (el.getAttribute("data-bid") === selected) el.setAttribute("data-selected", "")
      else el.removeAttribute("data-selected")
    }
  }, [previewSvg, selected])

  if (!shot) return null

  const draggable = items.filter((b) => b.kind !== "terrain")

  /** 指针坐标 → 世界 x/z（renderPreviewSvg.project 的逆运算，限制在画布内） */
  const worldFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = svgBoxRef.current!.getBoundingClientRect()
    const px = Math.min(SVG_W, Math.max(0, ((e.clientX - rect.left) / rect.width) * SVG_W))
    const py = Math.min(SVG_H, Math.max(0, ((e.clientY - rect.top) / rect.height) * SVG_H))
    return { x: round2((px - SVG_W / 2) / PX_PER_UNIT), z: round2(1 - (py - SVG_H / 2) / PX_PER_UNIT) }
  }

  // 指针捕获设在稳定的容器 div 上（而非标记元素）：拖拽中每帧都会替换 innerHTML，
  // 捕获目标若被销毁会导致跟踪中断；容器跨渲染存活，捕获得以保持
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as Element | null
    const marker = target?.closest ? target.closest<SVGElement>("[data-bid]") : null
    const id = marker?.getAttribute("data-bid")
    if (!id) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelected(id)
    setDragId(id)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragId || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    const { x, z } = worldFromEvent(e)
    setItems((prev) => prev.map((b) => (b.id === dragId ? { ...b, position: [x, 0, z] } : b)))
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setDragId(null)
  }

  const setPosition = (id: string, axis: 0 | 2, value: number) => {
    if (!Number.isFinite(value)) return
    setItems((prev) =>
      prev.map((b) =>
        b.id === id
          ? { ...b, position: axis === 0 ? [round2(value), 0, b.position[2]] : [b.position[0], 0, round2(value)] }
          : b,
      ),
    )
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!selected) return
    const step = e.shiftKey ? 0.1 : 0.5
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }
    const d = deltas[e.key]
    if (!d) return
    e.preventDefault()
    setItems((prev) =>
      prev.map((b) =>
        b.id === selected ? { ...b, position: [round2(b.position[0] + d[0]), 0, round2(b.position[2] + d[1])] } : b,
      ),
    )
  }

  const rerender = () => {
    dispatch({ type: "UPDATE_PREVIS_BLOCKING", projectId, stageId: stage.id, shotIndex, blocking: items })
    dispatch({ type: "RERENDER_PREVIS", projectId, stageId: stage.id })
    onDone()
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <style>{`[data-bid]{cursor:grab}[data-bid][data-selected]{stroke:#dc2626;stroke-width:3}`}</style>
      <div
        ref={svgBoxRef}
        tabIndex={0}
        role="application"
        aria-label="布景俯视图编辑：拖拽角色/道具标记，或选中后用方向键微调"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        dangerouslySetInnerHTML={{ __html: previewSvg }}
        className="w-full cursor-move rounded-md border bg-background select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p className="text-[11px] text-muted-foreground">
        提示：拖动角色/道具标记调整位置；点击选中后可用方向键微调（Shift 更细）或直接输入坐标，完成后点击「重新渲染」。
      </p>
      {draggable.length > 0 && (
        <div className="flex flex-col gap-1">
          {draggable.map((b) => (
            <div
              key={b.id}
              onClick={() => setSelected(selected === b.id ? null : b.id)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1",
                selected === b.id ? "border-primary/60 bg-primary/5" : "border-border/60",
              )}
            >
              <span className="w-16 shrink-0 truncate text-[11px] text-muted-foreground">
                {b.kind === "character" ? "角色" : "道具"} · {b.name}
              </span>
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                X
                <input
                  type="number"
                  step={0.5}
                  value={b.position[0]}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setPosition(b.id, 0, Number(e.target.value))}
                  className="h-6 w-14 rounded border bg-background px-1 text-center text-xs tabular-nums"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                Z
                <input
                  type="number"
                  step={0.5}
                  value={b.position[2]}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setPosition(b.id, 2, Number(e.target.value))}
                  className="h-6 w-14 rounded border bg-background px-1 text-center text-xs tabular-nums"
                />
              </label>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          取消
        </Button>
        <Button size="sm" onClick={rerender}>
          <RotateCcwIcon className="size-3.5" /> 重新渲染
        </Button>
      </div>
    </div>
  )
}
