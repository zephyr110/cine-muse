"use client"

import * as React from "react"
import {
  AudioLinesIcon,
  CheckCircle2Icon,
  CpuIcon,
  FilmIcon,
  KeyRoundIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { toast } from "sonner"

import { useApp } from "@/lib/store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"

const KIND_META = {
  llm: { icon: <CpuIcon className="size-4.5" />, desc: "剧本撰写、审查与编排决策的推理内核" },
  video: { icon: <FilmIcon className="size-4.5" />, desc: "分镜驱动逐镜头视频渲染，API 封装为可替换插件" },
  tts: { icon: <AudioLinesIcon className="size-4.5" />, desc: "多声线对白与旁白合成" },
}

export function ModelSettings() {
  const { state, dispatch } = useApp()

  return (
    <div className="flex flex-col gap-6">

      <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-400">
        <ShieldCheckIcon className="size-4 shrink-0" />
        密钥仅保存在本地浏览器（演示模式），接入真实引擎后将迁移至服务端加密存储
      </div>

      {state.models.map((m) => {
        const meta = KIND_META[m.id] ?? { icon: null, desc: "" }
        const selected = m.options.find((o) => o.id === m.selected) ?? m.options[0]
        return (
          <Card key={m.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">{meta.icon}</div>
                <div>
                  <CardTitle className="text-sm">{m.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">{meta.desc}</p>
                </div>
              </div>
              {m.apiKeyConfigured ? (
                <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-done">
                  <CheckCircle2Icon className="size-3" /> 已连接
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 status-warn">
                  <KeyRoundIcon className="size-3" /> 未配置密钥
                </Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>当前模型</Label>
                  <Select
                    value={m.selected}
                    onValueChange={(v) => dispatch({ type: "SELECT_MODEL", kind: m.id, modelId: v ?? m.selected, now: new Date().toISOString() })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {m.options.map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>服务商</Label>
                  <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{m.provider}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted-foreground">
                  已选择 <span className="font-medium text-foreground">{selected?.label}</span>
                </p>
                <Button
                  size="sm"
                  variant={m.apiKeyConfigured ? "outline" : "default"}
                  onClick={() => toast.info(`「${m.name}」密钥配置窗口（演示模式）`)}
                >
                  <KeyRoundIcon /> {m.apiKeyConfigured ? "更换密钥" : "配置密钥"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}

      <Separator />
      <p className="text-xs text-muted-foreground">配置变更自动保存至本地，立即对后续编排生效</p>
    </div>
  )
}
