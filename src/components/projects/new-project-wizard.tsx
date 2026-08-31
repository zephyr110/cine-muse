"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  EyeIcon,
  PenLineIcon,
  RocketIcon,
  SparklesIcon,
  Wand2Icon,
  ZapIcon,
} from "lucide-react"

import { BOOST_SLOTS, GENRE_LIBRARY, STYLE_LIBRARY } from "@/lib/engine/templates"
import { useApp } from "@/lib/store"
import { formatMinutes } from "@/lib/format"
import { ASSET_CATEGORY_LABEL, MODE_LABEL } from "@/lib/types"
import type {
  AssetCategory,
  InterventionMode,
  NewProjectInput,
  WorkflowTemplate,
} from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const STEPS = ["创意", "风格", "规格", "模板", "干预与资产"]

// 题材/风格列表从模板库派生：新增预设自动出现在向导中，避免双份维护漂移
const GENRES = Object.keys(GENRE_LIBRARY)

const STYLE_OPTIONS: Record<string, { desc: string; gradient: string }> = {
  赛博朋克: { desc: "霓虹蓝紫 · 雨夜反光 · 复古未来", gradient: "from-violet-500/30 via-fuchsia-500/15 to-cyan-500/30" },
  黑色电影: { desc: "低照度硬光 · 阴影切割 · 冷峻", gradient: "from-slate-600/40 via-zinc-800/30 to-slate-900/40" },
  治愈系: { desc: "暖调柔光 · 自然饱和度 · 留白", gradient: "from-amber-400/30 via-orange-300/20 to-rose-400/30" },
  古风: { desc: "水墨质感 · 低饱和青灰 · 对称", gradient: "from-emerald-600/30 via-teal-500/15 to-lime-500/25" },
  赛博国风: { desc: "霓虹 + 水墨 · 青金配色", gradient: "from-sky-500/30 via-teal-400/15 to-amber-400/30" },
  纪实: { desc: "自然光 · 手持晃动 · 真实颗粒", gradient: "from-stone-500/30 via-amber-600/15 to-stone-700/30" },
  动画: { desc: "高饱和 · 风格化形变 · 夸张透视", gradient: "from-rose-500/30 via-orange-400/20 to-yellow-400/30" },
}
const STYLES: { id: string; desc: string; gradient: string }[] = Object.keys(STYLE_LIBRARY).map(
  (id) => ({ id, ...STYLE_OPTIONS[id] }),
)

const DURATIONS = [30, 60, 90, 120, 180, 240]

const DURATION_ITEMS = DURATIONS.map((d) => ({
  value: String(d),
  label: `${d / 60} 分钟`,
}))

const QUALITY_ITEMS: { value: NewProjectInput["quality"]; label: string }[] = [
  { value: "draft", label: "草稿 (720p)" },
  { value: "standard", label: "标准 (1080p)" },
  { value: "hd", label: "高清 (4K)" },
]

const TEMPLATES: { id: WorkflowTemplate; title: string; desc: string; nodes: { name: string; checkpoint?: boolean }[]; recommended?: boolean }[] = [
  {
    id: "full",
    title: "完整流水线",
    desc: "7 个执行环节全流程协作，含质量门禁与人工确认节点",
    recommended: true,
    nodes: [
      { name: "剧本" }, { name: "门禁" }, { name: "分镜" }, { name: "门禁" },
      { name: "风格设定", checkpoint: true }, { name: "场景" }, { name: "视频" },
      { name: "门禁" }, { name: "配音" }, { name: "剪辑", checkpoint: true },
    ],
  },
  {
    id: "quick",
    title: "快速预览",
    desc: "3 个环节出粗剪样片，适合创意验证与提案",
    nodes: [{ name: "剧本" }, { name: "门禁" }, { name: "视频" }, { name: "门禁" }, { name: "成片", checkpoint: true }],
  },
]

const MODES: {
  id: InterventionMode
  title: string
  desc: string
  badge: string
  icon: React.ReactNode
  recommended?: boolean
}[] = [
  {
    id: "auto",
    title: MODE_LABEL.auto,
    desc: "零打断跑完全流程，直接交付成片",
    badge: "适合批量出片与复跑",
    icon: <ZapIcon className="size-4" />,
  },
  {
    id: "guided",
    title: MODE_LABEL.guided,
    desc: "流程不打断，agents 消费绑定资产作为强约束",
    badge: "「指定这张脸」式前置干预",
    icon: <Wand2Icon className="size-4" />,
    recommended: true,
  },
  {
    id: "review",
    title: MODE_LABEL.review,
    desc: "关键节点（风格设定、成片前）暂停人工确认",
    badge: "2 个确认点",
    icon: <EyeIcon className="size-4" />,
  },
  {
    id: "manual",
    title: MODE_LABEL.manual,
    desc: "审查式基础上，每个环节产出都可手动改写",
    badge: "全程可介入",
    icon: <PenLineIcon className="size-4" />,
  },
]

