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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { NoData } from "@/components/ui/no-data"
import { Progress } from "@/components/ui/progress"

export function ProjectCard({ project }: { project: Project }) {
  const meta = STATUS_META[project.status]
  const waitingStages = project.stages.filter((s) => s.status === "waiting_approval")
  const nextStage = project.stages.find((s) => s.status === "running" || s.status === "iterating")

  return (
    <Card className="group overflow-hidden pt-0! transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg">
      <Link
        href={`/projects?id=${project.id}`}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
      >
        {/* 封面：高度高于资产/知识库卡，匹配宽卡片比例；图标沿用统一的徽章式容器 */}
        <div className={`relative flex h-36 items-center justify-center bg-gradient-to-br ${project.cover}`}>
          <div className="flex size-10 items-center justify-center rounded-xl bg-background/70 backdrop-blur transition-transform duration-300 group-hover:scale-110">
            <FilmIcon className="size-5" />
          </div>
          <Badge className={`absolute left-2.5 top-2.5 border ${meta.className}`}>{meta.label}</Badge>
          {waitingStages.length > 0 && (
            <Badge className="absolute right-2.5 top-2.5 gap-1 status-warn">
              <HourglassIcon className="size-3" /> 待确认 {waitingStages.length}
            </Badge>
          )}
        </div>
        <CardHeader className="pt-4 pb-3">
          <CardTitle className="text-base leading-tight">{project.title}</CardTitle>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {project.genre} · {project.style} · {formatMinutes(project.durationSec)} · {project.aspectRatio}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* min-h-10 与两行高度一致：不同行数的 premise 下，状态行与进度条跨卡片对齐 */}
          <p className="line-clamp-2 min-h-12 text-sm leading-relaxed text-muted-foreground">{project.premise}</p>
          <div className="space-y-1.5">
            <div className="flex h-4 items-center gap-1.5 text-xs text-muted-foreground">
              {nextStage && (
                <span className="flex min-w-0 items-center gap-1">
                  <LoaderCircleIcon className="size-3 shrink-0 animate-spin" />
                  <span className="truncate">{nextStage.title}</span>
                </span>
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
    </Card>
  )
}

const GROUPS: {
  key: "idle" | "active" | "done"
  label: string
  hint: string
  icon: React.ReactNode
  accent: string
}[] = [
  { key: "idle", label: "待处理", hint: "排队中与已中断的项目", icon: <InboxIcon className="size-4" />, accent: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  { key: "active", label: "进行中", hint: "执行中与待人工确认的项目", icon: <LoaderCircleIcon className="size-4" />, accent: "bg-primary/15 text-primary" },
  { key: "done", label: "已完成", hint: "全流程交付的成片项目", icon: <CheckCircle2Icon className="size-4" />, accent: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
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
    <div className="space-y-4">
      {GROUPS.map((g) => {
        const items = groups[g.key]
        const open = !collapsed[g.key]
        return (
          <Card key={g.key} className="overflow-hidden">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setCollapsed((prev) => ({ ...prev, [g.key]: !prev[g.key] }))}
              className="flex w-full items-center gap-3 p-4 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 active:bg-muted/60"
            >
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${g.accent}`}>
                {g.icon}
              </span>
              <span className="text-sm font-semibold">{g.label}</span>
              <Badge variant="secondary" className="text-xs tabular-nums">{items.length}</Badge>
              <span className="hidden text-xs text-muted-foreground sm:inline">{g.hint}</span>
              <ChevronDownIcon
                className={`ml-auto size-4 text-muted-foreground transition-transform duration-300 ${open ? "" : "-rotate-90"}`}
              />
            </button>
            {/* grid-rows 过渡：折叠/展开带平滑动画（0fr → 1fr） */}
            <div
              className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                {/* @container：让网格的 @3xl/@7xl 容器查询生效（修复此前恒为单列的问题） */}
                <div className="@container bg-muted/30 p-4">
                  {items.length > 0 ? (
                    <div className="grid gap-4 @3xl:grid-cols-2 @7xl:grid-cols-3">
                      {items.map((p) => (
                        <ProjectCard key={p.id} project={p} />
                      ))}
                    </div>
                  ) : (
                    <NoData text={`暂无${g.label}的项目`} />
                  )}
                </div>
              </div>
            </div>
          </Card>
        )
      })}
      {projects.length === 0 && (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <ClapperboardIcon className="size-10 text-muted-foreground/50" />
          <div className="space-y-1">
            <p className="text-sm font-medium">还没有项目</p>
            <p className="text-xs text-muted-foreground">从一句创意开始，让智能体团队完成从剧本到成片的全流程</p>
          </div>
          <Button size="sm" nativeButton={false} render={<Link href="/projects/new" />}>
            创建第一个项目
          </Button>
        </Card>
      )}
    </div>
  )
}
