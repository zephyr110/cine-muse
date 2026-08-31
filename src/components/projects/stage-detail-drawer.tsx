"use client"

import * as React from "react"
import { LoaderCircleIcon, ShieldCheckIcon } from "lucide-react"

import { PolarAngleAxis, RadialBar, RadialBarChart } from "recharts"

import { GATE_MAX_RETRIES, GATE_PASS_SCORE } from "@/lib/engine/templates"
import { useApp, useProject } from "@/lib/store"
import type { ArtifactKind, WorkflowStage } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { Button } from "@/components/ui/button"
import { NoData } from "@/components/ui/no-data"
import { Progress } from "@/components/ui/progress"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { STAGE_STATUS_META } from "@/components/projects/workflow-canvas"

/** 基于 shadcn Chart（RadialBarChart）二次开发：质量分环形图 */
function ScoreRing({ score }: { score: number }) {
  const scoreFill =
    score >= GATE_PASS_SCORE
      ? "[--score-fill:var(--color-emerald-600)] dark:[--score-fill:var(--color-emerald-400)]"
      : score >= 60
        ? "[--score-fill:var(--color-amber-600)] dark:[--score-fill:var(--color-amber-400)]"
        : "[--score-fill:var(--color-red-600)] dark:[--score-fill:var(--color-red-400)]"
  const chartConfig = {
    score: { label: "质量分", color: "var(--score-fill)" },
  } satisfies ChartConfig
  return (
    <div className={cn("relative size-24 shrink-0", scoreFill)}>
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
          <RadialBar dataKey="score" fill="var(--score-fill)" cornerRadius={4} background={{ fill: "var(--border)" }} />
        </RadialBarChart>
      </ChartContainer>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-2xl font-bold tabular-nums text-(--score-fill)">{score}</div>
          <div className="text-xs text-muted-foreground">/ 100</div>
        </div>
      </div>
    </div>
  )
}

const KIND_LABEL: Record<ArtifactKind, string> = {
  script: "剧本",
  storyboard: "分镜",
  style_guide: "风格指南",
  scene: "场景图",
  video: "视频",
  voiceover: "配音",
  final_cut: "成片",
}

/** 分数 → 语义色（门禁通过线 75 / 及格线 60） */
function metricColor(score: number): string {
  return score >= GATE_PASS_SCORE
    ? "text-done"
    : score >= 60
      ? "text-warn"
      : "text-danger"
}

