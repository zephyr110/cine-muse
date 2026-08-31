import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/toast";

import { ThemeProvider } from "@/lib/theme";

import { AppProvider } from "@/lib/store";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cine Muse",
  description: "从剧本到成片的一站式 AI 视频生产工作台",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // 主题脚本在首帧前修改 <html> 的 class/style：水合时不校验该元素的属性（next-themes 同款要求）
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* 主题初始化：放在根 <head> 内（<script> 是 head 的合法子元素），
            解析时同步执行（首帧前生效，防闪烁）；async 对内联脚本无实际效果，
            仅为满足 React 19 对组件内脚本的渲染契约 */}
        <script
          async
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme");var r=t==="light"||t==="dark"?t:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.classList.add(r);document.documentElement.style.colorScheme=r}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <AppProvider>
          <ThemeProvider>
            <TooltipProvider>
              {children}
              <Toaster />
            </TooltipProvider>
          </ThemeProvider>
        </AppProvider>
      </body>
    </html>
  );
}
