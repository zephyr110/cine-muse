"use client"

import * as React from "react"
import {
  CameraIcon,
  ClipboardIcon,
  CopyIcon,
  EyeIcon,
  Redo2Icon,
  RotateCcwIcon,
  Undo2Icon,
} from "lucide-react"

import { useApp } from "@/lib/store"
import { injectMarkerIds, renderPrevisShot, svgDataUrl } from "@/lib/engine/previs-render"
import { isPrevisArtifact } from "@/lib/engine/previs-types"
import {
  BODY_TYPES,
  JOINT_LABELS,
  JOINT_LIMITS,
  POSE_PRESETS,
  POSE_PRESET_BY_ID,
  type JointName,
} from "@/lib/engine/previs-poses"
import type { BlockingItem, PrevisShot, WorkflowStage } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  PrevisViewport,
  type CaptureResult,
  type MapAspect,
  type OrbitPreview,
  type PrevisViewportHandle,
} from "./previs-3d-viewport"

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

/** 构图辅助：画幅比例框（外围遮罩）+ 三分线/九宫格（纯 DOM） */
function FrameOverlay({ aspect }: { aspect: MapAspect }) {
  const ratio = aspect === "16:9" ? "16 / 9" : aspect === "9:16" ? "9 / 16" : "1 / 1"
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className="absolute inset-0 m-auto"
        style={{
          aspectRatio: ratio,
          maxWidth: "100%",
          maxHeight: "100%",
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.22)",
        }}
      >
        <div className="absolute top-0 bottom-0 left-1/3 w-px bg-white/30" />
        <div className="absolute top-0 bottom-0 left-2/3 w-px bg-white/30" />
        <div className="absolute right-0 left-0 top-1/3 h-px bg-white/30" />
        <div className="absolute right-0 left-0 top-2/3 h-px bg-white/30" />
      </div>
    </div>
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
  const { state, dispatch } = useApp()
  const [items, setItems] = React.useState<BlockingItem[]>(shot.blocking)
  const [camera, setCamera] = React.useState<PrevisShot["camera"]>(shot.camera)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [mapTab, setMapTab] = React.useState<"preview" | "depth" | "edge">("preview")
  const [centerTab, setCenterTab] = React.useState<"view3d" | "preview" | "depth" | "edge">("view3d")
  const [captured, setCaptured] = React.useState<CaptureResult | null>(null)
  const [viewFromCamera, setViewFromCamera] = React.useState(false)
  const [aspect, setAspect] = React.useState<MapAspect>("16:9")
  const [orbits, setOrbits] = React.useState<OrbitPreview[]>([])
  const [clipboard, setClipboard] = React.useState<BlockingItem | null>(null)
  const itemsRef = React.useRef(items)
  itemsRef.current = items
  const viewportRef = React.useRef<PrevisViewportHandle | null>(null)
  const svgBoxRef = React.useRef<HTMLDivElement | null>(null)

  // 撤销/重做从 reducer 回灌：props 快照键变化（外部恢复）→ 重置本地编辑态
  const propsKey = JSON.stringify([shot.blocking, shot.camera])
  const lastKey = React.useRef(propsKey)
  React.useEffect(() => {
    if (propsKey !== lastKey.current) {
      lastKey.current = propsKey
      setItems(shot.blocking)
      setCamera(shot.camera)
      setSelected(null)
      // 撤销/重做恢复的是纯数据：已导出的位图与瞬态环绕条与当前状态不一致，清空待重新渲染
      setCaptured(null)
      setOrbits([])
    }
  }, [propsKey, shot])

  /** 本地编辑态提交到 reducer（一次逻辑编辑仅产生一个撤销快照：
   *   BLOCKING 先推快照（编辑前状态），CAMERA 复用同一快照不重复推；
   *   与 reducer 当前状态一致时跳过（无变更的「重新渲染」不产生冗余快照） */
  const commit = (nextItems: BlockingItem[], nextCamera: PrevisShot["camera"]) => {
    if (JSON.stringify([nextItems, nextCamera]) === propsKey) return
    dispatch({ type: "UPDATE_PREVIS_BLOCKING", projectId, stageId: stage.id, shotIndex, blocking: nextItems, commit: true })
    dispatch({ type: "UPDATE_PREVIS_CAMERA", projectId, stageId: stage.id, shotIndex, camera: nextCamera, commit: false })
  }

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
    if (dragId) commitDrag()
    setDragId(null)
  }

  const setPosition = (id: string, axis: 0 | 2, value: number) => {
    if (!Number.isFinite(value)) return
    const range = axis === 0 ? X_RANGE : Z_RANGE
    const next = items.map((b) =>
      b.id === id
        ? {
            ...b,
            position:
              axis === 0
                ? ([round2(clamp(value, range)), 0, b.position[2]] as [number, number, number])
                : ([b.position[0], 0, round2(clamp(value, range))] as [number, number, number]),
          }
        : b,
    )
    setItems(next)
    commit(next, camera)
  }

  const setCameraAxis = (axis: "position" | "target", idx: 0 | 1 | 2, value: number) => {
    if (!Number.isFinite(value)) return
    const next: [number, number, number] = [...camera[axis]] as [number, number, number]
    next[idx] = round2(clamp(value, CAM_RANGE))
    const nextCam = axis === "position" ? { ...camera, position: next } : { ...camera, target: next }
    setCamera(nextCam)
    commit(items, nextCam)
  }

  const setCameraFov = (value: number) => {
    if (!Number.isFinite(value)) return
    const nextCam = { ...camera, fov: round2(clamp(value, FOV_RANGE)) }
    setCamera(nextCam)
    commit(items, nextCam)
  }

  /** 拖拽结束提交（指针捕获结束时的最终摆位） */
  const commitDrag = () => {
    commit(itemsRef.current, camera)
  }

  /** 更新选中角色：体型/姿势/关节滑杆（materialized controls） */
  const updateCharacter = (id: string, patch: Partial<Pick<BlockingItem, "bodyType" | "poseId" | "controls">>) => {
    const next = items.map((b) => (b.id === id ? { ...b, ...patch } : b))
    setItems(next)
    commit(next, camera)
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
    commit(items, camera)
    // 3D 模式：从场景真实导出三图（深度/边缘为实际几何渲染，按画幅比例）
    if (variant === "fullscreen") {
      const maps = viewportRef.current?.captureMaps(aspect)
      if (maps?.depthUrl) {
        dispatch({ type: "UPDATE_PREVIS_MAPS", projectId, stageId: stage.id, shotIndex, maps })
        setCaptured(maps)
      }
    }
    dispatch({ type: "RERENDER_PREVIS", projectId, stageId: stage.id, now: new Date().toISOString() })
    if (variant === "inline") onDone()
  }

  /** 从当前环绕视角读取机位并应用 */
  const applyViewCamera = () => {
    const cam = viewportRef.current?.getViewCamera()
    if (!cam) return
    setCamera(cam)
    commit(items, cam)
  }

  /** 环绕拍摄：瞬态预览条，点击缩略图应用机位 */
  const shootOrbit = () => {
    setOrbits(viewportRef.current?.captureOrbitPreviews(8) ?? [])
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

  // 中央工具栏：视图/三图切换 + 画幅比例 + 环绕拍摄 + 从机位看
  const centerTabsEl = (
    <div className="flex flex-wrap items-center gap-1.5">
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
      <span className="mx-1 h-4 w-px bg-border" />
      {(["16:9", "9:16", "1:1"] as MapAspect[]).map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => setAspect(a)}
          className={cn(
            "rounded-md border px-1.5 py-1 text-[11px] tabular-nums transition-colors",
            aspect === a
              ? "border-primary/60 bg-primary/10 font-medium"
              : "border-border/60 text-muted-foreground hover:border-primary/30",
          )}
        >
          {a}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-border" />
      <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={shootOrbit}>
        <CameraIcon className="size-3.5" /> 环绕拍摄
      </Button>
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

  const selectedItem = items.find((b) => b.id === selected)

  /** 姿态面板：体型 + 姿势预设 + 关节滑杆（仅选中角色，fullscreen） */
  const poseEl =
    variant === "fullscreen" && selectedItem?.kind === "character" ? (
      <div className="rounded-md border border-border/60 p-2">
        <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <ClipboardIcon className="size-3" /> 角色姿态 · {selectedItem.name}
        </p>
        <div className="flex gap-2">
          <select
            value={selectedItem.bodyType ?? "standard"}
            onChange={(e) => updateCharacter(selectedItem.id, { bodyType: e.target.value })}
            className="h-7 flex-1 rounded border bg-background px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {BODY_TYPES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            value={selectedItem.poseId ?? "stand"}
            onChange={(e) => {
              const preset = POSE_PRESET_BY_ID[e.target.value]
              if (preset) updateCharacter(selectedItem.id, { poseId: preset.id, controls: preset.controls })
            }}
            className="h-7 flex-1 rounded border bg-background px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {POSE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          {(Object.keys(JOINT_LABELS) as JointName[]).map((j) => {
            const [min, max] = JOINT_LIMITS[j]
            const v = selectedItem.controls?.[j]?.[0] ?? 0
            return (
              <label key={j} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="w-8 shrink-0">{JOINT_LABELS[j]}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={5}
                  value={v}
                  onChange={(e) => {
                    const next = { ...selectedItem.controls } as Record<string, [number, number, number]>
                    next[j] = [Number(e.target.value), next[j]?.[1] ?? 0, next[j]?.[2] ?? 0]
                    updateCharacter(selectedItem.id, { controls: next })
                  }}
                  className="flex-1 accent-primary"
                />
                <span className="w-8 text-right tabular-nums">{v}°</span>
              </label>
            )
          })}
        </div>
      </div>
    ) : null

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

  const undoRedoEl = variant === "fullscreen" && (
    <div className="flex gap-1.5">
      <Button
        size="sm"
        variant="outline"
        className="gap-1 text-xs"
        disabled={state.previsUndo.past.length === 0}
        onClick={() => dispatch({ type: "PREVIS_UNDO", projectId, stageId: stage.id })}
      >
        <Undo2Icon className="size-3.5" /> 撤销
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="gap-1 text-xs"
        disabled={state.previsUndo.future.length === 0}
        onClick={() => dispatch({ type: "PREVIS_REDO", projectId, stageId: stage.id })}
      >
        <Redo2Icon className="size-3.5" /> 重做
      </Button>
    </div>
  )

  const copyPasteEl =
    variant === "fullscreen" && (
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="gap-1 text-xs"
          disabled={!selectedItem}
          onClick={() => setClipboard(selectedItem ?? null)}
        >
          <CopyIcon className="size-3.5" /> 复制
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1 text-xs"
          disabled={!clipboard}
          onClick={() => {
            if (!clipboard) return
            const copy: BlockingItem = {
              ...clipboard,
              id: `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
              name: `${clipboard.name} 副本`,
              position: [
                round2(clamp(clipboard.position[0] + 1, X_RANGE)),
                0,
                round2(clamp(clipboard.position[2] + 1, Z_RANGE)),
              ] as [number, number, number],
            }
            const next = [...items, copy]
            setItems(next)
            setSelected(copy.id)
            commit(next, camera)
          }}
        >
          <ClipboardIcon className="size-3.5" /> 粘贴
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
            {undoRedoEl}
            {shotSelectorEl}
            {copyPasteEl}
            {itemsEl}
          </div>
          <div className="flex min-h-0 flex-col gap-3">
            {centerTabsEl}
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-background">
              {centerTab === "view3d" ? (
                <>
                  <PrevisViewport
                    ref={viewportRef}
                    items={items}
                    camera={camera}
                    selectedId={selected}
                    viewFromCamera={viewFromCamera}
                    onSelect={setSelected}
                    onMoveItem={(id, x, z) =>
                      setItems((prev) =>
                        prev.map((b) =>
                          b.id === id
                            ? {
                                ...b,
                                position: [
                                  round2(clamp(x, X_RANGE)),
                                  0,
                                  round2(clamp(z, Z_RANGE)),
                                ] as [number, number, number],
                              }
                            : b,
                        ),
                      )
                    }
                  />
                  <FrameOverlay aspect={aspect} />
                </>
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
            {orbits.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto rounded-md border bg-muted/20 p-1.5">
                {orbits.map((o, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setCamera(o.camera)
                      commit(items, o.camera)
                      setOrbits([])
                    }}
                    className="shrink-0 rounded border border-border/60 transition-colors hover:border-primary/50"
                    title={`环绕角度 ${i + 1}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={o.url} alt={`环绕 ${i + 1}`} className="h-16 w-28 object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pl-1">
            {poseEl}
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
