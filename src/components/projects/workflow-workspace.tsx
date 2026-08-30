"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowLeftIcon,
  CheckIcon,
  MonitorPlayIcon,
  PlayIcon,
  HourglassIcon,
} from "lucide-react"

import { MODE_META, STATUS_META } from "@/lib/meta"
import { formatMinutes } from "@/lib/format"
import { useApp, useProject } from "@/lib/store"
import type { InterventionMode } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { WorkflowCanvas } from "@/components/projects/workflow-canvas"
import { FinalPreview } from "@/components/projects/final-preview"


export function WorkflowWorkspace({ projectId }: { projectId: string }) {
  const { state, dispatch } = useApp()
  const project = useProject(projectId)
  const assets = state.assets

  if (!project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <MonitorPlayIcon className="size-10 text-muted-foreground/50" />
        <p className="text-sm font-medium">项目不存在或已被移除</p>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/dashboard" />}>
          返回工作台
        </Button>
      </div>
    )
  }

  const meta = STATUS_META[project.status]
  const modeMeta = MODE_META[project.interventionMode]
  const waiting = project.stages.filter((s) => s.status === "waiting_approval").length

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      {/* 项目标题区 */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" className="-ml-2" nativeButton={false} render={<Link href="/dashboard" aria-label="返回工作台" />}>
            <ArrowLeftIcon />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">{project.title}</h1>
          <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
          {waiting > 0 && (
            <Badge variant="outline" className="gap-1 status-warn">
              <HourglassIcon className="size-3" /> {waiting} 个节点待确认
            </Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              nativeButton={false}
              render={
                <Badge variant="outline" className={`cursor-pointer gap-1.5 px-2 py-1 ${modeMeta.className}`} />
              }
            >
              {modeMeta.icon}
              {modeMeta.label}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-xs">干预深度谱系（可随时切换）</DropdownMenuLabel>
              {(Object.keys(MODE_META) as InterventionMode[]).map((m) => (
                <DropdownMenuItem
                  key={m}
                  className="gap-2"
                  onClick={() => dispatch({ type: "SET_INTERVENTION_MODE", projectId: project.id, mode: m, now: new Date().toISOString() })}
                >
                  {MODE_META[m].icon}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">{MODE_META[m].label}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{MODE_META[m].desc}</p>
                  </div>
                  {project.interventionMode === m && <CheckIcon className="size-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <div className="px-2 py-1 text-[11px] leading-relaxed text-muted-foreground">
                切换到全自动或引导式后，待确认节点将自动通过。
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span>{formatMinutes(project.durationSec)} · {project.aspectRatio}</span>
            <span>均分 {project.avgScore ?? "—"}</span>
          </div>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">{project.premise}</p>
        {project.assets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">项目资产</span>
            {project.assets.map((b) => {
              const asset = assets.find((a) => a.id === b.assetId)
              return (
                <Badge key={b.assetId} variant="outline" className="gap-1.5 py-1 text-[11px] font-normal">
                  <span className={`size-2 shrink-0 rounded-full bg-gradient-to-br ${asset?.color ?? "bg-muted"}`} />
                  <span className="font-medium">{asset?.name ?? b.assetId}</span>
                  <span className="text-muted-foreground">· {b.role}</span>
                </Badge>
              )
            })}
            <Link href="/assets" className="text-[11px] text-primary hover:underline">
              管理资产库
            </Link>
          </div>
        )}
        <div className="flex items-center gap-3">
          <Progress value={project.progress} className="h-2 max-w-md flex-1" />
          <span className="text-xs font-medium tabular-nums text-muted-foreground">{project.progress}%</span>
          {project.status === "queued" && (
            <Button
              size="sm"
              onClick={() => dispatch({ type: "START_PROJECT", projectId: project.id, now: new Date().toISOString() })}
            >
              <PlayIcon /> 开始执行
            </Button>
          )}
        </div>
      </div>

            <WorkflowCanvas projectId={project.id} />

      {/* 成片预览 */}
      {project.status === "completed" && <FinalPreview projectId={project.id} />}
    </div>
  )
}
