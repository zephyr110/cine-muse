"use client"

import * as React from "react"
import {
  CameraIcon,
  ChevronRightIcon,
  ClipboardIcon,
  CopyIcon,
  FrameIcon,
  ImageIcon,
  Move3dIcon,
  OrbitIcon,
  Redo2Icon,
  Rotate3dIcon,
  RotateCcwIcon,
  Scale3dIcon,
  Undo2Icon,
  UserPlusIcon,
} from "lucide-react"

import { toast } from "@/components/ui/toast"
import { useApp } from "@/lib/store"
import { injectMarkerIds, renderPrevisShot, svgDataUrl } from "@/lib/engine/previs-render"
import { isPrevisArtifact } from "@/lib/engine/previs-types"
import {
  BODY_TYPES,
  POSE_GROUPS,
  POSE_LIMIT_BY_BODY_TYPE,
  POSE_PRESETS,
  POSE_PRESET_BY_ID,
} from "@/lib/engine/previs-poses"
import type { Ue4BodyType } from "@/lib/engine/previs-ue4-rig"
import type { BlockingItem, PrevisShot, WorkflowStage } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  PALETTE,
  PrevisViewport,
  type CaptureResult,
  type MapAspect,
  type OrbitPreview,
  type PrevisViewportHandle,
  type TransformMode,
  type ViewMode,
} from "./previs-3d-viewport"

/** 与 previs-render 俯视投影一致：480×270 画布、48px/世界单位（z 向上） */
const SVG_W = 480
const SVG_H = 270
const PX_PER_UNIT = 48

/** 新增角色网格落位范围（仅 addCharacter 的自动摆位使用）：用户提交/拖拽已不再钳制（spec §4.4） */
const X_RANGE = { min: -SVG_W / 2 / PX_PER_UNIT, max: SVG_W / 2 / PX_PER_UNIT } // [-5, 5]
const Z_RANGE = { min: 1 - SVG_H / 2 / PX_PER_UNIT, max: 1 + SVG_H / 2 / PX_PER_UNIT } // [-1.8125, 3.8125]
/** 机位/FOV 仍按范围钳制（相机参数非自由摆放语义） */
const CAM_RANGE = { min: -20, max: 20 }
const FOV_RANGE = { min: 5, max: 150 }

const round2 = (v: number) => Math.round(v * 100) / 100
const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v))
/** 体型转角限位（度）：姿势滑杆按此收窄；越限预设值仅提示不截断（用户写入才按滑杆范围钳制）。
 *  仅认表内自有键——原型键（"constructor"/"toString" 等）回落默认 90，否则会取到函数使滑杆 min/max 变 NaN */
const poseLimitFor = (bodyType: string | undefined) => {
  const id = (bodyType ?? "mannequin") as Ue4BodyType
  return Object.hasOwn(POSE_LIMIT_BY_BODY_TYPE, id) ? POSE_LIMIT_BY_BODY_TYPE[id] : 90
}
/** 机位序号 → 两位补零标签（与视口 rig 标签同源，spec §4.3） */
const rigLabel = (index: number) => `机位${String(index + 1).padStart(2, "0")}`
/** 布景项 id：时间戳 + 随机后缀（新增/粘贴角色唯一） */
const randomItemId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

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

/** 画幅 → 宽高比数值（3D 画布 letterbox 与视口相机锁定共用） */
const ASPECT_RATIO: Record<MapAspect, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 }

/** 新增角色的 8 色盘轮转：取未被现有角色显式占用（kind=character 且带 color）的第一色 */
const nextPaletteColor = (items: BlockingItem[]): string => {
  const used = new Set(
    items
      .filter((b) => b.kind === "character")
      .map((b) => b.color)
      .filter((c): c is string => !!c),
  )
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[(items.length + 1) % PALETTE.length]
}

/** pill 工具条圆按钮：hover 浮出小字提示；active 表变换模式选中 */
function ModeButton({
  active, icon, label, onClick,
}: {
  active?: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "group relative flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground",
        active && "bg-primary/15 text-primary hover:bg-primary/15 hover:text-primary",
      )}
    >
      {icon}
      <span className="pointer-events-none invisible absolute -top-8 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-2 py-0.5 text-[10px] whitespace-nowrap text-background opacity-0 transition-opacity group-hover:visible group-hover:opacity-100">
        {label}
      </span>
    </button>
  )
}

/**
 * 变换数值输入（精确输入）：输入期间只改本地暂存，blur/Enter 才提交（撤销单步）；
 * 未聚焦且未被用户编辑时跟随外部值（gizmo 拖拽终帧 / undo 后一次刷新——中间帧不写回，
 * 故拖动过程不抖动）；脏值不丢——blur 提交的是用户最后输入值。
 */
