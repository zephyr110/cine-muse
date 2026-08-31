"use client"

import * as React from "react"
import {
  CheckIcon,
  FileTextIcon,
  FilmIcon,
  ImageIcon,
  InboxIcon,
  LayoutTemplateIcon,
  LoaderCircleIcon,
  MicIcon,
  MonitorPlayIcon,
  PaletteIcon,
  PenLineIcon,
  RotateCcwIcon,
  SaveIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react"

import { PolarAngleAxis, RadialBar, RadialBarChart } from "recharts"

import { GATE_MAX_RETRIES, GATE_PASS_SCORE } from "@/lib/engine/templates"
import { useApp, useProject } from "@/lib/store"
import type { ArtifactKind, WorkflowStage } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { STAGE_STATUS_META } from "@/components/projects/workflow-canvas"

/** 基于 shadcn Chart（RadialBarChart）二次开发：质量分环形图 */
function ScoreRing({ score }: { score: number }) {
  const color = score >= GATE_PASS_SCORE ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444"
  const chartConfig = {
    score: { label: "质量分", color },
  } satisfies ChartConfig
  return (
    <div className="relative size-24 shrink-0">
      <ChartContainer config={chartConfig} className="size-full">
        <RadialBarChart
          data={[{ score }]}
          innerRadius={30}
          outerRadius={42}
          barSize={10}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
          <RadialBar dataKey="score" cornerRadius={4} background={{ fill: "var(--border)" }} />
        </RadialBarChart>
      </ChartContainer>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-2xl font-bold tabular-nums" style={{ color }}>{score}</div>
          <div className="text-[11px] text-muted-foreground">/ 100</div>
        </div>
      </div>
    </div>
  )
}

/** 产出物类型 → 图标（7 类全覆盖） */
const KIND_ICON: Record<ArtifactKind, React.ReactNode> = {
  script: <FileTextIcon className="size-4.5" />,
  storyboard: <LayoutTemplateIcon className="size-4.5" />,
  style_guide: <PaletteIcon className="size-4.5" />,
  scene: <ImageIcon className="size-4.5" />,
  video: <FilmIcon className="size-4.5" />,
  voiceover: <MicIcon className="size-4.5" />,
  final_cut: <MonitorPlayIcon className="size-4.5" />,
}

/** 分数 → 语义色（门禁通过线 75 / 及格线 60） */
function metricColor(score: number): string {
  return score >= GATE_PASS_SCORE
    ? "text-done"
    : score >= 60
      ? "text-warn"
      : "text-danger"
}

/** 空态占位：图标 + 说明（按节点状态给出上下文） */
function EmptyState({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-12 text-center">
      {icon}
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  )
}

/** 产出元数据统计卡（shadcn stat 样式） */
function StatCell({ value, unit }: { value: number; unit: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2 text-center">
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{unit}</div>
    </div>
  )
}

function ArtifactPanel({ projectId, stage }: { projectId: string; stage: WorkflowStage }) {
  const { state, dispatch } = useApp()
  const project = state.projects.find((p) => p.id === projectId)
  const a = stage.artifact
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState("")

  if (!a) {
    const busy = stage.status === "running" || stage.status === "iterating"
    const msg = busy
      ? "引擎正在生成产出…"
      : stage.status === "failed"
        ? "该环节已中断，无产出"
        : stage.status === "skipped"
          ? "该环节已被跳过"
          : stage.status === "pending"
            ? "该环节尚未开始"
            : "本环节尚无产出"
    return (
      <EmptyState
        icon={
          busy ? (
            <LoaderCircleIcon className="size-6 animate-spin text-primary/60" />
          ) : (
            <InboxIcon className="size-6 text-muted-foreground/40" />
          )
        }
      >
        {msg}
      </EmptyState>
    )
  }

  // L3 手作式：产出允许手动改写（终态/确认态）
  const editable =
    project?.interventionMode === "manual" &&
    !!a.content &&
    ["completed", "approved", "waiting_approval"].includes(stage.status)

  const startEdit = () => {
    setDraft(a.content ?? "")
    setEditing(true)
  }
  const save = () => {
    dispatch({ type: "EDIT_ARTIFACT", projectId, stageId: stage.id, content: draft, now: new Date().toISOString() })
    setEditing(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {KIND_ICON[a.kind]}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">{a.title}</p>
          <p className="text-xs text-muted-foreground">{a.summary}</p>
          {editable && (
            <Badge variant="outline" className="gap-1 status-creative text-[11px]">
              <PenLineIcon className="size-3" /> 手作式可编辑
            </Badge>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {typeof a.words === "number" && <StatCell value={a.words} unit="字" />}
            {typeof a.shots === "number" && <StatCell value={a.shots} unit="镜" />}
            {typeof a.scenes === "number" && <StatCell value={a.scenes} unit="场" />}
            {typeof a.durationSec === "number" && <StatCell value={Math.round(a.durationSec / 60)} unit="分钟" />}
          </div>
        </div>
        {editable && !editing && (
          <Button variant="outline" size="sm" className="gap-1 shrink-0" onClick={startEdit}>
            <PenLineIcon className="size-3.5" /> 编辑产出
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            rows={10}
            className="font-mono text-xs"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>取消</Button>
            <Button size="sm" className="gap-1" onClick={save}>
              <SaveIcon className="size-3.5" /> 保存修订
            </Button>
          </div>
        </div>
      ) : (
        a.content && (
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-muted/30 p-4 font-mono text-xs leading-relaxed text-foreground/90">
            {a.content}
          </pre>
        )
      )}
    </div>
  )
}

function AssessmentPanel({ stage }: { stage: WorkflowStage }) {
  const a = stage.assessment
  if (!a) {
    const busy = stage.status === "running" || stage.status === "iterating"
    return (
      <EmptyState
        icon={
          busy ? (
            <LoaderCircleIcon className="size-6 animate-spin text-primary/60" />
          ) : (
            <InboxIcon className="size-6 text-muted-foreground/40" />
          )
        }
      >
        {busy ? "引擎正在评估质量…" : "尚未产生评估"}
      </EmptyState>
    )
  }
  return (
    <div className="flex items-start gap-6">
      <ScoreRing score={a.score} />
      <div className="min-w-0 flex-1 space-y-4">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {a.metrics.map((m) => (
            <div key={m.key} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground">{m.label}</span>
                <span className={`shrink-0 font-semibold tabular-nums ${metricColor(m.value)}`}>{m.value}</span>
              </div>
              <Progress value={m.value} className="h-1.5" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">置信度 {a.confidence}%</span>
          {a.reviewer && (
            <Badge variant="outline" className="gap-1 text-[11px]">
              <ShieldCheckIcon className="size-3" /> 审查：{a.reviewer}
            </Badge>
          )}
        </div>
        <p className="rounded-lg border-l-2 border-primary/40 bg-muted/30 p-3 text-xs leading-relaxed">{a.feedback}</p>
      </div>
    </div>
  )
}

function ReviewsPanel({ stage }: { stage: WorkflowStage }) {
  if (stage.reviews.length === 0) {
    return <p className="py-8 text-center text-xs text-muted-foreground">暂无审查反馈</p>
  }
  return (
    <div className="space-y-3">
      {stage.reviews.map((r, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg border bg-card/50 p-3">
          <Badge variant={r.from === "human" ? "default" : "secondary"} className="mt-0.5 shrink-0 px-1.5 text-[11px]">
            {r.from === "human" ? "人工" : "引擎"}
          </Badge>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs leading-relaxed">{r.text}</p>
            <p className="text-[11px] text-muted-foreground">
              {new Date(r.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function IterationsPanel({ stage }: { stage: WorkflowStage }) {
  if (stage.iterations.length === 0) {
    return <p className="py-8 text-center text-xs text-muted-foreground">尚无迭代记录</p>
  }
  return (
    <>
      <p className="text-[11px] text-muted-foreground">
        共 {stage.iterations.length} 轮迭代
        {stage.status === "iterating" && <> · 当前第 {stage.iterations.length + 1} 轮进行中</>}
      </p>
      <ol className="relative space-y-4 border-l pl-6">
        {[...stage.iterations].reverse().map((it) => (
          <li key={it.round} className="relative">
            <span className="absolute top-0 -left-[31px] flex size-5 items-center justify-center rounded-full border bg-card text-[11px] font-semibold tabular-nums shadow-sm">
              {it.round}
            </span>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">第 {it.round} 轮 · 引擎重写</span>
              <span className={`flex items-center gap-1.5 text-xs tabular-nums ${metricColor(it.assessment.score)}`}>
                {it.reason && <RotateCcwIcon className="size-3" />}
                <span className="font-bold">{it.assessment.score}</span> 分
              </span>
            </div>
            {it.reason && (
              <p className="mt-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                打回原因：{it.reason}
              </p>
            )}
            <p className="mt-1.5 text-[11px] text-muted-foreground">{it.assessment.feedback}</p>
          </li>
        ))}
      </ol>
    </>
  )
}

function ApprovalActions({ projectId, stage }: { projectId: string; stage: WorkflowStage }) {
  const { dispatch } = useApp()
  const [rejecting, setRejecting] = React.useState(false)
  const [reason, setReason] = React.useState("")

  const a = stage.assessment
  const scoreColor = a ? metricColor(a.score) : "text-muted-foreground"

  const approve = () => {
    dispatch({ type: "APPROVE_STAGE", projectId, stageId: stage.id, now: new Date().toISOString() })
    setRejecting(false)
    setReason("")
  }
  const reject = () => {
    if (reason.trim().length < 2) return
    dispatch({ type: "REJECT_STAGE", projectId, stageId: stage.id, reason: reason.trim(), now: new Date().toISOString() })
    setRejecting(false)
    setReason("")
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {a && (
          <>
            <span className={`text-3xl leading-none font-bold tabular-nums ${scoreColor}`}>{a.score}</span>
            <span className="shrink-0 text-[11px] leading-tight text-muted-foreground">
              质量分
              <br />
              置信度 {a.confidence}%
            </span>
          </>
        )}
        {a && (
          <p className="min-w-0 flex-1 truncate border-l border-border/60 pl-4 text-[11px] text-muted-foreground">
            {a.feedback}
          </p>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1 text-red-600 hover:text-red-600" onClick={() => setRejecting(true)}>
            <XIcon /> 打回重写
          </Button>
          <Button size="sm" className="gap-1" onClick={approve}>
            <CheckIcon /> 批准，进入下一环节
          </Button>
        </div>
      </div>
      {rejecting && (
        <div className="space-y-2">
          <Textarea
            autoFocus
            placeholder="说明打回原因（将作为下一轮迭代的修改指令）"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>取消</Button>
            <Button size="sm" variant="destructive" disabled={reason.trim().length < 2} onClick={reject}>
              <RotateCcwIcon /> 确认打回重写
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function StageTabs({ projectId, stage }: { projectId: string; stage: WorkflowStage }) {
  // 每个环节（key=stage.id）独立挂载；默认落在"产出物"——质量分与审批操作
  // 由底部吸底审批栏常驻展示，无需切 tab 即可获得完整决策上下文
  const [tab, setTab] = React.useState("artifact")

  return (
    <>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="artifact" className="text-xs">产出物</TabsTrigger>
          <TabsTrigger value="assessment" className="text-xs">质量评估</TabsTrigger>
          <TabsTrigger value="review" className="text-xs">审查反馈</TabsTrigger>
          <TabsTrigger value="iterations" className="text-xs">
            迭代
            {stage.iterations.length > 1 && <Badge variant="secondary" className="ml-1 px-1 text-[11px]">{stage.iterations.length}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="artifact" className="pt-4">
          <ArtifactPanel projectId={projectId} stage={stage} />
        </TabsContent>
        <TabsContent value="assessment" className="pt-4">
          <AssessmentPanel stage={stage} />
        </TabsContent>
        <TabsContent value="review" className="pt-4">
          <ReviewsPanel stage={stage} />
        </TabsContent>
        <TabsContent value="iterations" className="pt-4">
          <IterationsPanel stage={stage} />
        </TabsContent>
      </Tabs>
    </>
  )
}

export function StageDetailDrawer({
  projectId,
  stage,
  onClose,
}: {
  projectId: string
  stage: WorkflowStage | null
  onClose: () => void
}) {
  const project = useProject(projectId)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  // 实时节点：面板展示引擎最新状态（打开后 tick 仍在推进），而非打开瞬间的快照
  const liveStage = stage && project
    ? (project.stages.find((s) => s.id === stage.id) ?? stage)
    : null

  // 切换节点时重置抽屉滚动位置，避免停留在上一节点的长内容深处
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [liveStage?.id])

  if (!stage || !project || !liveStage) return null

  const meta = STAGE_STATUS_META[liveStage.status]
  const stepIndex = project.stages.findIndex((s) => s.id === liveStage.id)

  return (
    <Sheet open={!!stage} onOpenChange={(open) => !open && onClose()}>
      <SheetContent ref={scrollRef} side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-3xl">
        {/* 头部吸顶：滚动长内容时保持节点身份与状态可见（pr 预留关闭按钮空间） */}
        <SheetHeader className="sticky top-0 z-10 border-b border-border/40 bg-popover/95 px-6 pt-4 pb-3 pr-12 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg border ${meta.ring}`}>
              {meta.icon}
            </div>
            <SheetTitle className="truncate text-lg tracking-tight">{liveStage.title}</SheetTitle>
            {stepIndex >= 0 && (
              <Badge variant="secondary" className="shrink-0 px-1.5 text-[11px] tabular-nums">
                {stepIndex + 1}/{project.stages.length} 步
              </Badge>
            )}
            <Badge variant="outline" className="ml-auto shrink-0">{meta.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{liveStage.description}</p>
          {liveStage.gate && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheckIcon className="size-3 text-emerald-500" />
              质量门禁：{liveStage.gateAgentName} 审查（通过线 {GATE_PASS_SCORE} 分，已打回 {liveStage.gateRetries}/{GATE_MAX_RETRIES}）
            </p>
          )}
          {["running", "iterating", "waiting_approval"].includes(liveStage.status) && (
            <div className="flex items-center gap-2">
              <Progress value={liveStage.progress} className="h-1 flex-1" />
              <span className="text-[11px] tabular-nums text-muted-foreground">{liveStage.progress}%</span>
            </div>
          )}
        </SheetHeader>

        <div className="px-6 pb-8">
          <StageTabs key={liveStage.id} projectId={projectId} stage={liveStage} />
        </div>

        {/* 审批操作栏吸底：待确认时无需滚动即可完成批准/打回（附质量分摘要） */}
        {liveStage.status === "waiting_approval" && liveStage.isCheckpoint && (
          <div className="sticky bottom-0 z-10 animate-in border-t border-border/60 bg-popover/95 px-6 pt-3 pb-3 shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.35)] backdrop-blur-sm fade-in-0 slide-in-from-bottom-2 duration-300">
            <ApprovalActions projectId={projectId} stage={liveStage} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
