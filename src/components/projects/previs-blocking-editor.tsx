"use client"

import * as React from "react"
import { CameraIcon, EyeIcon, RotateCcwIcon } from "lucide-react"

import { useApp } from "@/lib/store"
import { injectMarkerIds, renderPrevisShot, svgDataUrl } from "@/lib/engine/previs-render"
import { isPrevisArtifact } from "@/lib/engine/previs-types"
import type { BlockingItem, PrevisShot, WorkflowStage } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { PrevisViewport, type CaptureResult, type PrevisViewportHandle } from "./previs-3d-viewport"

/** 与 previs-render 俯视投影一致：480×270 画布、48px/世界单位（z 向上） */
const SVG_W = 480
const SVG_H = 270
const PX_PER_UNIT = 48

/** 可编辑范围：布景项与拖拽的"画布内钳制"一致；机位允许离画布更远 */
const X_RANGE = { min: -SVG_W / 2 / PX_PER_UNIT, max: SVG_W / 2 / PX_PER_UNIT } // [-5, 5]
const Z_RANGE = { min: 1 - SVG_H / 2 / PX_PER_UNIT, max: 1 + SVG_H / 2 / PX_PER_UNIT } // [-1.8125, 3.8125]
const CAM_RANGE = { min: -20, max: 20 }
const FOV_RANGE = { min: 5, max: 150 }

const round2 = (v: number) => Math.round(v * 100) / 100
const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v))

/**
 * 数值输入（带字符串缓冲）：空输入不提交（避免 Number("")===0 钉到 0），
 * 非法输入失焦后回显原值；提交值由父级按范围钳制。
 */
function NumField({
  value, step, onCommit, ariaLabel,
}: {
  value: number
  step: number
  onCommit: (v: number) => void
  ariaLabel?: string
}) {
  const [text, setText] = React.useState(String(value))
  const [focused, setFocused] = React.useState(false)
  const [lastValue, setLastValue] = React.useState(value)
  // 外部值变化且未在编辑中 → 同步缓冲（渲染期派生状态，React 官方模式）
  if (!focused && value !== lastValue) {
    setLastValue(value)
    setText(String(value))
  }

  return (
    <input
      type="number"
      step={step}
      value={focused ? text : String(value)}
      aria-label={ariaLabel}
      onFocus={() => {
        setFocused(true)
        setText(String(value))
      }}
      onChange={(e) => {
        setText(e.target.value)
        if (e.target.value === "") return
        const n = Number(e.target.value)
        if (Number.isFinite(n)) onCommit(n)
      }}
      onBlur={() => {
        setFocused(false)
        const n = Number(text)
        if (text === "" || !Number.isFinite(n)) return // 无效 → 派生状态回显原值
        onCommit(n)
      }}
      className="h-6 w-14 rounded border bg-background px-1 text-center text-xs tabular-nums"
    />
  )
}

