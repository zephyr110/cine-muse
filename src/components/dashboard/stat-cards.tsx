"use client"

import { ClapperboardIcon, GaugeIcon, HourglassIcon, LoaderCircleIcon } from "lucide-react"

import { useApp, usePendingApprovals } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function StatCards() {
  const { state } = useApp()
  const pending = usePendingApprovals()
  const active = state.projects.filter((p) =>
    ["executing", "waiting_approval", "queued"].includes(p.status),
  ).length
  const finished = state.projects.filter((p) => p.status === "completed").length
  const scored = state.projects
    .map((p) => p.avgScore)
    .filter((v): v is number => typeof v === "number")
  const avgScore = scored.length
    ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
    : 0

  const cards = [
    { title: "进行中项目", value: active, icon: <LoaderCircleIcon className="size-4.5" />, chip: "bg-blue-500/10 text-blue-500" },
    { title: "已完成成片", value: finished, icon: <ClapperboardIcon className="size-4.5" />, chip: "bg-emerald-500/10 text-emerald-500" },
    { title: "平均质量分", value: avgScore, suffix: "/100", icon: <GaugeIcon className="size-4.5" />, chip: "bg-violet-500/10 text-violet-500" },
    { title: "待确认", value: pending, icon: <HourglassIcon className="size-4.5" />, chip: "bg-amber-500/10 text-amber-500", alert: pending > 0 },
  ]

  return (
    <div className="grid gap-4 @3xl:grid-cols-2 @7xl:grid-cols-4">
      {cards.map((c) => (
        <Card
          key={c.title}
          className={`relative overflow-hidden transition-colors hover:border-primary/40 ${
            c.alert ? "border-amber-500/40 bg-amber-500/[0.03]" : ""
          }`}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              {c.title}
              {c.alert && <span className="size-1.5 rounded-full bg-amber-500" />}
            </CardTitle>
            <span className={`flex size-8 items-center justify-center rounded-lg ${c.chip}`}>{c.icon}</span>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold tabular-nums">{c.value}</span>
              {c.suffix && <span className="text-sm text-muted-foreground">{c.suffix}</span>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
