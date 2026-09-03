"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CheckIcon, PencilIcon, RocketIcon, SendIcon, SparklesIcon, Wand2Icon } from "lucide-react"

import { useApp } from "@/lib/store"
import { formatMinutes } from "@/lib/format"
import { ASSET_CATEGORY_LABEL } from "@/lib/types"
import type { AssetCategory, InterventionMode, NewProjectInput, WorkflowTemplate } from "@/lib/types"
import { matchOption } from "@/lib/option-match"
import type { OptionLike } from "@/lib/option-match"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  BOOST_OPTIONS,
  DURATIONS,
  GENRES,
  MODES,
  MODE_SPECTRUM,
  QUALITY_ITEMS,
  STYLES,
  TEMPLATES,
} from "./new-project-config"

type RowId =
  | "title" | "premise" | "genre" | "style" | "duration" | "aspect"
  | "quality" | "template" | "boost" | "mode" | "assets"

type Aspect = NewProjectInput["aspectRatio"]
type Quality = NewProjectInput["quality"]

/** 聊天流草稿态：选项类字段在用户作答前为 null（不沿用旧向导的隐式默认值），提交时回落默认 */
interface Draft {
  title: string
  premise: string
  genre: string | null
  style: string | null
  durationSec: number | null
  aspectRatio: Aspect | null
  quality: Quality | null
  template: WorkflowTemplate | null
  interventionMode: InterventionMode | null
  boostAgentIds: string[]
  assetIds: string[]
}

const EMPTY_DRAFT: Draft = {
  title: "",
  premise: "",
  genre: null,
  style: null,
  durationSec: null,
  aspectRatio: null,
  quality: null,
  template: null,
  interventionMode: null,
  boostAgentIds: [],
  assetIds: [],
}

const TITLE_TEXT: Record<RowId, string> = {
  title: "给这部片子起个名字？",
  premise: "用一句话讲清你的故事——它将作为剧本创作的种子输入",
  genre: "想拍什么题材？",
  style: "想要什么视觉风格？",
  duration: "成片目标时长？（影响渲染成本与节奏）",
  aspect: "画面比例？",
  quality: "画质档位？",
  template: "走哪条工作流？",
  boost: "要不要加装增强环节？",
  mode: "希望智能体团队多自由、还是多受控？（干预深度）",
  assets: "要不要绑定资产卡，让 agents 直接消费你的设定？",
}

/** 各行的「选项卡」：chips 行（单选/多选）与 cards 行（风格/模板/模式）统一为 OptionLike + 附加展示字段 */
function optionsFor(row: RowId, draft: Draft, assets: NewProjectChatAssets): OptionLike<string>[] {
  switch (row) {
    case "genre":
      return GENRES.map((g) => ({ value: g, label: g }))
    case "style":
      return STYLES.map((s) => ({ value: s.id, label: s.id, searchText: s.desc }))
    case "duration":
      return DURATIONS.map((d) => ({
        value: String(d),
        label: `${d / 60} 分钟`,
        aliases: durationAliases(d),
      }))
    case "aspect":
      return [
        { value: "16:9", label: "16:9", aliases: ["横屏", "横向", "16比9", "169"] },
        { value: "9:16", label: "9:16", aliases: ["竖屏", "竖向", "9比16", "916"] },
        { value: "1:1", label: "1:1", aliases: ["方形", "正方形", "1比1"] },
      ]
    case "quality":
      return QUALITY_ITEMS.map((q) => ({
        value: q.value,
        label: q.label,
        aliases: qualityAliases(q.value),
      }))
    case "template":
      return TEMPLATES.map((t) => ({ value: t.id, label: t.title }))
    case "mode":
      return MODES.map((m) => ({ value: m.id, label: m.title }))
    case "boost":
      return BOOST_OPTIONS.map((b) => ({ value: b.agentId, label: b.title }))
    case "assets":
      return assets.map((a) => ({ value: a.id, label: a.name, searchText: a.description }))
    default:
      return []
  }
}

function durationAliases(d: number): string[] {
  const min = d / 60
  const out: string[] = [`${d}秒`]
  if (min === 0.5) {
    out.push("0.5分钟", "半分钟", "30s")
    return out
  }
  out.push(`${min}分钟`)
  if (min === 1) out.push("一分钟", "1分", "1min", "60s")
  if (min === 2) out.push("两分钟", "2分", "2min")
  if (min === 3) out.push("三分钟", "3分")
  if (min === 4) out.push("四分钟", "4分")
  return out
}

function qualityAliases(q: Quality): string[] {
  if (q === "draft") return ["草稿", "720", "720p", "低清"]
  if (q === "standard") return ["标准", "1080", "1080p", "标清"]
  return ["高清", "4k", "超清"]
}