function TransformField({
  value, step, onCommit, ariaLabel,
}: {
  value: number
  step: number
  onCommit: (v: number) => void
  ariaLabel: string
}) {
  const [text, setText] = React.useState(String(value))
  const [dirty, setDirty] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const [last, setLast] = React.useState(value)
  // 渲染期派生状态（React 官方模式）：外部值变化且未在编辑 → 跟随一次
  if (!focused && !dirty && value !== last) {
    setLast(value)
    setText(String(value))
  }
  const commit = () => {
    setFocused(false)
    if (!dirty) return
    setDirty(false)
    const n = Number(text)
    if (text === "" || !Number.isFinite(n)) {
      setText(String(last)) // 非法输入 → 回显原值，不提交
      return
    }
    const v = Math.round(n * 100) / 100
    if (v !== last) onCommit(v)
    setLast(v)
    setText(String(v))
  }
  return (
    <input
      type="number"
      step={step}
      value={text}
      aria-label={ariaLabel}
      onFocus={() => {
        setFocused(true)
        setText(String(last))
      }}
      onChange={(e) => {
        setDirty(true)
        setText(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          commit()
        } else if (e.key === "Escape") {
          setDirty(false)
          setText(String(last))
        }
      }}
      className="h-7 w-full rounded border border-border bg-background px-1.5 text-right text-xs tabular-nums outline-none focus:border-ring"
    />
  )
}

/** 右栏「变换」分组：位置/旋转/缩放 X Y Z 数值行 + 角色标签开关 */
function TransformGroup({
  item, showLabels, onShowLabelsChange, onChange,
}: {
  item: BlockingItem
  showLabels: boolean
  onShowLabelsChange: (v: boolean) => void
  onChange: (patch: {
    position?: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number]
  }) => void
}) {
  const rows: { label: string; field: "position" | "rotation" | "scale"; values: [number, number, number] }[] = [
    { label: "位置", field: "position", values: item.position },
    { label: "旋转", field: "rotation", values: item.rotation },
    { label: "缩放", field: "scale", values: item.scale },
  ]
  return (
    <div className="space-y-1.5 rounded-md border border-border/60 p-2.5">
      <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        变换 · {item.name}
        <span className="ml-auto text-[10px] font-normal text-muted-foreground/70">
          {item.kind === "character" ? "角色" : item.kind === "prop" ? "道具" : "地形"}
        </span>
      </p>
      {rows.map(({ label, field, values }) => (
        <div key={field} className="grid grid-cols-[3.5rem_1fr_1fr_1fr] items-center gap-1 text-xs">
          <span className="text-muted-foreground">{label}</span>
          {(["X", "Y", "Z"] as const).map((ax, i) => (
            <TransformField
              key={`${item.id}-${label}-${ax}`}
              value={values[i]}
              step={0.1}
              ariaLabel={`${item.name} ${label} ${ax}`}
              onCommit={(v) => {
                const next = [...values] as [number, number, number]
                next[i] = v
                onChange({ [field]: next })
              }}
            />
          ))}
        </div>
      ))}
      <div className="flex items-center justify-between border-t border-border/40 pt-1.5 text-xs text-muted-foreground">
        <span>角色标签</span>
        <button
          type="button"
          role="switch"
          aria-checked={showLabels}
          onClick={() => onShowLabelsChange(!showLabels)}
          className={cn("h-4 w-7 rounded-full transition-colors", showLabels ? "bg-primary" : "bg-border")}
        >
          <span
            className={cn(
              "block size-3.5 translate-x-0.5 rounded-full bg-background transition-transform",
              showLabels && "translate-x-3",
            )}
          />
        </button>
      </div>
    </div>
  )
}

