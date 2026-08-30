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
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
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
  users: <UsersRoundIcon className="size-4.5" />,
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
          <Card key={kb.id} className={`overflow-hidden pt-0! pb-0! transition-shadow hover:shadow-md ${kb.enabled ? "" : "opacity-70"}`}>
            {/* 封面：与资产卡同高的状态区 */}
            <div className="relative flex h-28 items-center justify-center bg-gradient-to-br from-emerald-500/40 to-teal-500/25">
              <div className="flex size-10 items-center justify-center rounded-xl bg-background/70 backdrop-blur">
                {ICONS[kb.icon] ?? <DatabaseIcon className="size-4.5" />}
              </div>
              <Badge className={`absolute left-2.5 top-2.5 border ${kb.enabled ? "status-done" : "status-draft"}`}>
                {kb.enabled ? "已启用" : "已停用"}
              </Badge>
            </div>
            <div className="flex flex-1 flex-col gap-3 p-4">
              <p className="text-sm font-semibold leading-tight">{kb.name}</p>
              <p className="text-xs text-muted-foreground">{kb.entries.toLocaleString()} 条 · 更新于 {timeAgo(kb.updatedAt)}</p>
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{kb.description}</p>
              <div className="mt-auto flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-muted-foreground/70">服务</span>
                {kb.serves.map((s) => (
                  <Badge key={s} variant="secondary" className="text-[11px]">{s}</Badge>
                ))}
              </div>
            </div>
            {/* 底部状态条（-mt-4 抵消 Card 内置 gap，紧贴内容区） */}
            <div className="-mt-4 flex items-center justify-between bg-muted/50 px-4 py-3">
              <span className="text-[11px] text-muted-foreground">
                {kb.enabled ? "参与智能体检索" : "不参与智能体检索"}
              </span>
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
            </div>
          </Card>
        ))}
      </div>
      )}
    </div>
  )
}