/** chips 单选行的「推荐」标注（对齐 spec §2.1：时长首项推荐 2 分钟、画质推荐标准） */
const RECOMMENDED: Partial<Record<RowId, readonly string[]>> = {
  duration: ["120"],
  quality: ["standard"],
}

/** 每行是否已完成（决定「当前问题」= 首个未完成行） */
function isRowComplete(row: RowId, draft: Draft, boostTouched: boolean, assetsTouched: boolean): boolean {
  switch (row) {
    case "title":
      return draft.title.trim().length > 0
    case "premise":
      return draft.premise.trim().length >= 6
    case "genre":
      return draft.genre != null
    case "style":
      return draft.style != null
    case "duration":
      return draft.durationSec != null
    case "aspect":
      return draft.aspectRatio != null
    case "quality":
      return draft.quality != null
    case "template":
      return draft.template != null
    case "boost":
      return draft.template !== "full" || boostTouched
    case "mode":
      return draft.interventionMode != null
    case "assets":
      return assetsTouched
  }
}

/** 行完成后的用户回答摘要（echo 气泡 + 简报卡共用） */
function rowSummary(row: RowId, draft: Draft, assetCount: number): string {
  const boostCount = draft.boostAgentIds.length
  switch (row) {
    case "title":
      return draft.title.trim()
    case "premise":
      return draft.premise.trim()
    case "genre":
      return draft.genre ?? ""
    case "style":
      return draft.style ?? ""
    case "duration":
      return draft.durationSec != null ? formatMinutes(draft.durationSec) : ""
    case "aspect":
      return draft.aspectRatio ?? ""
    case "quality":
      return draft.quality != null
        ? QUALITY_ITEMS.find((q) => q.value === draft.quality)?.label ?? ""
        : ""
    case "template":
      return draft.template === "full" ? "完整流水线" : draft.template === "quick" ? "快速预览" : ""
    case "boost":
      return boostCount > 0 ? `增强环节 ${boostCount} 个` : "不加装增强环节"
    case "mode":
      return MODES.find((m) => m.id === draft.interventionMode)?.title ?? ""
    case "assets":
      return assetCount > 0 ? `绑定资产卡 ${assetCount} 项` : "暂不绑定资产"
  }
}

type NewProjectChatAssets = {
  id: string
  name: string
  category: AssetCategory
  description: string
  tags: string[]
  color: string
}[]