/** 单镜头编辑：拖拽/选中微调/坐标输入 + 机位参数 + 重新渲染；inline 堆叠 / fullscreen 三栏 */
function BlockingShotEditor({
  projectId, stage, shotIndex, shot, shots, shotsCount, onShotIndexChange, onDone, variant = "inline",
  rigSelected = false, onRigSelect,
}: {
  projectId: string
  stage: WorkflowStage
  shotIndex: number
  shot: PrevisShot
  shots: PrevisShot[]
  shotsCount: number
  onShotIndexChange: (index: number) => void
  onDone: () => void
  variant?: "inline" | "fullscreen"
  /** 当前镜头机位 rig 是否选中——父级持有：编辑器按 shot 重建（key=index），选中态须跨重建存活 */
  rigSelected?: boolean
  /** rig 选中变更：number = 选中该索引机位；null = 清除（图元/空点/切镜头） */
  onRigSelect?: (index: number | null) => void
}) {
  const { state, dispatch } = useApp()
  const [items, setItems] = React.useState<BlockingItem[]>(shot.blocking)
  const [camera, setCamera] = React.useState<PrevisShot["camera"]>(shot.camera)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [mapTab, setMapTab] = React.useState<"preview" | "depth" | "edge">("preview")
  const [centerTab, setCenterTab] = React.useState<"view3d" | "preview" | "depth" | "edge">("view3d")
  const [captured, setCaptured] = React.useState<CaptureResult | null>(null)
  // Task 4 视口契约：视图模式（导演环绕 / 机位视角）、变换模式、名字标签
  const [viewMode, setViewMode] = React.useState<ViewMode>("director")
  const [transformMode, setTransformMode] = React.useState<TransformMode>("translate")
  const [showLabels, setShowLabels] = React.useState(true)
  const [openMenu, setOpenMenu] = React.useState<"add" | "aspect" | null>(null)
  const [aspect, setAspect] = React.useState<MapAspect>("16:9")
  const [orbits, setOrbits] = React.useState<OrbitPreview[]>([])
  const [clipboard, setClipboard] = React.useState<BlockingItem | null>(null)
  /** 画幅 letterbox 适配尺寸：舞台容器内按所选比例的最大内接区（3D 画布框） */
  const [fit, setFit] = React.useState<{ w: number; h: number } | null>(null)
  const itemsRef = React.useRef(items)
  itemsRef.current = items
  const viewportRef = React.useRef<PrevisViewportHandle | null>(null)
  const svgBoxRef = React.useRef<HTMLDivElement | null>(null)
  const stageBoxRef = React.useRef<HTMLDivElement | null>(null)

  // 撤销/重做从 reducer 回灌：props 快照键变化（外部恢复）→ 重置本地编辑态
  const propsKey = JSON.stringify([shot.blocking, shot.camera])
  const lastKey = React.useRef(propsKey)
  React.useEffect(() => {
    if (propsKey !== lastKey.current) {
      lastKey.current = propsKey
      setItems(shot.blocking)
      setCamera(shot.camera)
      // 仅当外部恢复真的改动了内容（undo/redo/他处改写）或选中项被移除时才清选择——
      // 本编辑器自身提交后的同内容回灌保留选择（gizmo 终帧、姿态滑杆、字段提交后不摘除）
      const ownRoundTrip = JSON.stringify(shot.blocking) === JSON.stringify(itemsRef.current)
      if (!ownRoundTrip || (selected != null && !shot.blocking.some((b) => b.id === selected))) {
        setSelected(null)
      }
      // 撤销/重做恢复的是纯数据：已导出的位图与瞬态环绕条与当前状态不一致，清空待重新渲染
      setCaptured(null)
      setOrbits([])
    }
  }, [propsKey, shot, selected])

  // 画幅 letterbox：舞台容器实测 → 按所选比例的最大内接区（fullscreen 3D 画布）
  React.useEffect(() => {
    if (variant !== "fullscreen") return
    const el = stageBoxRef.current
    if (!el) return
    const update = () => {
      const cw = el.clientWidth
      const ch = el.clientHeight
      if (cw === 0 || ch === 0) return
      const ratio = ASPECT_RATIO[aspect]
      const w = Math.min(cw, Math.floor(ch * ratio))
      const h = Math.floor(w / ratio)
      setFit((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [aspect, variant])

  // 视口相机比例锁定（与画布 letterbox 一致 → 几何不畸变；导出画幅同源）
  React.useEffect(() => {
    if (variant !== "fullscreen" || centerTab !== "view3d") return
    viewportRef.current?.setViewAspect(ASPECT_RATIO[aspect])
  }, [aspect, centerTab, variant])

  /** 实际生效的变换模式：选中机位 rig 时缩放无效（spec §4.2）→ 派生回退 translate。
   *  派生而非 effect 同步：无额外渲染，工具条高亮与视口 gizmo 模式始终一致；
   *  取消选中后恢复用户此前选择的模式（scale 按钮在选中 rig 时另有 toast 守卫，不会切模式）。 */
  const effectiveTransformMode: TransformMode =
    rigSelected && transformMode === "scale" ? "translate" : transformMode

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

  /** 指针坐标 → 世界 x/z（renderPreviewSvg.project 的逆运算，不钳制——spec §4.4 自由摆放：
   *  指针捕获保证拖出画布仍连续跟手；坐标可越出 SVG 视野，2D 图按 viewBox 裁切、3D 视口完整可见）。
   *  容器宽高比可能偏离 16:9（如超宽屏下 max-h-full 钳制）：按 SVG 实际
   *  适配后的内嵌矩形（letterbox 居中）映射，而非整个容器，保证任意窗口比例下精确。 */
  const worldFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = svgBoxRef.current!.getBoundingClientRect()
    const scale = Math.min(rect.width / SVG_W, rect.height / SVG_H)
    const fitW = SVG_W * scale
    const fitH = SVG_H * scale
    const offsetX = (rect.width - fitW) / 2
    const offsetY = (rect.height - fitH) / 2
    const px = ((e.clientX - rect.left - offsetX) / fitW) * SVG_W
    const py = ((e.clientY - rect.top - offsetY) / fitH) * SVG_H
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
    onRigSelect?.(null) // 图元选中 → 清 rig 选中（与视口选中同一互斥策略）
    setDragId(id)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragId || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    const { x, z } = worldFromEvent(e)
    setItems((prev) => prev.map((b) => (b.id === dragId ? { ...b, position: [x, b.position[1], z] } : b)))
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (dragId) commitDrag()
    setDragId(null)
  }

  /** 左栏 X/Z 字段提交：不钳制（spec §4.4 自由摆放），y 保留真实高度 */
  const setPosition = (id: string, axis: 0 | 2, value: number) => {
    if (!Number.isFinite(value)) return
    const next = items.map((b) =>
      b.id === id
        ? {
            ...b,
            position:
              axis === 0
                ? ([round2(value), b.position[1], b.position[2]] as [number, number, number])
                : ([b.position[0], b.position[1], round2(value)] as [number, number, number]),
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

  /** rig 点击标记：视口同一手势内先 onSelectShot(i) 再 onSelect(null)——后者是「清图元选中」
   *  的伴随调用，不得当作空点清掉刚选中的 rig（两者同步顺序固定，故用 ref 消歧） */
  const rigClickRef = React.useRef(false)

  /** 视口 rig 点击：选中该机位（父级持有）+ 切换分镜（沿用 shotIndex 选择语义） */
  const handleSelectShot = (index: number) => {
    rigClickRef.current = true
    onRigSelect?.(index)
    onShotIndexChange(index)
  }

  /** 视口选中回调（图元/空点）：图元选中与 rig 选中互斥——任何非 rig 点击都清 rig 选中 */
  const handleSelect = (id: string | null) => {
    if (rigClickRef.current) rigClickRef.current = false
    else onRigSelect?.(null)
    setSelected(id)
  }

  /** 左栏机位行点击：切换分镜 + 清图元选中（与视口 rig 点击同口径——rig 选中期间
   *  Delete 不得误删上次选中的角色）；fullscreen 下同时选中其 rig（spec §4.2「点 rig 或机位列表」；
   *  inline 无 3D 视口与 rig，仅作镜头切换，保持既有 parity） */
  const selectCameraRow = (index: number) => {
    setSelected(null)
    onShotIndexChange(index)
    if (variant === "fullscreen") onRigSelect?.(index)
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
              position: [round2(b.position[0] + d[0]), b.position[1], round2(b.position[2] + d[1])],
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

  /** 从当前环绕视角读取机位并应用（pill「设当前视角为机位」） */
  const applyViewCamera = () => {
    const cam = viewportRef.current?.getViewCamera()
    if (!cam) return
    setCamera(cam)
    commit(items, cam)
  }

  /**
   * 视口 onTransform 统一回写：commit=false 帧只驱动 three 侧视觉（不写回——
   * 无中间态 → 撤销单步、输入框/标签不随拖动抖动、reducer 不逐帧重渲染 SVG）；
   * commit=true 终帧一次落库（x/z 不钳制——spec §4.4 自由摆放；y 保留真实高度）。
   */
  const handleTransform = (
    id: string,
    patch: {
      position?: [number, number, number]
      rotation?: [number, number, number]
      scale?: [number, number, number]
    },
    commitFlag: boolean,
  ) => {
    if (commitFlag !== true) return
    const next = itemsRef.current.map((b) => {
      if (b.id !== id) return b
      const position = patch.position
        ? ([round2(patch.position[0]), patch.position[1], round2(patch.position[2])] as [number, number, number])
        : b.position
      return { ...b, position, rotation: patch.rotation ?? b.rotation, scale: patch.scale ?? b.scale }
    })
    if (JSON.stringify(next) === JSON.stringify(itemsRef.current)) return // 无实质变更：不占撤销栈
    setItems(next)
    dispatch({ type: "UPDATE_PREVIS_BLOCKING", projectId, stageId: stage.id, shotIndex, blocking: next, commit: true })
  }

  /**
   * 视口机位 rig 拖动回写（onMoveRig）：commit=false 帧不落库——rig 拖动是视口内部视觉随动，
   * store 保持拖动前状态 → 终帧一次落库（commit:true）= 单步撤销（与 handleTransform 同口径）。
   * 视口 rig 同步 effect 依赖 [shots, viewMode, showLabels]，shots 为 store 引用、帧内不变，
   * 故不会把 rig 拉回旧位姿（T5 交接的「或至少」路径）。
   */
  const handleMoveRig = (index: number, cam: PrevisShot["camera"], commitFlag: boolean) => {
    if (commitFlag !== true) return
    if (index !== shotIndex) {
      // 理论上不可达（点 rig 即切换 shot → 本编辑器重建）；兜底按目标 shotIndex 直落相机
      dispatch({ type: "UPDATE_PREVIS_CAMERA", projectId, stageId: stage.id, shotIndex: index, camera: cam, commit: true })
      return
    }
    if (JSON.stringify(cam) === JSON.stringify(camera)) return // 无实质变更：不占撤销栈
    setCamera(cam) // 本地读数先行（右栏机位面板即时刷新）
    dispatch({ type: "UPDATE_PREVIS_CAMERA", projectId, stageId: stage.id, shotIndex, camera: cam, commit: true })
  }

  /** 变换字段（右栏）提交 → 同一 commit 通路 */
  const changeTransform = (
    id: string,
    patch: {
      position?: [number, number, number]
      rotation?: [number, number, number]
      scale?: [number, number, number]
    },
  ) => handleTransform(id, patch, true)

  /** 添加角色：色盘轮转 + 网格落位（与默认布景同区、避免互相重叠） + 自动选中 */
  const addCharacter = (bodyType: string) => {
    const chars = items.filter((b) => b.kind === "character")
    const id = randomItemId("ch")
    const col = (chars.length % 4) - 1.5 // -1.5 -0.5 0.5 1.5
    const row = Math.floor(chars.length / 4)
    const item: BlockingItem = {
      id,
      kind: "character",
      name: `角色${String(chars.length + 1).padStart(2, "0")}`,
      position: [round2(clamp(col * 1.25, X_RANGE)), 0, round2(clamp(1 + row * 0.8, Z_RANGE))],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: nextPaletteColor(items),
      bodyType,
      poseId: "stand",
    }
    const next = [...items, item]
    setItems(next)
    setSelected(id)
    onRigSelect?.(null) // 新角色自动选中 → 清 rig 选中（选中态互斥）
    setOpenMenu(null)
    dispatch({ type: "UPDATE_PREVIS_BLOCKING", projectId, stageId: stage.id, shotIndex, blocking: next, commit: true })
  }

  /** pill「当前视角截图」：按画幅真实导出三图并写回（不触发重新评估） */
  const captureCurrent = () => {
    const maps = viewportRef.current?.captureMaps(aspect)
    if (!maps?.depthUrl) return
    dispatch({ type: "UPDATE_PREVIS_MAPS", projectId, stageId: stage.id, shotIndex, maps })
    setCaptured(maps)
    toast.add({ title: "已按当前视角导出 布景 / 深度 / 边缘 三图", type: "success" })
  }

  /** pill「环绕拍摄」：展开瞬态预览条（已有则收起），点击缩略图应用机位 */
  const toggleOrbit = () => {
    if (orbits.length > 0) setOrbits([])
    else setOrbits(viewportRef.current?.captureOrbitPreviews(8) ?? [])
  }

  /** 复制/粘贴/撤销/重做/删除的共享实现（工具条按钮与快捷键同一通路） */
  const copySelected = () => {
    // 地形不可复制：地面为布景单例，粘贴副本无法删除（removeSelected 同样守卫）
    if (selectedItem && selectedItem.kind !== "terrain") setClipboard(selectedItem)
  }
  const pasteClipboard = () => {
    const source = clipboard
    if (!source) return
    const copy: BlockingItem = {
      ...source,
      id: randomItemId("c"),
      name: `${source.name} 副本`,
      // v2：粘贴保留源 y（几何中心/脚底语义）；x/z 沿用旧的错位 +1 惯例（不钳制，spec §4.4）
      position: [round2(source.position[0] + 1), source.position[1], round2(source.position[2] + 1)],
      rotation: [...source.rotation] as [number, number, number],
      scale: [...source.scale] as [number, number, number],
    }
    const next = [...items, copy]
    setItems(next)
    setSelected(copy.id)
    onRigSelect?.(null) // 粘贴副本自动选中 → 清 rig 选中（选中态互斥）
    setOpenMenu(null)
    commit(next, camera)
  }
  const removeSelected = () => {
    const sel = selected
    const item = items.find((b) => b.id === sel)
    if (!item || item.kind === "terrain") return // 地形不可删（布景地面语义）
    const next = items.filter((b) => b.id !== sel)
    setSelected(null)
    setItems(next)
    dispatch({ type: "UPDATE_PREVIS_BLOCKING", projectId, stageId: stage.id, shotIndex, blocking: next, commit: true })
  }
  const undo = () => dispatch({ type: "PREVIS_UNDO", projectId, stageId: stage.id })
  const redo = () => dispatch({ type: "PREVIS_REDO", projectId, stageId: stage.id })

  // 全屏快捷键：⌘/Ctrl+Z 撤销（+Shift 重做）、C/V 复制/粘贴、Delete/Backspace 删除。
  // 依赖变化（提交/选中/剪贴板）时重建监听——频率低，换取闭包始终新鲜。
  React.useEffect(() => {
    if (variant !== "fullscreen") return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return
      if (e.isComposing) return // 输入法组合中不劫持
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === "z") {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && k === "c") {
        e.preventDefault()
        copySelected()
        return
      }
      if (mod && k === "v") {
        e.preventDefault()
        pasteClipboard()
        return
      }
      if (!mod && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault()
        removeSelected()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 处理函数每次渲染重建；仅需在其依赖的状态变化时重挂监听
  }, [variant, selected, items, clipboard, camera])

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

  // 中央工具栏：视图/三图切换 + 导演/机位视角分段开关（画幅/环绕/截图等已移入画布 pill 工具条）
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
      {variant === "fullscreen" && (
        <>
          <span className="mx-1 h-4 w-px bg-border" />
          <div className="ml-auto flex items-center rounded-md border border-border bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setOpenMenu(null)
                setViewMode("director")
              }}
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                viewMode === "director"
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              导演视角
            </button>
            <button
              type="button"
              onClick={() => {
                setOpenMenu(null)
                setViewMode("camera")
              }}
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                viewMode === "camera"
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              机位视角
            </button>
          </div>
        </>
      )}
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
            onClick={() => {
              setSelected(selected === b.id ? null : b.id)
              onRigSelect?.(null) // 图元选中 → 清 rig 选中（selectedShotId 不得重新断言过期 rig）
            }}
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

  /** 变换分组：位置/旋转/缩放精确输入 + 角色标签开关（仅 fullscreen，选中任意布景项） */
  const transformEl =
    variant === "fullscreen" && selectedItem ? (
      <TransformGroup
        item={selectedItem}
        showLabels={showLabels}
        onShowLabelsChange={setShowLabels}
        onChange={(patch) => changeTransform(selectedItem.id, patch)}
      />
    ) : null

  /** 姿态面板：体型 + 20 预设 + 11 组折叠滑杆（仅选中角色，fullscreen）。
   *  滑杆值域按 POSE_GROUPS def 取，转角再按当前体型限位（chibi ±58 / child ±72 / 其余 ±90）收窄；
   *  越限预设值（如 kneel-two 膝 126）读数显示真值并标黄，仅用户写入时按滑杆范围取值。
   *  写回 v3 controls 单值键（整体 blocking 替换语义不变）。 */
  const poseEl =
    variant === "fullscreen" && selectedItem?.kind === "character" ? (
      <div className="rounded-md border border-border/60 p-2">
        <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <ClipboardIcon className="size-3" /> 角色姿态 · {selectedItem.name}
        </p>
        <div className="flex gap-2">
          <select
            value={selectedItem.bodyType ?? "mannequin"}
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
              // 克隆 controls：预设对象为模块级共享单例，直接引用会被滑杆写回污染（T3 评审遗留）
              if (preset) updateCharacter(selectedItem.id, { poseId: preset.id, controls: { ...preset.controls } })
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
        <div className="mt-2 flex flex-col gap-1">
          {POSE_GROUPS.map((group) => {
            const changed = group.sliders.filter((def) => (selectedItem.controls?.[def.key] ?? 0) !== 0).length
            // 转角滑杆按当前体型限位收窄（±58/72/90）；body.offsetY 为长度（米），不适用
            const limit = poseLimitFor(selectedItem.bodyType)
            return (
              <details key={group.id} className="group rounded border border-border/50 px-1.5 py-1">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-muted-foreground [&::-webkit-details-marker]:hidden">
                  <ChevronRightIcon className="size-3 transition-transform group-open:rotate-90" />
                  {group.label}
                  {changed > 0 && (
                    <span className="ml-auto rounded-full bg-primary/10 px-1.5 text-[10px] tabular-nums text-primary">
                      {changed}
                    </span>
                  )}
                </summary>
                <div className="mt-1.5 flex flex-col gap-1.5 pb-0.5">
                  {group.sliders.map((def) => {
                    const isOffsetY = def.key === "body.offsetY"
                    const value = selectedItem.controls?.[def.key] ?? 0
                    const min = isOffsetY ? def.min : -limit
                    const max = isOffsetY ? def.max : limit
                    const outOfRange = value < min || value > max
                    return (
                      <label key={def.key} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="w-8 shrink-0">{def.label}</span>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={isOffsetY ? 0.01 : 1}
                          value={value}
                          aria-label={`${group.label} · ${def.label}`}
                          onChange={(e) => {
                            // 单值键写回（其余键保留）；用户写入值天然落在滑杆范围内
                            const next = { ...selectedItem.controls, [def.key]: Number(e.target.value) }
                            updateCharacter(selectedItem.id, { controls: next })
                          }}
                          className="flex-1 accent-primary"
                        />
                        <span
                          className={cn("w-14 text-right tabular-nums", outOfRange && "text-amber-500")}
                          title={
                            outOfRange
                              ? isOffsetY
                                ? `原值 ${value} 米，超出滑杆范围 ${min}~${max} 米`
                                : `预设原值 ${value}°，超出当前体型限位 ±${limit}°（拖动滑杆即按限位取值）`
                              : undefined
                          }
                        >
                          {value}
                          {isOffsetY ? " 米" : "°"}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </details>
            )
          })}
        </div>
      </div>
    ) : null

  /** 右栏机位面板：机位NN 与左列表/视口标签同源；rig 选中时整块高亮（spec §4.2 选中态可见） */
  const cameraEl = (
    <div
      className={cn(
        "rounded-md border p-2 transition-colors",
        rigSelected ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "border-border/60",
      )}
    >
      <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <CameraIcon className="size-3" /> 机位参数 · {rigLabel(shotIndex)}（视锥随目标实时变化）
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
        onClick={undo}
      >
        <Undo2Icon className="size-3.5" /> 撤销
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="gap-1 text-xs"
        disabled={state.previsUndo.future.length === 0}
        onClick={redo}
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
          onClick={copySelected}
        >
          <CopyIcon className="size-3.5" /> 复制
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1 text-xs"
          disabled={!clipboard}
          onClick={pasteClipboard}
        >
          <ClipboardIcon className="size-3.5" /> 粘贴
        </Button>
      </div>
    )

  /** 左栏机位列表：点击 = 切换该分镜 + 选中其机位 rig（spec §4.2）；rig 选中行高亮（spec §4.3 命名） */
  const shotSelectorEl = shotsCount > 1 && (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: shotsCount }, (_, i) => (
        <button
          key={i}
          type="button"
          title={
            variant !== "fullscreen"
              ? "切换镜头"
              : rigSelected && i === shotIndex
                ? "已选中该机位（可在视口中拖动）"
                : "切换并选中该机位"
          }
          onClick={() => selectCameraRow(i)}
          className={cn(
            "rounded-md border px-2 py-1 text-xs transition-colors",
            i === shotIndex && rigSelected
              ? "border-primary bg-primary/15 font-medium ring-1 ring-primary/40"
              : i === shotIndex
                ? "border-primary/60 bg-primary/10 font-medium"
                : "border-border/60 text-muted-foreground hover:border-primary/30",
          )}
        >
          {rigLabel(i)}
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
            <div
              ref={stageBoxRef}
              className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-background"
            >
              {centerTab === "view3d" ? (
                <div
                  className="absolute inset-0 m-auto"
                  style={{ width: fit?.w ?? "100%", height: fit?.h ?? "100%" }}
                >
                  <PrevisViewport
                    ref={viewportRef}
                    items={items}
                    camera={camera}
                    shots={shots}
                    shotIndex={shotIndex}
                    viewMode={viewMode}
                    transformMode={effectiveTransformMode}
                    showLabels={showLabels}
                    selectedId={selected}
                    onSelect={handleSelect}
                    onSelectShot={handleSelectShot}
                    onTransform={handleTransform}
                    onMoveRig={handleMoveRig}
                    selectedShotId={rigSelected ? `__cam_${shotIndex}` : null}
                  />
                  {/* 弹层打开时：点画布空白处关闭（高于 FrameOverlay、低于 pill） */}
                  {viewMode === "director" && openMenu != null && (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="关闭菜单"
                      onPointerDown={() => setOpenMenu(null)}
                      className="absolute inset-0 z-10 cursor-default bg-transparent"
                    />
                  )}
                  {viewMode === "director" && (
                    <>
                      {/* pill 工具条：画布底部玻璃胶囊（导演视角下） */}
                      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
                        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border/60 bg-background/80 px-1.5 py-1 shadow-lg backdrop-blur-md">
                          <ModeButton
                            active={effectiveTransformMode === "translate"}
                            icon={<Move3dIcon className="size-4" />}
                            label="移动"
                            onClick={() => setTransformMode("translate")}
                          />
                          <ModeButton
                            active={effectiveTransformMode === "rotate"}
                            icon={<Rotate3dIcon className="size-4" />}
                            label="旋转"
                            onClick={() => setTransformMode("rotate")}
                          />
                          <ModeButton
                            active={effectiveTransformMode === "scale"}
                            icon={<Scale3dIcon className="size-4" />}
                            label="缩放"
                            onClick={() => {
                              // 机位不支持缩放（spec §4.2）：toast 且模式不切（视口侧同样不进入 scale）
                              if (rigSelected) {
                                toast.add({ title: "机位不支持缩放", type: "warning" })
                                return
                              }
                              setTransformMode("scale")
                            }}
                          />
                          <span className="mx-0.5 h-4 w-px bg-border" />
                          <ModeButton
                            icon={<UserPlusIcon className="size-4" />}
                            label="添加角色"
                            onClick={() => setOpenMenu(openMenu === "add" ? null : "add")}
                          />
                          <ModeButton
                            icon={<CameraIcon className="size-4" />}
                            label="设当前视角为机位"
                            onClick={applyViewCamera}
                          />
                          <ModeButton
                            icon={<FrameIcon className="size-4" />}
                            label={`画幅 ${aspect}`}
                            onClick={() => setOpenMenu(openMenu === "aspect" ? null : "aspect")}
                          />
                          <ModeButton
                            icon={<ImageIcon className="size-4" />}
                            label="当前视角截图"
                            onClick={captureCurrent}
                          />
                          <ModeButton
                            icon={<OrbitIcon className="size-4" />}
                            label="环绕拍摄"
                            onClick={toggleOrbit}
                          />
                        </div>
                      </div>
                      {/* 添加角色体型选择 */}
                      {openMenu === "add" && (
                        <div className="absolute bottom-14 left-1/2 z-20 w-44 -translate-x-1/2 rounded-xl border border-border/60 bg-background/95 p-1 shadow-lg backdrop-blur-md">
                          <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground">选择体型</p>
                          {BODY_TYPES.map((b) => (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => addCharacter(b.id)}
                              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-foreground/10"
                            >
                              <span>{b.name}</span>
                              <span className="text-[10px] text-muted-foreground">{b.id}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {/* 画幅切换 */}
                      {openMenu === "aspect" && (
                        <div className="absolute bottom-14 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-border/60 bg-background/95 p-1 shadow-lg backdrop-blur-md">
                          <div className="flex gap-1">
                            {(["16:9", "9:16", "1:1"] as MapAspect[]).map((a) => (
                              <button
                                key={a}
                                type="button"
                                onClick={() => {
                                  setAspect(a)
                                  setOpenMenu(null)
                                }}
                                className={cn(
                                  "rounded-md border px-2 py-1 text-[11px] tabular-nums transition-colors",
                                  aspect === a
                                    ? "border-primary/60 bg-primary/10 font-medium"
                                    : "border-border/60 text-muted-foreground hover:border-primary/30",
                                )}
                              >
                                {a}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  <FrameOverlay aspect={aspect} />
                </div>
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
            {transformEl}
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
  // 先算安全值再挂 hook（hook 不可置于提前 return 之后）
  const shots = isPrevisArtifact(artifact) ? artifact.shots : []
  const index = Math.min(Math.max(shotIndex, 0), Math.max(0, shots.length - 1))
  /** 机位 rig 选中（父级唯一真源）：编辑器按 shot 重建（key=index），选中态须跨重建存活。
   *  记录 {项目, 阶段, 分镜} 而非裸索引——切项目/阶段自动失效，且切走该分镜时
   *  rigSelected 即为 false（纯派生判定，无 effect 同步；回到该分镜会恢复该机位选中）。
   *  视口 selectedShotId 由此派生（`__cam_{i}`）；图元/空点/左栏图元点击经
   *  onRigSelect(null) 清除，不得重新断言过期 rig。 */
  const [rigSelection, setRigSelection] = React.useState<{
    projectId: string
    stageId: string
    index: number
  } | null>(null)
  const rigSelectedIndex =
    rigSelection &&
    rigSelection.projectId === projectId &&
    rigSelection.stageId === stage.id &&
    rigSelection.index === index
      ? rigSelection.index
      : null
  const selectRig = (i: number | null) =>
    setRigSelection(i == null ? null : { projectId, stageId: stage.id, index: i })
  if (!isPrevisArtifact(artifact)) return null
  if (shots.length === 0) return null
  const shot = shots[index]

  const editor = (
    <BlockingShotEditor
      key={index}
      projectId={projectId}
      stage={stage}
      shotIndex={index}
      shot={shot}
      shots={shots}
      shotsCount={shots.length}
      onShotIndexChange={onShotIndexChange}
      onDone={onDone}
      variant={variant}
      rigSelected={rigSelectedIndex === index}
      onRigSelect={selectRig}
    />
  )
  return variant === "inline" ? (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">{editor}</div>
  ) : (
    editor
  )
}
