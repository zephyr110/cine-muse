"use client"

import * as React from "react"
import { EyeIcon, PenLineIcon, Wand2Icon, ZapIcon } from "lucide-react"

import { BOOST_SLOTS, GENRE_LIBRARY, STYLE_LIBRARY } from "@/lib/engine/templates"
import { MODE_LABEL } from "@/lib/types"
import type { InterventionMode, NewProjectInput, WorkflowTemplate } from "@/lib/types"

// 题材/风格列表从模板库派生：新增预设自动出现在向导中，避免双份维护漂移
export const GENRES = Object.keys(GENRE_LIBRARY)

export interface StyleOption {
  id: string
  desc: string
  gradient: string
}

const STYLE_OPTIONS: Record<string, { desc: string; gradient: string }> = {
  赛博朋克: { desc: "霓虹蓝紫 · 雨夜反光 · 复古未来", gradient: "from-violet-500/30 via-fuchsia-500/15 to-cyan-500/30" },
  黑色电影: { desc: "低照度硬光 · 阴影切割 · 冷峻", gradient: "from-slate-600/40 via-zinc-800/30 to-slate-900/40" },
  治愈系: { desc: "暖调柔光 · 自然饱和度 · 留白", gradient: "from-amber-400/30 via-orange-300/20 to-rose-400/30" },
  古风: { desc: "水墨质感 · 低饱和青灰 · 对称", gradient: "from-emerald-600/30 via-teal-500/15 to-lime-500/25" },
  赛博国风: { desc: "霓虹 + 水墨 · 青金配色", gradient: "from-sky-500/30 via-teal-400/15 to-amber-400/30" },
  纪实: { desc: "自然光 · 手持晃动 · 真实颗粒", gradient: "from-stone-500/30 via-amber-600/15 to-stone-700/30" },
  动画: { desc: "高饱和 · 风格化形变 · 夸张透视", gradient: "from-rose-500/30 via-orange-400/20 to-yellow-400/30" },
}

export const STYLES: StyleOption[] = Object.keys(STYLE_LIBRARY).map((id) => ({
  id,
  ...STYLE_OPTIONS[id],
}))

export const DURATIONS = [30, 60, 90, 120, 180, 240]

export const QUALITY_ITEMS: { value: NewProjectInput["quality"]; label: string }[] = [
  { value: "draft", label: "草稿 (720p)" },
  { value: "standard", label: "标准 (1080p)" },
  { value: "hd", label: "高清 (4K)" },
]

export const TEMPLATES: {
  id: WorkflowTemplate
  title: string
  desc: string
  nodes: { name: string; checkpoint?: boolean }[]
  recommended?: boolean
}[] = [
  {
    id: "full",
    title: "完整流水线",
    desc: "7 个执行环节全流程协作，含质量门禁与人工确认节点",
    recommended: true,
    nodes: [
      { name: "剧本" }, { name: "门禁" }, { name: "分镜" }, { name: "门禁" },
      { name: "风格设定", checkpoint: true }, { name: "场景" }, { name: "视频" },
      { name: "门禁" }, { name: "配音" }, { name: "剪辑", checkpoint: true },
    ],
  },
  {
    id: "quick",
    title: "快速预览",
    desc: "3 个环节出粗剪样片，适合创意验证与提案",
    nodes: [{ name: "剧本" }, { name: "门禁" }, { name: "视频" }, { name: "门禁" }, { name: "成片", checkpoint: true }],
  },
]

export const MODES: {
  id: InterventionMode
  title: string
  desc: string
  badge: string
  icon: React.ReactNode
  recommended?: boolean
}[] = [
  {
    id: "auto",
    title: MODE_LABEL.auto,
    desc: "零打断跑完全流程，直接交付成片",
    badge: "适合批量出片与复跑",
    icon: <ZapIcon className="size-4" />,
  },
  {
    id: "guided",
    title: MODE_LABEL.guided,
    desc: "流程不打断，agents 消费绑定资产作为强约束",
    badge: "「指定这张脸」式前置干预",
    icon: <Wand2Icon className="size-4" />,
    recommended: true,
  },
  {
    id: "review",
    title: MODE_LABEL.review,
    desc: "关键节点（风格设定、成片前）暂停人工确认",
    badge: "2 个确认点",
    icon: <EyeIcon className="size-4" />,
  },
  {
    id: "manual",
    title: MODE_LABEL.manual,
    desc: "审查式基础上，每个环节产出都可手动改写",
    badge: "全程可介入",
    icon: <PenLineIcon className="size-4" />,
  },
]

// 干预深度谱系（L0 全自动 → L3 手作）说明（聊天气泡内引用）
export const MODE_SPECTRUM = (["auto", "guided", "review", "manual"] as const).map(
  (m, i) => `L${i} ${MODE_LABEL[m]}`,
)

// 增强环节选项（Task 3 聊天气泡用；title/desc 来自 BOOST_SLOTS 防止双份维护）
export interface BoostOption {
  agentId: string
  title: string
  description: string
}

export const BOOST_OPTIONS: BoostOption[] = BOOST_SLOTS.map((b) => ({
  agentId: b.agentId,
  title: b.title,
  description: b.description,
}))