function StatCell({ value, unit }: { value: number; unit: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border bg-muted/30 px-3 py-2">
      <span className="text-base font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{unit}</span>
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
    return busy ? (
      <NoData icon={<LoaderCircleIcon className="size-6 animate-spin text-primary/60" />} text="引擎正在生成产出…" />
    ) : (
      <NoData />
    )
  }

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
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[11px] font-normal">
              {KIND_LABEL[a.kind]}
            </Badge>
            {editable && (
              <Badge variant="outline" className="status-creative text-xs">
                手作式可编辑
              </Badge>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium leading-snug">{a.title}</p>
            <p className="text-xs text-muted-foreground">{a.summary}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {typeof a.words === "number" && <StatCell value={a.words} unit="字" />}
            {typeof a.shots === "number" && <StatCell value={a.shots} unit="镜" />}
            {typeof a.scenes === "number" && <StatCell value={a.scenes} unit="场" />}
            {typeof a.durationSec === "number" && <StatCell value={Math.round(a.durationSec / 60)} unit="分钟" />}
          </div>
        </div>
        {editable && !editing && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={startEdit}>
            编辑
          </Button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            rows={10}
            className="font-mono text-xs"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button size="sm" onClick={save}>
              保存修订
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
    return busy ? (
      <NoData icon={<LoaderCircleIcon className="size-6 animate-spin text-primary/60" />} text="引擎正在评估质量…" />
    ) : (
      <NoData />
    )
  }
  return (
    <div className="flex items-start gap-4">
      <ScoreRing score={a.score} />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          {a.metrics.map((m) => (
            <div key={m.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground">{m.label}</span>
                <span className={cn("shrink-0 font-semibold tabular-nums", metricColor(m.value))}>{m.value}</span>
              </div>
              <Progress value={m.value} className="h-1.5" />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>置信度 {a.confidence}%</span>
          {a.reviewer && (
            <>
              <span aria-hidden className="text-border">·</span>
              <span>审查 {a.reviewer}</span>
            </>
          )}
        </div>
        <p className="rounded-lg bg-muted/30 p-3 text-xs leading-relaxed text-foreground/90">{a.feedback}</p>
      </div>
    </div>
  )
}

function ReviewsPanel({ stage }: { stage: WorkflowStage }) {
  if (stage.reviews.length === 0) {
    return <NoData />
  }
  return (
    <div className="flex flex-col gap-3">
      {stage.reviews.map((r, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border bg-card/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <Badge variant={r.from === "human" ? "default" : "secondary"} className="text-xs">
              {r.from === "human" ? "人工" : "引擎"}
            </Badge>
            <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {new Date(r.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </time>
          </div>
          <p className="text-xs leading-relaxed">{r.text}</p>
        </div>
      ))}
    </div>
  )
}

function IterationsPanel({ stage }: { stage: WorkflowStage }) {
  if (stage.iterations.length === 0) {
    return <NoData />
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        共 {stage.iterations.length} 轮迭代
        {stage.status === "iterating" && <> · 当前第 {stage.iterations.length + 1} 轮进行中</>}
      </p>
      <ol className="relative flex flex-col gap-4 border-l border-border pl-6">
        {[...stage.iterations].reverse().map((it) => (
          <li key={it.round} className="relative">
            <span className="absolute top-0 -left-[31px] flex size-5 items-center justify-center rounded-full border bg-card text-[11px] font-semibold tabular-nums shadow-sm">
              {it.round}
            </span>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium">第 {it.round} 轮 · 引擎重写</span>
              <span className={cn("shrink-0 text-xs tabular-nums", metricColor(it.assessment.score))}>
                <span className="font-bold">{it.assessment.score}</span> 分
              </span>
            </div>
            {it.reason && (
              <p className="mt-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs leading-relaxed text-warn">
                打回原因：{it.reason}
              </p>
            )}
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{it.assessment.feedback}</p>
          </li>
        ))}
      </ol>
    </div>
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
    <div className="flex flex-col gap-3">
      {a && (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="flex items-baseline gap-2">
            <span className={cn("text-3xl font-bold tabular-nums leading-none", scoreColor)}>{a.score}</span>
            <span className="text-xs leading-tight text-muted-foreground">
              质量分
              <br />
              置信度 {a.confidence}%
            </span>
          </div>
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground sm:border-l sm:border-border/60 sm:pl-4">
            {a.feedback}
          </p>
        </div>
      )}
      {!rejecting ? (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>
            打回重写
          </Button>
          <Button size="sm" onClick={approve}>
            批准，进入下一环节
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            placeholder="说明打回原因（将作为下一轮迭代的修改指令）"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              取消
            </Button>
            <Button size="sm" variant="destructive" disabled={reason.trim().length < 2} onClick={reject}>
              确认打回
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function StageTabs({ projectId, stage }: { projectId: string; stage: WorkflowStage }) {
  const [tab, setTab] = React.useState("artifact")

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="artifact" className="text-xs">
          产出物
        </TabsTrigger>
        <TabsTrigger value="assessment" className="text-xs">
          质量评估
        </TabsTrigger>
        <TabsTrigger value="review" className="text-xs">
          审查反馈
        </TabsTrigger>
        <TabsTrigger value="iterations" className="text-xs">
          迭代
          {stage.iterations.length > 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5 text-[11px] tabular-nums">
              {stage.iterations.length}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="artifact" className="flex flex-1 flex-col pt-4">
        <ArtifactPanel projectId={projectId} stage={stage} />
      </TabsContent>
      <TabsContent value="assessment" className="flex flex-1 flex-col pt-4">
        <AssessmentPanel stage={stage} />
      </TabsContent>
      <TabsContent value="review" className="flex flex-1 flex-col pt-4">
        <ReviewsPanel stage={stage} />
      </TabsContent>
      <TabsContent value="iterations" className="flex flex-1 flex-col pt-4">
        <IterationsPanel stage={stage} />
      </TabsContent>
    </Tabs>
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
  const liveStage = stage && project
    ? (project.stages.find((s) => s.id === stage.id) ?? stage)
    : null

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [liveStage?.id])

  if (!stage || !project || !liveStage) return null

  const meta = STAGE_STATUS_META[liveStage.status]
  const stepIndex = project.stages.findIndex((s) => s.id === liveStage.id)
  const showProgress = ["running", "iterating", "waiting_approval"].includes(liveStage.status)

  return (
    <Sheet open={!!stage} onOpenChange={(open) => !open && onClose()}>
      <SheetContent ref={scrollRef} side="right" className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="sticky top-0 z-10 gap-2 border-b border-border/40 bg-popover/95 px-6 pt-4 pb-3 pr-12 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border", meta.ring)}>
              {meta.icon}
            </div>
            <SheetTitle className="truncate text-lg tracking-tight">{liveStage.title}</SheetTitle>
            {stepIndex >= 0 && (
              <Badge variant="secondary" className="shrink-0 px-2 text-xs tabular-nums">
                {stepIndex + 1}/{project.stages.length}
              </Badge>
            )}
            <Badge variant="outline" className="ml-auto shrink-0">
              {meta.label}
            </Badge>
          </div>
          <SheetDescription className="text-xs">{liveStage.description}</SheetDescription>
          {liveStage.gate && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                质量门禁：{liveStage.gateAgentName} 审查（通过线 {GATE_PASS_SCORE} 分，已打回 {liveStage.gateRetries}/{GATE_MAX_RETRIES}）
              </span>
            </p>
          )}
          {showProgress && (
            <div className="flex items-center gap-2 pt-0.5">
              <Progress value={liveStage.progress} className="h-1 flex-1" />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{liveStage.progress}%</span>
            </div>
          )}
        </SheetHeader>

        <div className="flex flex-1 flex-col px-6 py-5">
          <StageTabs key={liveStage.id} projectId={projectId} stage={liveStage} />
        </div>

        {liveStage.status === "waiting_approval" && liveStage.isCheckpoint && (
          <div className="sticky bottom-0 z-10 animate-in border-t border-border/60 bg-popover/95 px-6 py-3 backdrop-blur-sm fade-in-0 slide-in-from-bottom-2 duration-300">
            <ApprovalActions projectId={projectId} stage={liveStage} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
