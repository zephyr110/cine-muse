"use client"

import * as React from "react"
import {
  ClapperboardIcon,
  DownloadIcon,
  MonitorPlayIcon,
  PlayIcon,
  Share2Icon,
  SparklesIcon,
} from "lucide-react"
import { toast } from "sonner"

import { useProject } from "@/lib/store"
import { formatMinutes } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function FinalPreview({ projectId }: { projectId: string }) {
  const project = useProject(projectId)
  const [playing, setPlaying] = React.useState(false)
  if (!project) return null

  const cut = project.stages.find((s) => s.artifact?.kind === "final_cut")?.artifact

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <SparklesIcon className="size-4 text-emerald-500" />
          成片预览
        </h2>
        <p className="text-xs text-muted-foreground">全流程已完成，产出可直接交付</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClapperboardIcon className="size-4 text-muted-foreground" />
            {cut?.title ?? `${project.title} · 成片`}
          </CardTitle>
          <Badge variant="outline" className="text-[11px]">MP4 · 已渲染</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 播放器占位 */}
          <div className="relative aspect-video overflow-hidden rounded-lg bg-gradient-to-br from-zinc-900 to-black">
            <div className={`absolute inset-0 bg-gradient-to-br ${project.cover} opacity-40`} />
            {playing ? (
              <button
                type="button"
                aria-label="停止播放"
                onClick={() => setPlaying(false)}
                className="absolute inset-0 grid place-items-center"
              >
                <span className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-xs text-white transition-colors hover:bg-black/75">
                  <MonitorPlayIcon className="size-4 animate-pulse" />
                  正在播放预览画面 · 点击停止
                </span>
              </button>
            ) : (
              <button
                type="button"
                aria-label="播放成片"
                onClick={() => setPlaying(true)}
                className="absolute inset-0 grid place-items-center"
              >
                <span className="grid size-14 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition-transform hover:scale-110">
                  <PlayIcon className="ml-0.5 size-6" />
                </span>
              </button>
            )}
            <div className="absolute bottom-3 left-3 flex gap-1.5">
              {project.stages.filter((s) => s.artifact?.kind === "video").length > 0 && (
                <Badge className="bg-black/50 text-white">视频片段已合成</Badge>
              )}
              <Badge className="bg-black/50 text-white">{formatMinutes(project.durationSec)} · {project.aspectRatio}</Badge>
            </div>
          </div>

          {/* 元数据 + 操作 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{cut?.summary}</span>
              <span>·</span>
              <span>均分 {project.avgScore ?? "—"}</span>
              <span>·</span>
              <span>全流程 {project.stages.length} 个环节通过</span>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger render={<Button size="sm" variant="outline" onClick={() => toast.info("导出任务已创建，已加入后台队列")} />}>
                    <DownloadIcon /> 导出
                  </TooltipTrigger>
                <TooltipContent>真实渲染导出将在接入引擎后开放</TooltipContent>
              </Tooltip>
              <Button size="sm" variant="outline" onClick={() => toast.info("分享链接已复制")}>
                <Share2Icon /> 分享
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
