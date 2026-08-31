"use client"

import * as React from "react"
import Link from "next/link"

import brandLogo from "@/app/icon.png"

/**
 * 登录 / 注册 / 找回密码共享布局（参考 shadcn login-05：
 * 居中单列 max-w-sm，顶部品牌 logo，标题与表单由各表单组件渲染）
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <Link href="/" className="flex flex-col items-center gap-2 font-medium">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brandLogo.src} alt="Cine Muse" className="size-8" />
              <span className="text-sm">Cine Muse</span>
            </Link>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