/** 干预深度谱系（L0 全自动 → L3 手作）说明 */
const MODE_SPECTRUM = (["auto", "guided", "review", "manual"] as const).map(
  (m, i) => `L${i} ${MODE_LABEL[m]}`,
)

export function NewProjectWizard() {
  const router = useRouter()
  const { state, dispatch } = useApp()
  const assets = state.assets

  const [step, setStep] = React.useState(0)
  const [submitting, setSubmitting] = React.useState(false)
  const [form, setForm] = React.useState({
    title: "",
    premise: "",
    genre: GENRES[0],
    style: STYLES[0].id,
    durationSec: 120,
    aspectRatio: "16:9" as NewProjectInput["aspectRatio"],
    quality: "standard" as NewProjectInput["quality"],
    template: "full" as WorkflowTemplate,
    interventionMode: "guided" as InterventionMode,
    assetIds: [] as string[],
    // full 模板默认开启空间预演台（可取消）；quick 模板不注入
    boostAgentIds: ["previs"],
  })

  const canNext =
    step === 0
      ? form.title.trim().length > 0 && form.premise.trim().length >= 6
      : true

  const submit = () => {
    // in-flight 防抖：双击完成按钮会重复创建项目
    if (submitting) return
    setSubmitting(true)
    dispatch({
      type: "CREATE_PROJECT",
      input: { ...form, title: form.title.trim(), assetIds: form.assetIds },
      now: new Date().toISOString(),
    })
    router.push("/dashboard")
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      {/* 步骤指示器 */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            {i > 0 && <div className={`h-px flex-1 transition-colors duration-300 ${i <= step ? "bg-primary" : "bg-border"}`} />}
            <div
              className={`flex items-center gap-1.5 text-xs font-medium transition-colors duration-300 ${
                i <= step ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <span
                className={`flex size-5 items-center justify-center rounded-full border transition-colors duration-300 ${
                  i < step
                    ? "border-primary bg-primary text-primary-foreground"
                    : i === step
                      ? "border-primary text-primary"
                      : "border-border"
                }`}
              >
                {i < step ? <CheckIcon className="size-3" /> : i + 1}
              </span>
              {s}
            </div>
          </React.Fragment>
        ))}
      </div>

      <Card key={step} className="animate-in fade-in-0 slide-in-from-bottom-2 p-6 duration-300">
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">告诉智能体团队你想拍什么</h2>
              <p className="text-sm text-muted-foreground">项目标题与一句话创意，将作为剧本撰写的种子输入</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="title">项目标题</Label>
              <Input
                id="title"
                placeholder="例如：星尘余晖"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="premise">一句话创意</Label>
              <Textarea
                id="premise"
                placeholder="例如：一个回收站的拾荒者在报废卫星中发现了地球最后的影像"
                rows={3}
                value={form.premise}
                onChange={(e) => setForm({ ...form, premise: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>题材</Label>
              <div className="flex flex-wrap gap-2">
                {GENRES.map((g) => (
                  <Button
                    key={g}
                    type="button"
                    variant={form.genre === g ? "default" : "outline"}
                    size="sm"
                    onClick={() => setForm({ ...form, genre: g })}
                  >
                    {g}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">选择视觉风格</h2>
              <p className="text-sm text-muted-foreground">风格将注入视觉风格库检索与风格设计 Agent 的提示词</p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setForm({ ...form, style: s.id })}
                  className={`group relative overflow-hidden rounded-lg border p-3 text-left transition-colors ${
                    form.style === s.id
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className={`mb-2 h-10 rounded-md bg-gradient-to-br ${s.gradient}`} />
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{s.id}</span>
                    {form.style === s.id && (
                      <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <CheckIcon className="size-2.5" />
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">设定成片规格</h2>
              <p className="text-sm text-muted-foreground">影响渲染成本与时长；创建后可在项目页调整干预模式与绑定资产</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>目标时长</Label>
                <Select
                  value={String(form.durationSec)}
                  items={DURATION_ITEMS}
                  onValueChange={(v) => setForm({ ...form, durationSec: Number(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DURATIONS.map((d) => (
                      <SelectItem key={d} value={String(d)} label={`${d / 60} 分钟`}>{d / 60} 分钟</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>画面比例</Label>
                <div className="flex gap-2">
                  {(["16:9", "9:16", "1:1"] as const).map((r) => (
                    <Button
                      key={r}
                      type="button"
                      variant={form.aspectRatio === r ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => setForm({ ...form, aspectRatio: r })}
                    >
                      {r}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>画质档位</Label>
                <Select
                  value={form.quality}
                  items={QUALITY_ITEMS}
                  onValueChange={(v) => setForm({ ...form, quality: v as NewProjectInput["quality"] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft" label="草稿 (720p)">草稿 (720p)</SelectItem>
                    <SelectItem value="standard" label="标准 (1080p)">标准 (1080p)</SelectItem>
                    <SelectItem value="hd" label="高清 (4K)">高清 (4K)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">选择工作流模板</h2>
              <p className="text-sm text-muted-foreground">模板决定编排拓扑：完整流水线（Pipeline）或快速预览（精简链路）</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      template: t.id,
                      // 模板切换时同步 previs 增强项：full 默认勾选（Set 去重），quick 移除
                      boostAgentIds:
                        t.id === "full"
                          ? [...new Set([...form.boostAgentIds, "previs"])]
                          : form.boostAgentIds.filter((id) => id !== "previs"),
                    })
                  }
                  className={`relative flex flex-col gap-3 rounded-lg border p-4 text-left transition-colors ${
                    form.template === t.id
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border hover:border-primary/50"
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
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[11px] ${
                            n.checkpoint
                              ? "status-warn"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          {n.name}
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                </button>
              ))}
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <Label>增强环节（可选）</Label>
                <span className="text-[11px] text-muted-foreground">
                  已选 {form.boostAgentIds.length} 个 · 在核心链锚点插入独立 Sub-Agent
                </span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                在最小可成片链路之上追加专项 Sub-Agent，加强对应环节的质量表现；环节数越多流程越长。
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {BOOST_SLOTS.map((b) => {
                  const selected = form.boostAgentIds.includes(b.agentId)
                  return (
                    <button
                      key={b.agentId}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          boostAgentIds: selected
                            ? form.boostAgentIds.filter((id) => id !== b.agentId)
                            : [...form.boostAgentIds, b.agentId],
                        })
                      }
                      className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                        selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                          selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                        }`}
                      >
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
              {form.template === "full" && (
                <p className="text-[11px] text-muted-foreground">
                  完整流水线已包含风格设定 / 场景生成等环节，重复的增强项会自动跳过。
                </p>
              )}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">选择干预深度与绑定资产</h2>
              <p className="text-sm text-muted-foreground">
                干预不必打断流程——绑定资产本身就是一种前置干预。档位越低越省心，档位越高越可控。
              </p>
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                干预深度谱系：
                {MODE_SPECTRUM.map((m) => (
                  <span key={m} className="rounded border border-border px-1.5 py-0.5 text-[11px]">{m}</span>
                ))}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setForm({ ...form, interventionMode: m.id })}
                  className={`relative flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-colors ${
                    form.interventionMode === m.id
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  {m.recommended && (
                    <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      <SparklesIcon className="size-3" /> 推荐
                    </span>
                  )}
                  <div className="flex items-center gap-2">
                    <span className={`flex size-7 items-center justify-center rounded-md ${form.interventionMode === m.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      {m.icon}
                    </span>
                    <span className="text-sm font-semibold">{m.title}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{m.desc}</p>
                  <span className="text-[11px] text-muted-foreground/70">{m.badge}</span>
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>绑定资产（agents 将在对应环节消费）</Label>
                <span className="text-[11px] text-muted-foreground">
                  已选 {form.assetIds.length} 项 · 按题材/风格自动推荐优先
                </span>
              </div>
              {(Object.keys(ASSET_CATEGORY_LABEL) as AssetCategory[]).map((cat) => {
                const list = assets.filter((a) => a.category === cat)
                if (list.length === 0) return null
                return (
                  <div key={cat} className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">{ASSET_CATEGORY_LABEL[cat]}卡</p>
                    <div className="flex flex-wrap gap-2">
                      {list.map((a) => {
                        const recommended = a.tags.includes(form.genre) || a.tags.includes(form.style)
                        const selected = form.assetIds.includes(a.id)
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() =>
                              setForm({
                                ...form,
                                assetIds: selected
                                  ? form.assetIds.filter((id) => id !== a.id)
                                  : [...form.assetIds, a.id],
                              })
                            }
                            className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                              selected
                                ? "border-primary bg-primary/10"
                                : "border-border hover:border-primary/40"
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
              {assets.length === 0 && (
                <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  资产库为空。可先到「资产库」创建角色/场景/道具/风格卡，或直接跳过本步骤。
                </p>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* 底部操作栏 + 实时摘要 */}
      <div className="flex items-center justify-between gap-3">
        <div className="hidden min-w-0 flex-1 items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:flex">
          <Wand2Icon className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">
            《{form.title || "未命名"}》· {form.genre} · {form.style} · {formatMinutes(form.durationSec)} · {form.aspectRatio} ·{" "}
            {form.template === "full" ? "完整流水线" : "快速预览"} ·{" "}
            {MODES.find((m) => m.id === form.interventionMode)?.title ?? "引导式"} ·{" "}
            {form.boostAgentIds.length > 0 ? `增强 ${form.boostAgentIds.length} 环节` : "无增强环节"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => (step === 0 ? router.push("/dashboard") : setStep(step - 1))}
          >
            <ArrowLeftIcon /> {step === 0 ? "返回" : "上一步"}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" disabled={!canNext} onClick={() => setStep(step + 1)}>
              下一步 <ArrowRightIcon />
            </Button>
          ) : (
            <Button type="button" onClick={submit}>
              <RocketIcon /> 创建并启动
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
