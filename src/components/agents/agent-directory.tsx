"use client"

import * as React from "react"
import {
  BotIcon,
  GaugeIcon,
  KeyRoundIcon,
  LibraryBigIcon,
} from "lucide-react"

import { useApp } from "@/lib/store"
import { AGENT_GROUP_LABEL, type AgentGroup } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const GROUP_DESC: Record<AgentGroup, string> = {
  pre: "剧本、分镜与风格设定的创意底座",
  production: "场景与视频的实际生成环节",
  post: "配音、剪辑与成片渲染",
  qa: "质量门禁与一致性守护，贯穿全流程",
}

const STATUS_META = {
  active: { label: "在线", className: "status-done" },
  degraded: { label: "降级", className: "status-warn" },
  disabled: { label: "停用", className: "status-draft" },
}

export function AgentDirectory() {
  const { state } = useApp()
  const groups: AgentGroup[] = ["pre", "production", "post", "qa"]

  return (
    <div className="flex animate-in fade-in-0 slide-in-from-bottom-2 duration-500 flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">智能体目录</h1>
        <p className="mt-1 text-sm text-muted-foreground">查看各环节智能体的能力配置与历史表现</p>
      </div>

      {groups.map((g) => {
        const items = state.agents.filter((a) => a.group === g)
        if (items.length === 0) return null
        return (
          <section key={g} className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">{AGENT_GROUP_LABEL[g]}</h2>
              <span className="text-xs text-muted-foreground">{GROUP_DESC[g]}</span>
            </div>
            <div className="grid gap-4 @3xl:grid-cols-2 @7xl:grid-cols-3">
              {items.map((a) => {
                const st = STATUS_META[a.status]
                const kbs = state.knowledgeBases.filter((kb) => a.usesRag.includes(kb.id) && kb.enabled)
                const model = state.models.find((m) => m.id === a.modelId)
                return (
                  <Card key={a.id}>
                    <CardHeader className="flex-row items-start justify-between space-y-0">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <BotIcon className="size-4.5" />
                        </div>
                        <div>
                          <CardTitle className="flex items-center gap-2 text-sm">
                            {a.name}
                            <Badge variant="outline" className={`border ${st.className}`}>{st.label}</Badge>
                          </CardTitle>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-xs leading-relaxed text-muted-foreground">{a.description}</p>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1"><GaugeIcon className="size-3" /> 历史均分</span>
                          <span className="font-medium tabular-nums">{a.avgScore ?? "—"}/100</span>
                        </div>
                        <Progress value={a.avgScore ?? 0} className={a.avgScore == null ? "h-1 opacity-30" : "h-1"} />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <Badge variant="outline" className="gap-1 text-[11px] font-normal">
                          <KeyRoundIcon className="size-3" /> {model?.options.find((o) => o.id === model.selected)?.label ?? "未分配"}
                        </Badge>
                        {kbs.map((kb) => (
                          <Tooltip key={kb.id}>
                            <TooltipTrigger render={<Badge variant="secondary" className="gap-1 text-[11px] font-normal" />}>
                                <LibraryBigIcon className="size-3" /> {kb.name}
                              </TooltipTrigger>
                            <TooltipContent>检索 {kb.name} 增强产出</TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
