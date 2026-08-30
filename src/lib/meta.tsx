"use client"

/**
 * 全局展示元数据：项目状态 / 干预模式的唯一事实来源（label/描述/图标/样式）
 * 供 project-grid、workflow-workspace、new-project-wizard 共用，避免多份拷贝漂移。
 * 说明：纯展示层不引 React 也可以，但图标渲染需要 JSX，故为 .tsx。
 */

import {
  CircleCheckIcon,
  CircleXIcon,
  ClapperboardIcon,
  EyeIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  PaperclipIcon,
  PartyPopperIcon,
  PenLineIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  SkipForwardIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TriangleAlertIcon,
  UnlinkIcon,
  UserCheckIcon,
  Wand2Icon,
  ZapIcon,
} from "lucide-react"
import * as React from "react"

import type { EventKind, InterventionMode, ProjectStatus } from "@/lib/types"

export const STATUS_META: Record<ProjectStatus, { label: string; className: string }> = {
  executing: { label: "执行中", className: "status-blue" },
  waiting_approval: { label: "待确认", className: "status-warn" },
  queued: { label: "排队中", className: "status-idle" },
  completed: { label: "已完成", className: "status-done" },
  failed: { label: "已中断", className: "status-danger" },
  draft: { label: "草稿", className: "status-draft" },
}

/**
 * 引擎事件类型 → 时间轴节点展示元数据（活动时间线专用）。
 * 全量 Record：新增 EventKind 未补条目会直接编译报错，防止无声空节点。
 */
export const EVENT_META: Record<EventKind, { icon: React.ReactNode; color: string }> = {
  project_created: { icon: <ClapperboardIcon className="size-3" />, color: "bg-sky-500" },
  project_started: { icon: <PlayIcon className="size-3" />, color: "bg-blue-500" },
  stage_started: { icon: <LoaderCircleIcon className="size-3" />, color: "bg-blue-500" },
  stage_completed: { icon: <ListChecksIcon className="size-3" />, color: "bg-blue-500" },
  gate_passed: { icon: <CircleCheckIcon className="size-3" />, color: "bg-emerald-500" },
  gate_rejected: { icon: <CircleXIcon className="size-3" />, color: "bg-red-500" },
  waiting_approval: { icon: <UserCheckIcon className="size-3" />, color: "bg-amber-500" },
  approved: { icon: <ThumbsUpIcon className="size-3" />, color: "bg-emerald-500" },
  rejected: { icon: <ThumbsDownIcon className="size-3" />, color: "bg-amber-500" },
  skipped: { icon: <SkipForwardIcon className="size-3" />, color: "bg-slate-400" },
  retry: { icon: <RotateCcwIcon className="size-3" />, color: "bg-orange-500" },
  project_completed: { icon: <PartyPopperIcon className="size-3" />, color: "bg-emerald-500" },
  project_failed: { icon: <TriangleAlertIcon className="size-3" />, color: "bg-red-500" },
  mode_changed: { icon: <RotateCcwIcon className="size-3" />, color: "bg-violet-500" },
  asset_bound: { icon: <PaperclipIcon className="size-3" />, color: "bg-blue-500" },
  asset_unbound: { icon: <UnlinkIcon className="size-3" />, color: "bg-slate-400" },
  artifact_edited: { icon: <PencilIcon className="size-3" />, color: "bg-violet-500" },
}

export const MODE_META: Record<
  InterventionMode,
  { label: string; desc: string; icon: React.ReactNode; className: string }
> = {
  auto: { label: "全自动 L0", desc: "零打断，直接交付成片", icon: <ZapIcon className="size-3.5" />, className: "status-idle" },
  guided: { label: "引导式 L1", desc: "不打断流程，agents 消费绑定资产", icon: <Wand2Icon className="size-3.5" />, className: "status-blue" },
  review: { label: "审查式 L2", desc: "关键节点暂停人工确认", icon: <EyeIcon className="size-3.5" />, className: "status-warn" },
  manual: { label: "手作式 L3", desc: "每个环节产出可手动改写", icon: <PenLineIcon className="size-3.5" />, className: "status-creative" },
}