export function NewProjectChat() {
  const router = useRouter()
  const { state, dispatch } = useApp()
  const assets = state.assets.map((a) => ({
    id: a.id, name: a.name, category: a.category,
    description: a.description, tags: a.tags, color: a.color,
  }))

  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT)
  const [boostTouched, setBoostTouched] = React.useState(false)
  const [assetsTouched, setAssetsTouched] = React.useState(false)
  const [editId, setEditId] = React.useState<RowId | null>(null)
  const [note, setNote] = React.useState<{ row: RowId; text: string } | null>(null)
  const [input, setInput] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const ROWS: RowId[] = [
    "title", "premise", "genre", "style", "duration", "aspect",
    "quality", "template", "boost", "mode", "assets",
  ]
  // 可见行：quick 模板不出现增强环节行（分母与就绪判定都基于可见行）
  const VISIBLE_ROWS = ROWS.filter((r) => r !== "boost" || draft.template !== "quick")

  // 当前问题 = 修改回退行 ?? 首个未完成行
  const activeId = React.useMemo(() => {
    if (editId != null) return editId
    return VISIBLE_ROWS.find((r) => !isRowComplete(r, draft, boostTouched, assetsTouched)) ?? null
  }, [draft, boostTouched, assetsTouched, editId])
  const allDone = activeId == null

  // 资产库为空：该行直接判定完成并给说明 note
  React.useEffect(() => {
    if (assets.length === 0 && !assetsTouched) {
      setAssetsTouched(true)
      setNote((prev) => prev ?? { row: "assets", text: "资产库为空——可先到「资产库」创建角色/场景/道具/风格卡，或直接进入下一步" })
    }
  }, [assets.length, assetsTouched])

  // 新问题/就绪：滚动到对应行
  React.useEffect(() => {
    if (activeId == null) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      return
    }
    document.getElementById(`row-${activeId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [activeId])

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  /** 单选行作答（点 chip / 模板卡 / 模式卡 / 文本命中） */
  const answerSingle = (row: RowId, value: string) => {
    if (row === "genre") patch({ genre: value })
    else if (row === "style") patch({ style: value })
    else if (row === "duration") patch({ durationSec: Number(value) })
    else if (row === "aspect") patch({ aspectRatio: value as Aspect })
    else if (row === "quality") patch({ quality: value as Quality })
    else if (row === "template") {
      const t = value as WorkflowTemplate
      setBoostTouched((touched) => (t === "full" ? touched : false))
      patch({
        template: t,
        // 与旧 Wizard 的模板联动一致：quick 移除 previs；full 默认补回
        boostAgentIds: t === "quick"
          ? draft.boostAgentIds.filter((id) => id !== "previs")
          : draft.boostAgentIds.includes("previs")
            ? draft.boostAgentIds
            : [...draft.boostAgentIds, "previs"],
      })
    } else if (row === "mode") patch({ interventionMode: value as InterventionMode })
    finishAnswer(row)
  }

  const finishAnswer = (row: RowId) => {
    if (editId === row) setEditId(null)
    setNote((prev) => (prev?.row === row ? null : prev))
    setInput("")
  }

  const toggleMulti = (row: RowId, value: string) => {
    if (row === "boost") {
      const list = draft.boostAgentIds
      const next = list.includes(value)
        ? list.filter((id) => id !== value)
        : [...list, value]
      patch({ boostAgentIds: next })
      setBoostTouched(true)
    } else if (row === "assets") {
      const list = draft.assetIds
      const next = list.includes(value)
        ? list.filter((id) => id !== value)
        : [...list, value]
      patch({ assetIds: next })
      setAssetsTouched(true)
    }
  }

  /** 底部输入框发送：文本行直接写入；枚举行别名匹配 */
  const sendText = (raw: string) => {
    const text = raw.trim()
    if (!text || activeId == null) return
    if (activeId === "title") {
      patch({ title: text })
      finishAnswer("title")
      return
    }
    if (activeId === "premise") {
      if (text.length < 6) {
        setNote({ row: "premise", text: `再丰满一点，至少 6 个字（当前 ${text.length} 字）` })
        return
      }
      patch({ premise: text })
      finishAnswer("premise")
      return
    }
    // 枚举行：别名归一；未命中给提示、保留输入
    const opts = optionsFor(activeId, draft, assets)
    if (opts.length === 0) return
    const matched = matchOption(text, opts)
    if (matched == null) {
      setNote({ row: activeId, text: `没找到「${text}」对应的选项——点下面选项试试，或换个说法` })
      return
    }
    if (activeId === "boost" || activeId === "assets") {
      toggleMulti(activeId, matched)
      setInput("")
      setNote((prev) => (prev?.row === activeId ? null : prev))
      return
    }
    answerSingle(activeId, matched)
  }

  /** IME 组合态守卫：中文输入法回车不发送 */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault()
      sendText(input)
    }
  }

  const summaryText = (() => {
    const parts: string[] = []
    if (draft.title.trim()) parts.push(`《${draft.title.trim()}》`)
    else parts.push("未命名")
    if (draft.genre) parts.push(draft.genre)
    if (draft.style) parts.push(draft.style)
    if (draft.durationSec != null) parts.push(formatMinutes(draft.durationSec))
    if (draft.aspectRatio) parts.push(draft.aspectRatio)
    if (draft.quality) parts.push(QUALITY_ITEMS.find((q) => q.value === draft.quality)?.label ?? "")
    if (draft.template) parts.push(draft.template === "full" ? "完整流水线" : "快速预览")
    if (draft.interventionMode) parts.push(MODES.find((m) => m.id === draft.interventionMode)?.title ?? "")
    if (draft.boostAgentIds.length > 0) parts.push(`增强 ${draft.boostAgentIds.length}`)
    if (draft.assetIds.length > 0) parts.push(`资产 ${draft.assetIds.length}`)
    return parts.join(" · ")
  })()

  const answeredCount = VISIBLE_ROWS.filter((r) => isRowComplete(r, draft, boostTouched, assetsTouched)).length
  const totalCount = VISIBLE_ROWS.length

  const buildInput = (): NewProjectInput => ({
    title: draft.title.trim(),
    premise: draft.premise.trim(),
    genre: draft.genre ?? GENRES[0],
    style: draft.style ?? STYLES[0].id,
    durationSec: draft.durationSec ?? 120,
    aspectRatio: draft.aspectRatio ?? "16:9",
    quality: draft.quality ?? "standard",
    template: draft.template ?? "full",
    interventionMode: draft.interventionMode ?? "guided",
    assetIds: draft.assetIds,
    boostAgentIds: draft.boostAgentIds,
  })

  const submit = () => {
    if (submitting) return
    setSubmitting(true)
    dispatch({
      type: "CREATE_PROJECT",
      input: buildInput(),
      now: new Date().toISOString(),
    })
    router.push("/dashboard")
  }

  const renderOptions = (row: RowId) => {
    if (row === "style") {
      const current = draft.style
      return (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          {STYLES.map((s) => {
            const selected = current === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => answerSingle("style", s.id)}
                className={`group relative overflow-hidden rounded-lg border p-3 text-left transition-colors ${
                  selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"
                }`}
              >
                <div className={`mb-2 h-10 rounded-md bg-gradient-to-br ${s.gradient}`} />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.id}</span>
                  {selected && (
                    <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <CheckIcon className="size-2.5" />
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.desc}</p>
              </button>
            )
          })}
        </div>
      )
    }
    if (row === "template") {
      const current = draft.template
      return (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {TEMPLATES.map((t) => {
            const selected = current === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => answerSingle("template", t.id)}
                className={`relative flex flex-col gap-3 rounded-lg border p-4 text-left transition-colors ${
                  selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"
                }`}
              >
                {t.recommended && (
                  <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <SparklesIcon className="size-3" /> 推荐
                  </span>
                )}
                <div>
                  <p className="text-sm font-semibold">{t.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.desc}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {t.nodes.map((n, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <span className="text-[11px] text-muted-foreground">→</span>}
                      <span className={`rounded border px-1.5 py-0.5 text-[11px] ${n.checkpoint ? "status-warn" : "border-border text-muted-foreground"}`}>
                        {n.name}
                      </span>
                    </React.Fragment>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      )
    }
    if (row === "mode") {
      const current = draft.interventionMode
      return (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => {
            const selected = current === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => answerSingle("mode", m.id)}
                className={`relative flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-colors ${
                  selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"
                }`}
              >
                {m.recommended && (
                  <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <SparklesIcon className="size-3" /> 推荐
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <span className={`flex size-7 items-center justify-center rounded-md ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {m.icon}
                  </span>
                  <span className="text-sm font-semibold">{m.title}</span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{m.desc}</p>
                <span className="text-[11px] text-muted-foreground/70">{m.badge}</span>
              </button>
            )
          })}
          <div className="sm:col-span-2">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              干预深度谱系：
              {MODE_SPECTRUM.map((m) => (
                <span key={m} className="rounded border border-border px-1.5 py-0.5 text-[11px]">{m}</span>
              ))}
            </p>
          </div>
        </div>
      )
    }
    if (row === "boost") {
      const selectedList = draft.boostAgentIds
      return (
        <div className="mt-3 space-y-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            {BOOST_OPTIONS.map((b) => {
              const selected = selectedList.includes(b.agentId)
              return (
                <button
                  key={b.agentId}
                  type="button"
                  onClick={() => toggleMulti("boost", b.agentId)}
                  className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                    selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                  }`}
                >
                  <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                    {selected && <CheckIcon className="size-2.5" />}
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{b.title}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{b.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">完整流水线已包含的风格设定/场景等环节会自动去重跳过</p>
            <Button type="button" size="sm" onClick={() => { setBoostTouched(true); finishAnswer("boost") }}>
              继续
            </Button>
          </div>
        </div>
      )
    }
    if (row === "assets") {
      if (assets.length === 0) return null
      const cats = Object.keys(ASSET_CATEGORY_LABEL) as AssetCategory[]
      return (
        <div className="mt-3 space-y-2.5">
          {cats.map((cat) => {
            const list = assets.filter((a) => a.category === cat)
            if (list.length === 0) return null
            return (
              <div key={cat} className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{ASSET_CATEGORY_LABEL[cat]}卡</p>
                <div className="flex flex-wrap gap-2">
                  {list.map((a) => {
                    const recommended = a.tags.includes(draft.genre ?? "") || a.tags.includes(draft.style ?? "")
                    const selected = draft.assetIds.includes(a.id)
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleMulti("assets", a.id)}
                        className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                          selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                        }`}
                      >
                        <span className={`size-2 rounded-full bg-gradient-to-br ${a.color}`} />
                        <span className="text-xs font-medium">{a.name}</span>
                        {recommended && (
                          <span className="rounded bg-amber-500/15 px-1 py-px text-[11px] font-medium text-warn">推荐</span>
                        )}
                        <span className={`flex size-4 items-center justify-center rounded-full border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                          {selected && <CheckIcon className="size-2.5" />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">已选 {draft.assetIds.length} 项</p>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => { patch({ assetIds: [] }); setAssetsTouched(true); finishAnswer("assets") }}>
                暂不绑定，跳过
              </Button>
              <Button type="button" size="sm" onClick={() => { setAssetsTouched(true); finishAnswer("assets") }}>
                继续
              </Button>
            </div>
          </div>
        </div>
      )
    }
    // chips 单选行：genre / duration / aspect / quality
    const opts = optionsFor(row, draft, assets)
    if (opts.length === 0) return null
    const current = row === "duration" ? (draft.durationSec != null ? String(draft.durationSec) : null)
      : row === "quality" ? draft.quality
      : row === "aspect" ? draft.aspectRatio
      : draft.genre
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {opts.map((o) => {
          const selected = current === o.value
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => answerSingle(row, o.value)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                selected ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50"
              }`}
            >
              {o.label}
              {!selected && RECOMMENDED[row]?.includes(o.value) && (
                <span className="rounded bg-primary/10 px-1 py-px text-[10px] font-medium text-primary">推荐</span>
              )}
              {selected && <CheckIcon className="size-3" />}
            </button>
          )
        })}
      </div>
    )
  }

  /** assistant 提问气泡（含气泡底部内嵌选项；已完成行只留问题文本，不可再点） */
  const renderAsk = (row: RowId, active: boolean) => {
    const answered = isRowComplete(row, draft, boostTouched, assetsTouched)
    return (
      <div id={`row-${row}`} className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <SparklesIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className={`rounded-lg border px-4 py-3 text-sm ${active ? "border-border bg-card" : "border-transparent bg-muted/50 text-muted-foreground"}`}>
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{TITLE_TEXT[row]}</p>
              {answered && !active && (
                <button
                  type="button"
                  aria-label={`修改「${TITLE_TEXT[row]}」`}
                  onClick={() => { setEditId(row); setNote((prev) => (prev?.row === row ? null : prev)); inputRef.current?.focus() }}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-border/60 hover:text-foreground"
                >
                  <PencilIcon className="size-3" /> 修改
                </button>
              )}
            </div>
            {answered && !active ? (
              <p className="mt-0.5 text-xs text-muted-foreground/80">{rowSummary(row, draft, draft.assetIds.length)}</p>
            ) : (
              row === "assets" && assets.length === 0 ? (
                <div className="mt-3">
                  <Button type="button" size="sm" onClick={() => finishAnswer("assets")}>
                    直接进入下一步
                  </Button>
                </div>
              ) : (
                renderOptions(row)
              )
            )}
          </div>
          {note?.row === row && (
            <p className="mt-1.5 px-1 text-xs text-warn">{note.text}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      {/* 成片简报（常驻顶部） */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 rounded-lg border bg-card/95 px-3 py-2 backdrop-blur-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
          <Wand2Icon className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">{summaryText}</span>
        </div>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          {answeredCount}/{totalCount}
        </span>
      </div>

      {/* 对话消息流 */}
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <SparklesIcon className="size-3.5" />
          </span>
          <div className="rounded-lg border bg-card px-4 py-3 text-sm">
            <p className="font-medium">你好，我是 Cine Muse 的导演助手 🎬</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              告诉我你想拍什么，我会逐项确认后让智能体团队开工。也可以随时改前面的回答。
            </p>
          </div>
        </div>

        {VISIBLE_ROWS.map((row) => {
          const complete = isRowComplete(row, draft, boostTouched, assetsTouched)
          return (
            <div key={row} className="flex flex-col gap-2.5">
              {renderAsk(row, activeId === row)}
              {complete && row !== activeId && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                    {rowSummary(row, draft, draft.assetIds.length)}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {allDone && (
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <SparklesIcon className="size-3.5" />
            </span>
            <div className="rounded-lg border bg-card px-4 py-3 text-sm">
              <p className="font-medium">全部就绪 ✅ 确认一下你的成片简报</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{summaryText}</p>
              <Button type="button" className="mt-3" disabled={submitting} onClick={submit}>
                <RocketIcon /> 创建并启动
              </Button>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 底部输入栏（纯文本框；选项内嵌于提问气泡） */}
      <div className="sticky bottom-0 z-20 -mx-1 bg-background/95 px-1 pb-2 pt-1 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              activeId === "title" ? "给作品起个名字，回车确认…"
              : activeId === "premise" ? "一句话讲清你的故事（至少 6 个字）…"
              : activeId != null ? "也可以直接输入文字选择（如「竖屏」「两分钟」「4K」）…"
              : "输入框在此待命 ✨"
            }
            className="h-9"
          />
          <Button type="button" size="sm" className="h-9 shrink-0" disabled={!input.trim() || activeId == null} onClick={() => sendText(input)}>
            <SendIcon /> 发送
          </Button>
        </div>
      </div>
    </div>
  )
}
