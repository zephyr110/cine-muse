import { AppShell } from "@/components/app-shell"
import { StatCards } from "@/components/dashboard/stat-cards"
import { ProjectGrid } from "@/components/dashboard/project-grid"
import { ActivityFeed } from "@/components/dashboard/activity-feed"

export default function Page() {
  return (
    <AppShell>
      <div className="flex animate-in fade-in-0 slide-in-from-bottom-2 duration-500 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">工作台</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">项目进度、待确认节点与引擎动态总览</p>
        </div>
        <StatCards />
        <ProjectGrid />
        <ActivityFeed />
      </div>
    </AppShell>
  )
}
