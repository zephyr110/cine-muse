"use client"

import * as React from "react"
import { CpuIcon, ShieldCheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AccountCard } from "@/components/settings/account-card"
import { ModelSettings } from "@/components/settings/model-settings"

const TABS = [
  { key: "account", label: "账号安全", desc: "本地账号与登录密码", icon: <ShieldCheckIcon className="size-4" /> },
  {
    key: "models",
    label: "模型服务",
    desc: "外部 AI 模型服务层适配——模型适配器设计为可插拔，替换模型无需改动编排逻辑",
    icon: <CpuIcon className="size-4" />,
  },
] as const

type TabKey = (typeof TABS)[number]["key"]

const PANELS: Record<TabKey, React.ReactNode> = {
  account: <AccountCard />,
  models: <ModelSettings />,
}

/** avatar 菜单"系统设置"打开的对话框：左侧导航 + 右侧内容区 */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [tab, setTab] = React.useState<TabKey>("account")

  // 对话框心智：每次打开回到默认 tab（在事件处理器中重置，避免 effect 内 setState）
  const handleOpenChange = (next: boolean) => {
    if (next) setTab("account")
    onOpenChange(next)
  }

  const active = TABS.find((t) => t.key === tab) ?? TABS[0]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* p-0!/gap-0!：base dialog 的 p-4/gap-4 同特异性后发覆盖，必须 important */}
      <DialogContent className="w-full gap-0! overflow-hidden p-0! sm:max-w-4xl!">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>系统设置</DialogTitle>
          <DialogDescription>账号与模型服务配置，变更即时生效</DialogDescription>
        </DialogHeader>
        {/* 高度减去 header（~4.5rem）避免短视口裁掉关闭按钮；窄屏左栏折叠为顶部横排 */}
        <div className="grid h-[min(calc(80svh-4.5rem),640px)] grid-cols-1 sm:grid-cols-[12rem_1fr]">
          <nav
            aria-label="设置分类"
            className="flex flex-row gap-1 border-b bg-muted/40 p-3 sm:flex-col sm:border-r sm:border-b-0"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors max-sm:flex-1 max-sm:justify-center",
                  tab === t.key
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
          {/* key={tab}：切换时重挂载内容区，滚动位置归零 */}
          <div key={tab} className="overflow-y-auto p-6">
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-sm font-semibold">{active.label}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{active.desc}</p>
              </div>
              {PANELS[tab]}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
