"use client"

import * as React from "react"
import { Maximize2Icon, XIcon } from "lucide-react"

import type { WorkflowStage } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { PrevisBlockingEditor } from "./previs-blocking-editor"

/**
 * 空间预演台全屏编辑器：整窗 Dialog（参考 storyai-3d-director-desk 全视口形态），
 * 内部为三栏布局（左镜头/布景项 · 中画布+三图切换 · 右机位/操作）。
 * Esc 或「退出编辑」关闭；每次打开镜头重置到 0。
 */
export function PrevisFullscreenEditor({
  projectId,
  stage,
  onClose,
}: {
  projectId: string
  stage: WorkflowStage
  onClose: () => void
}) {
  const [shotIndex, setShotIndex] = React.useState(0)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* DialogContent 自带 portal + overlay；全屏覆盖需中和基类居中 translate */}
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/40 backdrop-blur-sm"
        className="fixed inset-0 z-50 flex max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-background p-0 sm:max-w-none"
      >
        {/* 顶栏：身份信息 + 退出 */}
        <header className="flex h-12 shrink-0 items-center gap-2.5 border-b bg-popover px-4">
          <Maximize2Icon className="size-4 text-muted-foreground" />
          <DialogTitle className="text-sm font-semibold">空间预演台 · 全屏编辑</DialogTitle>
          <span className="truncate text-xs text-muted-foreground">{stage.title}</span>
          <div className="ml-auto" />
          <Button size="sm" variant="ghost" className="gap-1" onClick={onClose}>
            <XIcon className="size-3.5" /> 退出编辑
          </Button>
        </header>
        <div className="min-h-0 flex-1 p-4">
          <PrevisBlockingEditor
            projectId={projectId}
            stage={stage}
            shotIndex={shotIndex}
            onShotIndexChange={setShotIndex}
            onDone={onClose}
            variant="fullscreen"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
