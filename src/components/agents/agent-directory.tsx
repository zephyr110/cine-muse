"use client"

import * as React from "react"
import {
  BotIcon,
  CpuIcon,
  LibraryBigIcon,
} from "lucide-react"

import { useApp } from "@/lib/store"
import { AGENT_GROUP_LABEL, type AgentGroup } from "@/lib/types"
import {
  BOOST_SLOTS,
  GATE_MAX_RETRIES,
  GATE_PASS_SCORE,
  METRIC_BY_AGENT,
} from "@/lib/engine/templates"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
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

/** 按流水线接线（boost slot 的 gateAgent 字段）推导门禁审查 Agent，而非硬编码名单 */
const isGateAgent = (name: string) => BOOST_SLOTS.some((s) => s.gateAgent === name)

export function AgentDirectory() {
  const { state } = useApp()
  const groups: AgentGroup[] = ["pre", "production", "post", "qa"]

  return (
    <div className="flex animate-in fade-in-0 slide-in-from-bottom-2 duration-500 flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">智能体目录</h1>
        <p className="mt-1 text-sm text-muted-foreground">查看各环节智能体的能力配置、门禁规则与历史表现</p>
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
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {items.map((a) => {
                const st = STATUS_META[a.status]
                const gate = isGateAgent(a.name)
                const metrics = METRIC_BY_AGENT[a.id] ?? []
                const kbs = state.knowledgeBases.filter((kb) => a.usesRag.includes(kb.id) && kb.enabled)
                const model = state.models.find((m) => m.id === a.modelId)
                return (
                  <Card key={a.id} className="overflow-hidden pt-0! transition-shadow hover:shadow-md">
                    {/* 封面：与资产卡同高的状态区 */}
                    <div className="relative flex h-28 items-center justify-center bg-gradient-to-br from-blue-500/40 to-violet-500/25">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-background/70 backdrop-blur">
                        <BotIcon className="size-5" />
                      </div>
                      <Badge className={`absolute left-2.5 top-2.5 border ${st.className}`}>{st.label}</Badge>
                    </div>
                    <div className="flex flex-1 flex-col gap-3 p-4">
                      <p className="text-sm font-semibold leading-tight">{a.name}</p>
                      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{a.description}</p>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>历史均分</span>
                          <span className="font-medium tabular-nums">{a.avgScore ?? "—"}/100</span>
                        </div>
                        <Progress value={a.avgScore ?? 0} className={a.avgScore == null ? "h-1 opacity-30" : "h-1"} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <Badge variant="outline" className="gap-1 text-[11px] font-normal">
                          <CpuIcon className="size-3" /> {model?.options.find((o) => o.id === model.selected)?.label ?? "未分配"}
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
                      {/* 能力约束：门禁规则（qa 角色）与迭代上限来自引擎接线/元数据 */}
                      <div className="mt-auto flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2.5 text-[11px]">
                        {gate && (
                          <Badge className={`border ${st.className}`}>
                            门禁 · ≥{GATE_PASS_SCORE} 分通过 / 最多打回 {GATE_MAX_RETRIES} 次
                          </Badge>
                        )}
                        <Badge variant="outline">最多 {a.maxIterations} 轮迭代</Badge>
                        {metrics.length > 0 && (
                          <span className="text-muted-foreground">评估维度：{metrics.map((m) => m.label).join(" / ")}</span>
                        )}
                      </div>
                    </div>
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
