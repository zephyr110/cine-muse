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
  UsersRoundIcon,
} from "lucide-react"

import { useApp } from "@/lib/store"
import { timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { CardFooter } from "@/components/ui/card"
import { ResourceCard, ResourceCardContent, ResourceCardCover, ResourceCardIcon } from "@/components/ui/resource-card"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const ICONS: Record<string, React.ReactNode> = {
  "book-open": <BookOpenIcon className="size-5" />,
  award: <AwardIcon className="size-5" />,
  palette: <PaletteIcon className="size-5" />,
  shirt: <ShirtIcon className="size-5" />,
  users: <UsersRoundIcon className="size-5" />,
  landmark: <LandmarkIcon className="size-5" />,
  music: <MusicIcon className="size-5" />,
}

const KB_GRADIENT: Record<string, string> = {
  "book-open": "from-blue-500/45 to-indigo-500/25",
  award: "from-amber-500/45 to-orange-500/25",
  palette: "from-violet-500/45 to-fuchsia-500/25",
  shirt: "from-rose-500/45 to-pink-500/25",
  users: "from-cyan-500/45 to-teal-500/25",
  landmark: "from-emerald-500/45 to-green-500/25",
  music: "from-slate-500/45 to-zinc-600/25",
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
          <Badge variant="outline">{enabled}/{state.knowledgeBases.length} 已启用</Badge>
          <Badge variant="outline">共 {state.knowledgeBases.reduce((a, b) => a + b.entries, 0).toLocaleString()} 条目</Badge>
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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {state.knowledgeBases.map((kb) => (
            <ResourceCard
              key={kb.id}
              interactive
              className={cn(!kb.enabled && "opacity-60 saturate-[0.85]")}
            >
              <ResourceCardCover className={KB_GRADIENT[kb.icon] ?? "from-emerald-500/45 to-teal-500/25"}>
                <div className="flex size-full items-center justify-center">
                  <ResourceCardIcon>
                    {ICONS[kb.icon] ?? <DatabaseIcon className="size-5" />}
                  </ResourceCardIcon>
                </div>
                <Badge className={cn("absolute left-2.5 top-2.5 border", kb.enabled ? "status-done" : "status-draft")}>
                  {kb.enabled ? "已启用" : "已停用"}
                </Badge>
              </ResourceCardCover>
              <ResourceCardContent className="gap-2.5 pb-3">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold leading-tight">{kb.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {kb.entries.toLocaleString()} 条 · 更新于 {timeAgo(kb.updatedAt)}
                  </p>
                </div>
                <p className="line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground">{kb.description}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {kb.serves.map((s) => (
                    <Badge key={s} variant="secondary" className="text-[11px] font-normal">{s}</Badge>
                  ))}
                </div>
              </ResourceCardContent>
              <CardFooter className="justify-between gap-3 bg-muted/30 py-2.5 text-[11px] text-muted-foreground">
                <span>{kb.enabled ? "参与检索增强" : "已暂停检索"}</span>
                <Tooltip>
                  <TooltipTrigger render={<div />}>
                    <Switch
                      aria-label={`${kb.enabled ? "停用" : "启用"} ${kb.name}`}
                      checked={kb.enabled}
                      onCheckedChange={() => dispatch({ type: "TOGGLE_KNOWLEDGE_BASE", kbId: kb.id, now: new Date().toISOString() })}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {kb.enabled ? "停用后各环节智能体将不再检索该知识库" : "启用后各环节智能体可检索该知识库增强产出"}
                  </TooltipContent>
                </Tooltip>
              </CardFooter>
            </ResourceCard>
          ))}
        </div>
      )}
    </div>
  )
}