/** 单镜头编辑：拖拽/选中微调/坐标输入 + 机位参数 + 重新渲染；inline 堆叠 / fullscreen 三栏 */
function BlockingShotEditor({
  projectId, stage, shotIndex, shot, shotsCount, onShotIndexChange, onDone, variant = "inline",
}: {
  projectId: string
  stage: WorkflowStage
  shotIndex: number
  shot: PrevisShot
  shotsCount: number
  onShotIndexChange: (index: number) => void
  onDone: () => void
  variant?: "inline" | "fullscreen"
}) {
  const { dispatch } = useApp()
  const [items, setItems] = React.useState<BlockingItem[]>(shot.blocking)
  const [camera, setCamera] = React.useState<PrevisShot["camera"]>(shot.camera)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [mapTab, setMapTab] = React.useState<"preview" | "depth" | "edge">("preview")
  const [centerTab, setCenterTab] = React.useState<"view3d" | "preview" | "depth" | "edge">("view3d")
  const [captured, setCaptured] = React.useState<CaptureResult | null>(null)
  const [viewFromCamera, setViewFromCamera] = React.useState(false)
  const viewportRef = React.useRef<PrevisViewportHandle | null>(null)
  const svgBoxRef = React.useRef<HTMLDivElement | null>(null)

  const rendered = renderPrevisShot({ ...shot, blocking: items, camera })
  const previewSvg = injectMarkerIds(rendered.previewSvg, items)
  const depthSvg = rendered.depthSvg
  const edgeSvg = rendered.edgeSvg

  // 选中标记高亮（每次重新注入 SVG 后同步一次；data-selected 由 style 标签描边）
  React.useEffect(() => {
    const host = svgBoxRef.current
    if (!host) return
    for (const el of Array.from(host.querySelectorAll<SVGElement>("[data-bid]"))) {
      if (el.getAttribute("data-bid") === selected) el.setAttribute("data-selected", "")
      else el.removeAttribute("data-selected")
    }
  }, [previewSvg, selected, mapTab])

  const draggable = items.filter((b) => b.kind !== "terrain")

  /** 指针坐标 → 世界 x/z（renderPreviewSvg.project 的逆运算，限制在画布内）。
   *  容器宽高比可能偏离 16:9（如超宽屏下 max-h-full 钳制）：按 SVG 实际
   *  适配后的内嵌矩形（letterbox 居中）映射，而非整个容器，保证任意窗口比例下精确。 */
  const worldFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = svgBoxRef.current!.getBoundingClientRect()
    const scale = Math.min(rect.width / SVG_W, rect.height / SVG_H)
    const fitW = SVG_W * scale
    const fitH = SVG_H * scale
    const offsetX = (rect.width - fitW) / 2
    const offsetY = (rect.height - fitH) / 2
    const px = Math.min(SVG_W, Math.max(0, ((e.clientX - rect.left - offsetX) / fitW) * SVG_W))
    const py = Math.min(SVG_H, Math.max(0, ((e.clientY - rect.top - offsetY) / fitH) * SVG_H))
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
    const range = axis === 0 ? X_RANGE : Z_RANGE
    setItems((prev) =>
      prev.map((b) =>
        b.id === id
          ? {
              ...b,
              position:
                axis === 0
                  ? [round2(clamp(value, range)), 0, b.position[2]]
                  : [b.position[0], 0, round2(clamp(value, range))],
            }
          : b,
      ),
    )
  }

  const setCameraAxis = (axis: "position" | "target", idx: 0 | 1 | 2, value: number) => {
    if (!Number.isFinite(value)) return
    const next: [number, number, number] = [...camera[axis]] as [number, number, number]
    next[idx] = round2(clamp(value, CAM_RANGE))
    setCamera(axis === "position" ? { ...camera, position: next } : { ...camera, target: next })
  }

  const setCameraFov = (value: number) => {
    if (!Number.isFinite(value)) return
    setCamera({ ...camera, fov: round2(clamp(value, FOV_RANGE)) })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!selected || mapTab !== "preview") return
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
        b.id === selected
          ? {
              ...b,
              position: [
                round2(clamp(b.position[0] + d[0], X_RANGE)),
                0,
                round2(clamp(b.position[2] + d[1], Z_RANGE)),
              ],
            }
          : b,
      ),
    )
  }

  const rerender = () => {
    dispatch({ type: "UPDATE_PREVIS_BLOCKING", projectId, stageId: stage.id, shotIndex, blocking: items })
    dispatch({ type: "UPDATE_PREVIS_CAMERA", projectId, stageId: stage.id, shotIndex, camera })
    // 3D 模式：从场景真实导出三图（深度/边缘为实际几何渲染）
    if (variant === "fullscreen") {
      const maps = viewportRef.current?.captureMaps()
      if (maps?.depthUrl) {
        dispatch({ type: "UPDATE_PREVIS_MAPS", projectId, stageId: stage.id, shotIndex, maps })
        setCaptured(maps)
      }
    }
    dispatch({ type: "RERENDER_PREVIS", projectId, stageId: stage.id, now: new Date().toISOString() })
    if (variant === "inline") onDone()
  }

  // —— 布局区块：inline 堆叠、fullscreen 三栏，共用同一交互逻辑 ——
  const canvasEl = (
    <div
      ref={svgBoxRef}
      id="previs-canvas"
      tabIndex={0}
      role="application"
      aria-label="布景俯视图编辑：拖拽角色/道具标记，或选中后用方向键微调"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      dangerouslySetInnerHTML={{ __html: mapTab === "preview" ? previewSvg : mapTab === "depth" ? depthSvg : edgeSvg }}
      className={cn(
        "aspect-video w-full max-w-full cursor-move rounded-md border bg-background select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
        variant === "fullscreen" && "max-h-full",
      )}
    />
  )

  // 中央工具栏：3D 视图 / 导出三图切换 + 从机位看
  const centerTabsEl = (
    <div className="flex items-center gap-1.5">
      {(
        [
          ["view3d", "3D 视图"],
          ["preview", "布景"],
          ["depth", "深度"],
          ["edge", "边缘"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setCenterTab(key)}
          className={cn(
            "rounded-md border px-2 py-1 text-xs transition-colors",
            centerTab === key
              ? "border-primary/60 bg-primary/10 font-medium"
              : "border-border/60 text-muted-foreground hover:border-primary/30",
          )}
        >
          {label}
        </button>
      ))}
      <Button
        size="sm"
        variant="ghost"
        className={cn("ml-auto gap-1 text-xs", viewFromCamera && "border border-primary/40 bg-primary/5 text-primary")}
        onClick={() => setViewFromCamera((v) => !v)}
      >
        <EyeIcon className="size-3.5" /> 从机位看
      </Button>
    </div>
  )

  const itemsEl = (
    <div className="flex flex-col gap-1">
      {variant === "fullscreen" && (
        <p className="text-[11px] font-medium text-muted-foreground">布景项（点击选中，方向键微调）</p>
      )}
      {draggable.length > 0 ? (
        draggable.map((b) => (
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
              <NumField
                value={b.position[0]}
                step={0.5}
                onCommit={(v) => setPosition(b.id, 0, v)}
                ariaLabel={`${b.name} X 坐标`}
              />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              Z
              <NumField
                value={b.position[2]}
                step={0.5}
                onCommit={(v) => setPosition(b.id, 2, v)}
                ariaLabel={`${b.name} Z 坐标`}
              />
            </label>
          </div>
        ))
      ) : variant === "fullscreen" ? (
        <p className="text-[11px] text-muted-foreground">无可拖拽的布景项</p>
      ) : null}
    </div>
  )

  const cameraEl = (
    <div className="rounded-md border border-border/60 p-2">
      <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <CameraIcon className="size-3" /> 机位参数（视锥随目标实时变化）
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-7">
        {(["position", "target"] as const).map((axis) =>
          (["x", "y", "z"] as const).map((letter, idx) => (
            <label key={`${axis}-${letter}`} className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              {axis === "position" ? "机位" : "目标"} {letter.toUpperCase()}
              <NumField
                value={camera[axis][idx as 0 | 1 | 2]}
                step={0.5}
                onCommit={(v) => setCameraAxis(axis, idx as 0 | 1 | 2, v)}
                ariaLabel={`${axis === "position" ? "机位" : "目标"} ${letter.toUpperCase()}`}
              />
            </label>
          )),
        )}
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          FOV（度）
          <NumField value={camera.fov} step={5} onCommit={setCameraFov} ariaLabel="视野角度 FOV" />
        </label>
      </div>
    </div>
  )

  const actionsEl = (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={onDone}>
        取消
      </Button>
      <Button size="sm" onClick={rerender}>
        <RotateCcwIcon className="size-3.5" /> 重新渲染
      </Button>
    </div>
  )

  const shotSelectorEl = shotsCount > 1 && (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: shotsCount }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onShotIndexChange(i)}
          className={cn(
            "rounded-md border px-2 py-1 text-xs transition-colors",
            i === shotIndex
              ? "border-primary/60 bg-primary/10 font-medium"
              : "border-border/60 text-muted-foreground hover:border-primary/30",
          )}
        >
          镜头 {i + 1}
        </button>
      ))}
    </div>
  )

  const styleEl = (
    <style>{`[data-bid]{cursor:grab}[data-bid][data-selected]{stroke:#dc2626;stroke-width:3}#previs-canvas svg{width:100%!important;height:100%!important;display:block}`}</style>
  )

  if (variant === "fullscreen") {
    return (
      <>
        {styleEl}
        <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)_280px] gap-4">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          {shotSelectorEl}
          {itemsEl}
        </div>
        <div className="flex min-h-0 flex-col gap-3">
          {centerTabsEl}
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-background">
            {centerTab === "view3d" ? (
              <PrevisViewport
                ref={viewportRef}
                items={items}
                camera={camera}
                selectedId={selected}
                viewFromCamera={viewFromCamera}
                onSelect={setSelected}
                onMoveItem={(id, x, z) =>
                  setItems((prev) => prev.map((b) => (b.id === id ? { ...b, position: [x, 0, z] } : b)))
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-muted/20 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    centerTab === "preview"
                      ? (captured?.previewUrl ?? shot.previewUrl ?? svgDataUrl(previewSvg))
                      : centerTab === "depth"
                        ? (captured?.depthUrl ?? shot.depthUrl ?? svgDataUrl(depthSvg))
                        : (captured?.edgeUrl ?? shot.edgeUrl ?? svgDataUrl(edgeSvg))
                  }
                  alt={centerTab === "preview" ? "布景图" : centerTab === "depth" ? "深度图" : "边缘图"}
                  className="max-h-full max-w-full rounded-md border object-contain"
                />
              </div>
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pl-1">
          {cameraEl}
          {actionsEl}
        </div>
        </div>
      </>
    )
  }

  return (
    <div className="space-y-3">
      {styleEl}
      {shotSelectorEl}
      {canvasEl}
      <p className="text-[11px] text-muted-foreground">
        提示：拖动角色/道具标记调整位置；点击选中后可用方向键微调（Shift 更细）或直接输入坐标，完成后点击「重新渲染」。
      </p>
      {itemsEl}
      {cameraEl}
      {actionsEl}
    </div>
  )
}

