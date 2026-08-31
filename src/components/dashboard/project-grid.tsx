"use client"

import * as React from "react"
import Link from "next/link"
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ClapperboardIcon,
  FilmIcon,
  GaugeIcon,
  InboxIcon,
  LoaderCircleIcon,
  HourglassIcon,
} from "lucide-react"

import { useProjects } from "@/lib/store"
import { formatMinutes } from "@/lib/format"
import { STATUS_META } from "@/lib/meta"
import type { Project } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { NoData } from "@/components/ui/no-data"
import { Progress } from "@/components/ui/progress"
import { ResourceCard, ResourceCardCover, ResourceCardIcon } from "@/components/ui/resource-card"

export function ProjectCard({ project }: { project: Project }) {
  const meta = STATUS_META[project.status]
  const waitingStages = project.stages.filter((s) => s.status === "waiting_approval")
  const nextStage = project.stages.find((s) => s.status === "running" || s.status === "iterating")

  return (
    <ResourceCard interactive>
      <Link
        href={`/projects?id=${project.id}`}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
      >
        <ResourceCardCover size="lg" className={project.cover}>
          <div className="flex size-full items-center justify-center">
            <ResourceCardIcon>
              <FilmIcon className="size-5" />
            </ResourceCardIcon>
          </div>
          <Badge className={`absolute left-2.5 top-2.5 border ${meta.className}`}>{meta.label}</Badge>
          {waitingStages.length > 0 && (
            <Badge className="absolute right-2.5 top-2.5 gap-1 status-warn">
              <HourglassIcon className="size-3" /> 待确认 {waitingStages.length}
            </Badge>
          )}
        </ResourceCardCover>
        <CardHeader className="pt-4 pb-2">
          <CardTitle className="text-base leading-tight">{project.title}</CardTitle>
          <CardDescription className="line-clamp-1 text-xs">
            {project.genre} · {project.style} · {formatMinutes(project.durationSec)} · {project.aspectRatio}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pb-4">
          <p className="line-clamp-2 min-h-12 text-sm leading-relaxed text-muted-foreground">{project.premise}</p>
          <div className="flex flex-col gap-1.5">
            <div className="flex h-4 items-center gap-1.5 text-xs text-muted-foreground">
              {nextStage ? (
                <span className="flex min-w-0 items-center gap-1">
                  <LoaderCircleIcon className="size-3 shrink-0 animate-spin" />
                  <span className="truncate">{nextStage.title}</span>
                </span>
              ) : (
                <span className="text-muted-foreground/50">—</span>
              )}
              <span className="ml-auto flex items-center gap-1 font-medium tabular-nums">
                <GaugeIcon className="size-3" />
                {project.avgScore ?? "—"}
              </span>
            </div>
            <Progress value={project.progress} className="h-1.5" />
          </div>
        </CardContent>
      </Link>
    </ResourceCard>
  )
}

const GROUPS: {
  key: "idle" | "active" | "done"
  label: string
  hint: string
  icon: React.ReactNode
  accent: string
}[] = [
  { key: "idle", label: "待处理", hint: "排队中与已中断的项目", icon: <InboxIcon className="size-4" />, accent: "bg-amber-500/10 text-amber-500" },
  { key: "active", label: "进行中", hint: "执行中与待人工确认的项目", icon: <LoaderCircleIcon className="size-4" />, accent: "bg-primary/10 text-primary" },
  { key: "done", label: "已完成", hint: "全流程交付的成片项目", icon: <CheckCircle2Icon className="size-4" />, accent: "bg-emerald-500/10 text-emerald-500" },
]

export function ProjectGrid() {
  const projects = useProjects()
  // 折叠状态（内存级：刷新恢复全展开，避免 hydration 不一致）
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})

  const groups = React.useMemo(
    () => ({
      idle: projects.filter((p) => ["queued", "failed", "draft"].includes(p.status)),
      active: projects.filter((p) => ["executing", "waiting_approval"].includes(p.status)),
      done: projects.filter((p) => p.status === "completed"),
    }),
    [projects],
  )

  return (
    <div className="flex flex-col gap-4">
      {GROUPS.map((g) => {
        const items = groups[g.key]
        const open = !collapsed[g.key]
        const panelId = `project-group-${g.key}`
        return (
          <Card key={g.key} className="gap-0 overflow-hidden py-0">
            <CardHeader className="p-0">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setCollapsed((prev) => ({ ...prev, [g.key]: !prev[g.key] }))}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3.5 text-left outline-none transition-colors",
                  "hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
                  "active:bg-muted/60",
                  open && "border-b border-border",
                )}
              >
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", g.accent)}>
                  {g.icon}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-medium">{g.label}</CardTitle>
                    <Badge
                      variant="secondary"
                      className="h-5 min-w-5 justify-center rounded-full px-1.5 text-[11px] font-normal tabular-nums"
                    >
                      {items.length}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-1 text-xs">{g.hint}</CardDescription>
                </div>
                <ChevronDownIcon
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
                    !open && "-rotate-90",
                  )}
                />
              </button>
            </CardHeader>
            {/* grid-rows 过渡：折叠/展开带平滑动画（0fr → 1fr） */}
            <div
              id={panelId}
              aria-hidden={!open}
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <CardContent className={cn("bg-muted/20", open && "py-4")}>
                  {/* @container：让网格的 @3xl/@7xl 容器查询生效 */}
                  <div className="@container">
                    {items.length > 0 ? (
                      <div className="grid gap-4 @3xl:grid-cols-2 @7xl:grid-cols-3">
                        {items.map((p) => (
                          <ProjectCard key={p.id} project={p} />
                        ))}
                      </div>
                    ) : (
                      <NoData text={`暂无${g.label}的项目`} className="py-8" />
                    )}
                  </div>
                </CardContent>
              </div>
            </div>
          </Card>
        )
      })}
      {projects.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <ClapperboardIcon className="size-5 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">还没有项目</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                从一句创意开始，让智能体团队完成从剧本到成片的全流程
              </p>
            </div>
            <Button size="sm" nativeButton={false} render={<Link href="/projects/new" />}>
              创建第一个项目
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
