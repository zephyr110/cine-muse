"use client"

import * as React from "react"
import {
  AwardIcon,
  BookOpenIcon,
  DatabaseIcon,
  LandmarkIcon,
  LibraryBigIcon,
  MusicIcon,
  PaletteIcon,
  ShirtIcon,
  UsersIcon,
} from "lucide-react"

import { useApp } from "@/lib/store"
import { timeAgo } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const ICONS: Record<string, React.ReactNode> = {
  "book-open": <BookOpenIcon className="size-4.5" />,
  award: <AwardIcon className="size-4.5" />,
  palette: <PaletteIcon className="size-4.5" />,
  shirt: <ShirtIcon className="size-4.5" />,
  users: <UsersIcon className="size-4.5" />,
  landmark: <LandmarkIcon className="size-4.5" />,
  music: <MusicIcon className="size-4.5" />,
}

export function KnowledgeBoard() {
  const { state, dispatch } = useApp()
  const enabled = state.knowledgeBases.filter((kb) => kb.enabled).length

  return (
    <div className="flex animate-in fade-in-0 slide-in-from-bottom-2 duration-500 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">知识库</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            为智能体提供剧本结构、视觉风格等专业领域的检索增强
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-1"><DatabaseIcon className="size-3" /> {enabled}/{state.knowledgeBases.length} 已启用</Badge>
          <Badge variant="outline" className="gap-1"><LibraryBigIcon className="size-3" /> 共 {state.knowledgeBases.reduce((a, b) => a + b.entries, 0).toLocaleString()} 条目</Badge>
        </div>
      </div>

      {state.knowledgeBases.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-14 text-center">
          <LibraryBigIcon className="size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">还没有知识库</p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground/70">
            接入引擎后，剧本结构、视觉风格等专业语料将在这里自动挂载，供各环节智能体检索增强。
          </p>
        </div>
      ) : (
      <div className="grid gap-4 @3xl:grid-cols-2 @7xl:grid-cols-3">
        {state.knowledgeBases.map((kb) => (
          <Card key={kb.id} className={kb.enabled ? "" : "opacity-70"}>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {ICONS[kb.icon] ?? <DatabaseIcon className="size-4.5" />}
                </div>
                <div>
                  <CardTitle className="flex items-center gap-1.5 text-sm">
                    {kb.name}
                    {!kb.enabled && (
                      <Badge variant="outline" className="text-[10px] status-draft">已停用</Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">{kb.entries.toLocaleString()} 条 · 更新于 {timeAgo(kb.updatedAt)}</p>
                </div>
              </div>
              <Tooltip>
                <TooltipTrigger render={<div />}>
                    <Switch
                      checked={kb.enabled}
                      onCheckedChange={() => dispatch({ type: "TOGGLE_KNOWLEDGE_BASE", kbId: kb.id, now: new Date().toISOString() })}
                    />
                  </TooltipTrigger>
                <TooltipContent>{kb.enabled ? "点击停用该知识库" : "点击启用该知识库"}</TooltipContent>
              </Tooltip>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs leading-relaxed text-muted-foreground">{kb.description}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground/70">服务</span>
                {kb.serves.map((s) => (
                  <Badge key={s} variant="secondary" className="text-[11px]">{s}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      )}
    </div>
  )
}
