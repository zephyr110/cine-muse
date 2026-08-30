"use client"

import * as React from "react"
import { Suspense } from "react"
import { useSearchParams } from "next/navigation"

import { AppShell } from "@/components/app-shell"
import { WorkflowWorkspace } from "@/components/projects/workflow-workspace"
import { Skeleton } from "@/components/ui/skeleton"

function ProjectPageInner() {
  const searchParams = useSearchParams()
  const id = searchParams.get("id") ?? ""
  return <WorkflowWorkspace projectId={id} />
}

export default function Page() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex animate-in fade-in-0 slide-in-from-bottom-2 duration-500 flex-col gap-6 p-6">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96" />
            <Skeleton className="h-40 w-full" />
          </div>
        }
      >
        <ProjectPageInner />
      </Suspense>
    </AppShell>
  )
}
