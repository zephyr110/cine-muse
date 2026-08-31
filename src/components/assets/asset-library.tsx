"use client"

/**
 * 资产库（Asset Library）
 * - 用户自行维护的角色/场景/道具/风格素材卡，全局唯一
 * - 项目通过绑定（AssetBinding）引用资产，agents 在对应环节消费（见 engine/templates.ts）
 * - 被项目引用的资产禁止硬删（引用保护）
 */

import * as React from "react"
import {
  ArrowUpDownIcon,
  BoxIcon,
  CheckIcon,
  ChevronDownIcon,
  FileAudioIcon,
  LandmarkIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TagsIcon,
  Trash2Icon,
  UploadCloudIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react"
import { toast } from "@/components/ui/toast"

import { cn } from "@/lib/utils"
import { useApp } from "@/lib/store"
import { assetFileUrl, deleteAssetFile, uploadAssetFile } from "@/lib/api"
import { formatBytes } from "@/lib/format"
import { ASSET_CATEGORY_LABEL } from "@/lib/types"
import type { Asset, AssetCategory, AssetFile } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ResourceCard, ResourceCardContent, ResourceCardCover, ResourceCardIcon } from "@/components/ui/resource-card"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const FILE_KIND_LABEL: Record<AssetFile["kind"], string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
}

const CATEGORY_ICON: Record<AssetCategory, React.ReactNode> = {
  character: <UsersRoundIcon className="size-4" />,
  scene: <LandmarkIcon className="size-4" />,
  prop: <BoxIcon className="size-4" />,
  style: <PaletteIcon className="size-4" />,
}

const CATEGORY_TABS: { id: AssetCategory | "all"; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "character", label: "角色" },
  { id: "scene", label: "场景" },
  { id: "prop", label: "道具" },
  { id: "style", label: "风格" },
]

const SORT_OPTIONS = [
  { value: "updated", label: "最近更新" },
  { value: "used", label: "使用最多" },
] as const

type SortKey = (typeof SORT_OPTIONS)[number]["value"]

const COLOR_OPTIONS = [
  "from-indigo-500/40 to-violet-500/25",
  "from-rose-500/40 to-pink-500/25",
  "from-cyan-500/40 to-blue-500/25",
  "from-amber-400/40 to-orange-500/25",
  "from-emerald-500/40 to-teal-500/25",
  "from-slate-600/40 to-slate-900/45",
]

const CATEGORIES: AssetCategory[] = ["character", "scene", "prop", "style"]

const CATEGORY_ITEMS = CATEGORIES.map((c) => ({
  value: c,
  label: ASSET_CATEGORY_LABEL[c],
}))

/* ---------- 新建 / 编辑表单 ---------- */

const EMPTY_FORM = { name: "", category: "character" as AssetCategory, description: "", tags: "", color: COLOR_OPTIONS[0] }

function AssetFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: Asset | null
}) {
  const { dispatch } = useApp()
  // 父组件以 key 重挂载（每次打开都是全新表单），初始值在挂载时推导
  const [form, setForm] = React.useState(() =>
    editing
      ? { name: editing.name, category: editing.category, description: editing.description, tags: editing.tags.join("、"), color: editing.color }
      : EMPTY_FORM,
  )
  // 素材文件：新选文件（上传后落库）或编辑时已存在的 file
  const [file, setFile] = React.useState<File | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [fileErr, setFileErr] = React.useState("")
  // 新选文件的本地预览（objectURL 随 dialog 卸载回收；仅新选文件需要，已有文件用服务器 url）
  const previewUrl = React.useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  React.useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])
  const previewSrc = previewUrl ?? (editing?.file ? assetFileUrl(editing.file.url) : null)
  const previewKind: AssetFile["kind"] | null = file
    ? file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : "audio"
    : editing?.file?.kind ?? null

  const pickFile = (f: File | null | undefined) => {
    if (!f) return
    setFileErr("")
    setFile(f)
  }

  const submit = async () => {
    const name = form.name.trim()
    if (name.length < 1 || uploading) return
    // 先上传文件拿服务器记录，再落库（失败不创建资产）
    let fileMeta: AssetFile | undefined
    if (file) {
      setUploading(true)
      try {
        fileMeta = await uploadAssetFile(file)
      } catch (err) {
        toast.add({ title: err instanceof Error ? err.message : "上传失败", type: "error" })
        setUploading(false)
        return
      }
    }
    const payload = {
      name,
      category: form.category,
      description: form.description.trim(),
      tags: form.tags.split(/[、,，\s]+/).filter(Boolean),
      color: form.color,
      ...(fileMeta ? { file: fileMeta } : {}),
    }
    if (editing) {
      dispatch({ type: "UPDATE_ASSET", assetId: editing.id, patch: payload, now: new Date().toISOString() })
    } else {
      dispatch({ type: "CREATE_ASSET", input: payload, now: new Date().toISOString() })
    }
    setUploading(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl!">
        <DialogHeader>
          <DialogTitle>{editing ? `编辑「${editing.name}」` : "新建资产卡"}</DialogTitle>
          <DialogDescription>
            资产是全局素材，项目通过绑定引用。绑定后 agents 会在对应环节消费它作为生成约束。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid grid-cols-[1fr_160px] gap-4">
            <div className="space-y-2">
              <Label htmlFor="ast-name">名称</Label>
              <Input
                id="ast-name"
                placeholder="例如：阿岚（拾荒者）"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>分类</Label>
              <Select
                value={form.category}
                items={CATEGORY_ITEMS}
                onValueChange={(v) => setForm({ ...form, category: (v ?? "character") as AssetCategory })}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} label={ASSET_CATEGORY_LABEL[c]}>{ASSET_CATEGORY_LABEL[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ast-desc">设定描述</Label>
            <Textarea
              id="ast-desc"
              placeholder="视觉/设定描述，将注入对应 Agent 的生成提示词（例如：女 28 岁 · 旧军大衣 + 金属义手）"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ast-tags">检索标签</Label>
            <Input
              id="ast-tags"
              placeholder="用顿号分隔，例如：科幻、赛博朋克、女性"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground">标签命中项目题材/风格时，会在新建项目向导中标记「推荐」</p>
          </div>
          <div className="space-y-2">
            <Label>封面配色</Label>
            <div className="flex gap-2">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label="选择封面配色"
                  onClick={() => setForm({ ...form, color: c })}
                  className={`size-7 rounded-md bg-gradient-to-br ${c} border ${form.color === c ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
                />
              ))}
            </div>
          </div>
          {/* 素材文件（可选）：点击 / 拖拽上传，主流图片/视频/音频格式 */}
          <div className="space-y-2">
            <Label>素材文件</Label>
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-5 text-center transition-colors hover:border-primary/50 hover:bg-muted/30 ${
                fileErr ? "border-red-500/60" : "border-border"
              }`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                pickFile(e.dataTransfer.files?.[0])
              }}
            >
              <input
                type="file"
                className="sr-only"
                accept="image/*,video/*,audio/*"
                onChange={(e) => {
                  pickFile(e.target.files?.[0])
                  e.target.value = "" // 允许连续选择同一文件
                }}
              />
              {uploading ? (
                <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
              ) : (
                <UploadCloudIcon className="size-5 text-muted-foreground" />
              )}
              <span className="text-xs text-muted-foreground">
                {uploading ? "正在上传…" : "点击或拖拽上传图片 / 视频 / 音频（≤ 50MB）"}
              </span>
            </label>
            {fileErr && <p className="text-[11px] text-red-500">{fileErr}</p>}
            {(file || editing?.file) && previewSrc && (
              <div className="flex items-center gap-2.5 rounded-md border bg-muted/30 p-2">
                <div className="size-10 shrink-0 overflow-hidden rounded-md bg-muted">
                  {previewKind === "image" ? (
                    <img src={previewSrc} alt="" className="size-full object-cover" />
                  ) : previewKind === "video" ? (
                    <video src={previewSrc} muted playsInline preload="metadata" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground">
                      <FileAudioIcon className="size-4" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{file?.name ?? editing?.file?.name ?? ""}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {FILE_KIND_LABEL[previewKind ?? "image"]} · {formatBytes(file?.size ?? editing?.file?.size ?? 0)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label="移除文件"
                  disabled={uploading}
                  onClick={() => {
                    setFile(null)
                    setFileErr("")
                  }}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={form.name.trim().length < 1 || uploading} onClick={submit}>
            {uploading ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
            {editing ? "保存修改" : "创建资产"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- 资产卡片 ---------- */

function AssetCard({
  asset,
  usedBy,
  onEdit,
  onDelete,
}: {
  asset: Asset
  usedBy: number
  onEdit: () => void
  onDelete: () => void
}) {
  const deleteDisabled = usedBy > 0
  return (
    <ResourceCard interactive className="flex flex-col">
      {asset.file ? (
        <ResourceCardCover className={asset.color}>
          {asset.file.kind === "image" && (
            <img src={assetFileUrl(asset.file.url)} alt={asset.name} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover/resource:scale-[1.03]" />
          )}
          {asset.file.kind === "video" && (
            <video src={assetFileUrl(asset.file.url)} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover/resource:scale-[1.03]" />
          )}
          {asset.file.kind === "audio" && (
            <div className="flex size-full items-center justify-center">
              <ResourceCardIcon>
                <FileAudioIcon className="size-5" />
              </ResourceCardIcon>
            </div>
          )}
          <Badge variant="secondary" className="absolute left-2.5 top-2.5 bg-background/80 text-[11px] backdrop-blur">
            {ASSET_CATEGORY_LABEL[asset.category]}
          </Badge>
          <Badge className="absolute right-2.5 top-2.5 bg-black/50 text-[11px] text-white backdrop-blur-sm">
            {FILE_KIND_LABEL[asset.file.kind]}
          </Badge>
        </ResourceCardCover>
      ) : (
        <ResourceCardCover className={asset.color}>
          <div className="flex size-full items-center justify-center">
            <ResourceCardIcon>{CATEGORY_ICON[asset.category]}</ResourceCardIcon>
          </div>
          <Badge variant="secondary" className="absolute left-2.5 top-2.5 bg-background/80 text-[11px] backdrop-blur">
            {ASSET_CATEGORY_LABEL[asset.category]}
          </Badge>
        </ResourceCardCover>
      )}
      <ResourceCardContent className="gap-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-tight">{asset.name}</p>
          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-200 group-hover/resource:opacity-100 group-focus-within/resource:opacity-100">
            <Button variant="ghost" size="icon" className="size-7" onClick={onEdit} aria-label={`编辑 ${asset.name}`}>
              <PencilIcon className="size-3.5" />
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    disabled={deleteDisabled}
                    onClick={onDelete}
                    aria-label={`删除 ${asset.name}`}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                }
              >
                {deleteDisabled && <TooltipContent>已被 {usedBy} 个项目绑定，请先解除引用</TooltipContent>}
              </TooltipTrigger>
            </Tooltip>
          </div>
        </div>
        <p className={cn("line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground", !asset.description && "text-muted-foreground/40")}>
          {asset.description || "暂无描述"}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-0.5">
          {asset.file && <span className="text-[11px] text-muted-foreground/70">{formatBytes(asset.file.size)}</span>}
          {asset.tags.slice(0, 3).map((t) => (
            <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{t}</span>
          ))}
          {asset.tags.length > 3 && (
            <span className="text-[11px] text-muted-foreground/60">+{asset.tags.length - 3}</span>
          )}
          <span className={cn("ml-auto text-[11px]", usedBy > 0 ? "font-medium text-primary" : "text-muted-foreground/60")}>
            {usedBy > 0 ? `引用 ${usedBy}` : "未使用"}
          </span>
        </div>
      </ResourceCardContent>
    </ResourceCard>
  )
}

/* ---------- 主组件 ---------- */

export function AssetLibrary() {
  const { state, dispatch } = useApp()
  const [category, setCategory] = React.useState<AssetCategory | "all">("all")
  const [query, setQuery] = React.useState("")
  const [tags, setTags] = React.useState<string[]>([])
  const [sort, setSort] = React.useState<SortKey>("updated")
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Asset | null>(null)
  const [deleting, setDeleting] = React.useState<Asset | null>(null)

  // 每个资产被引用的项目数（派生）
  const usedByCount = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const p of state.projects) {
      for (const b of p.assets) {
        map.set(b.assetId, (map.get(b.assetId) ?? 0) + 1)
      }
    }
    return map
  }, [state.projects])

  // 全库标签聚合，按使用频率降序（标签筛选候选项）
  const allTags = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of state.assets) {
      for (const t of a.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
      .map(([t]) => t)
  }, [state.assets])

  // 已选标签中仍存在于库中的子集：资产被编辑/删除移除标签后自动剪枝，避免永久零结果筛选
  const selectedTags = React.useMemo(
    () => tags.filter((t) => allTags.includes(t)),
    [tags, allTags],
  )

  // 单一「筛选生效」判定：工具栏重置按钮与空态分支共用，避免两处判定漂移
  const hasFilters =
    category !== "all" || query.trim() !== "" || selectedTags.length > 0 || sort !== "updated"

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return state.assets
      .filter((a) => {
        if (category !== "all" && a.category !== category) return false
        if (selectedTags.length > 0 && !selectedTags.every((t) => a.tags.includes(t))) return false
        if (!q) return true
        return (
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q))
        )
      })
      .sort((x, y) => {
        if (sort === "used") {
          const d = (usedByCount.get(y.id) ?? 0) - (usedByCount.get(x.id) ?? 0)
          if (d !== 0) return d
        }
        return y.updatedAt.localeCompare(x.updatedAt)
      })
  }, [state.assets, category, query, selectedTags, sort, usedByCount])

  const clearFilters = () => {
    setCategory("all")
    setQuery("")
    setTags([])
    setSort("updated")
  }

  const confirmDelete = () => {
    if (!deleting) return
    // 引用保护在 reducer 层；文件删除尽力而为（失败不阻塞资产删除）
    if (deleting.file) void deleteAssetFile(deleting.file.url).catch(() => {})
    dispatch({ type: "DELETE_ASSET", assetId: deleting.id, now: new Date().toISOString() })
    setDeleting(null)
  }

  return (
    <div className="flex animate-in fade-in-0 slide-in-from-bottom-2 duration-500 flex-col gap-5 p-4 md:p-6">
      {/* 头部 */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">资产库</h1>
          <p className="text-xs text-muted-foreground">全局素材，项目绑定后由对应环节的智能体自动消费</p>
        </div>
        <Button
          className="ml-auto"
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          <PlusIcon /> 新建资产
        </Button>
      </div>

      {/* 筛选：分类 Tabs + 标签多选 + 排序 + 搜索 */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={category} onValueChange={(v) => setCategory((v ?? "all") as AssetCategory | "all")}>
          <TabsList>
            {CATEGORY_TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="text-xs">{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" className="h-8 gap-1.5 text-xs" />}
          >
            <TagsIcon className="size-3.5" />
            标签
            {selectedTags.length > 0 && (
              <Badge className="min-w-4 px-1 text-[10px] tabular-nums">{selectedTags.length}</Badge>
            )}
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[min(18rem,var(--available-height))] w-56 overflow-y-auto p-1.5">
            <div className="flex items-center justify-between px-1.5 py-1">
              <span className="text-xs font-medium text-muted-foreground">按标签筛选</span>
              {selectedTags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTags([])}
                  className="text-xs text-primary hover:underline"
                >
                  清除
                </button>
              )}
            </div>
            {allTags.length === 0 ? (
              <p className="px-1.5 py-4 text-center text-xs text-muted-foreground">暂无标签，可在编辑资产时添加</p>
            ) : (
              allTags.map((t) => {
                const on = selectedTags.includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    onClick={() => setTags(on ? selectedTags.filter((x) => x !== t) : [...selectedTags, t])}
                    className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                      on ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                        on ? "border-primary bg-primary text-primary-foreground" : "border-input"
                      }`}
                    >
                      {on && <CheckIcon className="size-3" />}
                    </span>
                    <span className="truncate">{t}</span>
                  </button>
                )
              })
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Select value={sort} items={[...SORT_OPTIONS]} onValueChange={(v) => setSort((v ?? "updated") as SortKey)}>
          <SelectTrigger aria-label="排序" className="h-8 gap-1.5 text-xs">
            <ArrowUpDownIcon className="size-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} label={o.label}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative ml-auto w-full max-w-60">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索名称 / 描述 / 标签"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {state.assets.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">共 {filtered.length} 个</span>
        )}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={clearFilters}
          >
            <XIcon className="size-3" /> 重置
          </Button>
        )}
      </div>
      {/* 已选标签 chips（点击 × 移除） */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedTags.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1 pr-1 text-[11px]">
              {t}
              <button
                type="button"
                aria-label={`移除标签 ${t}`}
                onClick={() => setTags(selectedTags.filter((x) => x !== t))}
                className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* 网格 */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {filtered.map((a) => (
            <AssetCard
              key={a.id}
              asset={a}
              usedBy={usedByCount.get(a.id) ?? 0}
              onEdit={() => {
                setEditing(a)
                setFormOpen(true)
              }}
              onDelete={() => setDeleting(a)}
            />
          ))}
        </div>
      ) : state.assets.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-14 text-center">
          <FolderOpenIcon className="size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">资产库还是空的</p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground/70">
            创建角色/场景/道具/风格卡后，新建项目向导会按题材与风格自动推荐绑定。
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <PlusIcon /> 创建第一张资产卡
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-14 text-center">
          <SearchIcon className="size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">没有匹配的资产</p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground/70">
            试试调整搜索关键词、分类或标签筛选
          </p>
          <Button variant="outline" size="sm" onClick={clearFilters}>
            清除筛选
          </Button>
        </div>
      )}

      {/* 新建/编辑 */}
      <AssetFormDialog key={formOpen ? (editing?.id ?? "new") : "closed"} open={formOpen} onOpenChange={setFormOpen} editing={editing} />

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销。若该资产正被项目绑定，将被系统拒绝并提示解除引用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleting(null)}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 text-white hover:bg-red-600/90">
              <Trash2Icon /> 确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
