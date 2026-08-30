"use client"

import * as React from "react"
import {
  CheckIcon,
  ChevronRightIcon,
  CircleIcon,
  EyeIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SkipForwardIcon,
  TriangleAlertIcon,
  UserCheckIcon,
  XIcon,
} from "lucide-react"

import { GATE_MAX_RETRIES } from "@/lib/engine/templates"
import { useApp, useProject } from "@/lib/store"
import type { StageStatus, WorkflowStage } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { StageDetailDrawer } from "@/components/projects/stage-detail-drawer"

export const STAGE_STATUS_META: Record<
  StageStatus,
  { label: string; ring: string; icon: React.ReactNode; badge?: string }
> = {
  pending: {
    label: "排队中",
    ring: "border-border bg-card",
    icon: <CircleIcon className="size-4 text-muted-foreground/60" />,
  },
  running: {
    label: "执行中",
    ring: "border-blue-500/50 bg-blue-500/5",
    icon: <LoaderCircleIcon className="size-4 animate-spin text-blue-500" />,
  },
  iterating: {
    label: "迭代重写",
    ring: "border-violet-500/50 bg-violet-500/5",
    icon: <RefreshCwIcon className="size-4 animate-spin text-violet-500" />,
  },
  waiting_approval: {
    label: "待确认",
    ring: "border-amber-500/60 bg-amber-500/5",
    icon: <UserCheckIcon className="size-4 text-amber-500" />,
  },
  approved: {
    label: "已确认",
    ring: "border-emerald-500/40 bg-emerald-500/5",
    icon: <CheckIcon className="size-4 text-emerald-500" />,
  },
  rejected: {
    label: "已打回",
    ring: "border-red-500/40 bg-red-500/5",
    icon: <XIcon className="size-4 text-red-500" />,
  },
  completed: {
    label: "已完成",
    ring: "border-emerald-500/40 bg-emerald-500/5",
    icon: <CheckIcon className="size-4 text-emerald-500" />,
  },
  failed: {
    label: "已中断",
    ring: "border-red-500/60 bg-red-500/5",
    icon: <TriangleAlertIcon className="size-4 text-red-500" />,
  },
  skipped: {
    label: "已跳过",
    ring: "border-dashed border-border bg-muted/30",
    icon: <SkipForwardIcon className="size-4 text-muted-foreground/60" />,
  },
}

function StageCard({
  stage,
  index,
  total,
  projectId,
  onOpen,
}: {
  stage: WorkflowStage
  index: number
  total: number
  projectId: string
  onOpen: (stage: WorkflowStage) => void
}) {
  const meta = STAGE_STATUS_META[stage.status]
  const { dispatch } = useApp()

  return (
    <React.Fragment>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(stage)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onOpen(stage)
          }
        }}
        className="group relative flex w-44 shrink-0 cursor-pointer flex-col gap-2 rounded-lg border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <div className={`absolute inset-0 rounded-lg ${meta.ring}`} aria-hidden />
        <div className="relative flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium">
            {meta.icon}
            <span className={stage.status === "pending" ? "text-muted-foreground" : ""}>{meta.label}</span>
          </div>
          {stage.gate && (
            <Tooltip>
              <TooltipTrigger render={<Badge variant="outline" className="px-1.5 text-[11px] font-normal text-muted-foreground" />}>
                门禁
              </TooltipTrigger>
              <TooltipContent>{stage.gateAgentName} 质量审查</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="relative space-y-1">
          <p className="text-sm font-medium leading-tight">{stage.title}</p>
          <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{stage.description}</p>
        </div>
        <div className="relative space-y-1.5">
          {stage.status === "waiting_approval" && (
            <Button size="sm" variant="outline" className="w-full gap-1 border-amber-500/50 text-warn" onClick={(e) => { e.stopPropagation(); onOpen(stage) }}>
              <EyeIcon className="size-3.5" /> 审核确认
            </Button>
          )}
          {stage.status === "failed" && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="flex-1 text-[11px]" onClick={(e) => { e.stopPropagation(); dispatch({ type: "SKIP_STAGE", projectId, stageId: stage.id, now: new Date().toISOString() }) }}>
                跳过
              </Button>
            </div>
          )}
          {(stage.status === "running" || stage.status === "iterating") && (
            <Progress value={stage.progress} className="h-1.5" />
          )}
          {stage.assessment && stage.status !== "running" && stage.status !== "iterating" && (
            <div className="flex items-center gap-1 text-[11px]">
              <span className="font-semibold tabular-nums text-muted-foreground">{stage.assessment.score}</span>
              <span className="text-muted-foreground/60">分</span>
              {stage.gateRetries > 0 && (
                <Badge variant="outline" className="ml-auto px-1.5 text-[11px] font-normal text-muted-foreground">
                  打回 {stage.gateRetries}/{GATE_MAX_RETRIES}
                </Badge>
              )}
            </div>
          )}
        </div>
        <span className="absolute -top-2 left-2 bg-card px-1 text-[11px] tabular-nums text-muted-foreground/70">
          {index + 1}/{total}
        </span>
      </div>
      {index < total - 1 && (
        <ChevronRightIcon className="size-4 shrink-0 self-center text-muted-foreground/30" />
      )}
    </React.Fragment>
  )
}

export function WorkflowCanvas({ projectId }: { projectId: string }) {
  const project = useProject(projectId)
  const [activeStage, setActiveStage] = React.useState<WorkflowStage | null>(null)
  const { dispatch } = useApp()

  if (!project) return null

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">多智能体工作流</h2>
          <p className="text-xs text-muted-foreground">
            {project.template === "full" ? "完整流水线" : "快速预览"} · Pipeline 编排 · 点击节点查看详情
          </p>
        </div>
        {project.status === "failed" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              // 中断项目：跳过所有非终态节点以恢复流程（演示降级方案）
              const now = new Date().toISOString()
              project.stages
                .filter((s) => !["completed", "approved", "skipped"].includes(s.status))
                .forEach((s) => dispatch({ type: "SKIP_STAGE", projectId, stageId: s.id, now }))
            }}
          >
            <SkipForwardIcon /> 降级跳过失败环节
          </Button>
        )}
      </div>
      <Card className="overflow-x-auto p-5">
        <div className="flex min-w-max items-stretch gap-1">
          {project.stages.map((s, i) => (
            <StageCard key={s.id} stage={s} index={i} total={project.stages.length} projectId={projectId} onOpen={setActiveStage} />
          ))}
        </div>
      </Card>

      <StageDetailDrawer
        projectId={projectId}
        stage={activeStage}
        onClose={() => setActiveStage(null)}
      />
    </section>
  )
}