/**
 * 2D 布景干预（manual 模式专用）：镜头选择 + 布景拖拽/微调 + 机位参数 + 重新渲染。
 * variant="fullscreen" 时切换为三栏布局（左镜头/布景项 · 中画布+三图 · 右机位/操作）。
 * 每镜编辑状态由 key 隔离，切换镜头自动重置。
 */
export function PrevisBlockingEditor({
  projectId, stage, shotIndex, onShotIndexChange, onDone, variant = "inline",
}: {
  projectId: string
  stage: WorkflowStage
  shotIndex: number
  onShotIndexChange: (index: number) => void
  onDone: () => void
  variant?: "inline" | "fullscreen"
}) {
  const artifact = stage.artifact
  if (!isPrevisArtifact(artifact)) return null
  const shots = artifact.shots
  if (shots.length === 0) return null
  const index = Math.min(Math.max(shotIndex, 0), shots.length - 1)
  const shot = shots[index]

  const editor = (
    <BlockingShotEditor
      key={index}
      projectId={projectId}
      stage={stage}
      shotIndex={index}
      shot={shot}
      shotsCount={shots.length}
      onShotIndexChange={onShotIndexChange}
      onDone={onDone}
      variant={variant}
    />
  )
  return variant === "inline" ? (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">{editor}</div>
  ) : (
    editor
  )
}
