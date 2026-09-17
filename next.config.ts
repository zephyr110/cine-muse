import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 桌面客户端：静态导出（Electron 经内嵌后端同源 http 提供 out/，见 electron/main.ts）
  output: "export",
  // 一律用**根绝对**资源路径。桌面端已改由内嵌后端同源提供站点（loadURL，
  // 取代 loadFile），与浏览器/HTTP 同一条路径 —— 相对前缀反而有害：
  // assetPrefix 是字面拼接（`${assetPrefix}/_next/`），会往每一页都写死
  // `./_next/...`，而 trailingSlash 让每个非根路由都位于子目录，`./` 会解析成
  // `/dashboard/_next/...` 而 404。桌面端根绝对路径正是 /models/*.glb 得以加载的前提。
  //
  // CINE_RELATIVE_ASSETS=1 仅为「直接 file:// 打开 out/」的调试场景保留 —— 它治不了
  // 运行期根绝对字面量（如 previs-ue4-model.ts 的 UE4_MODEL_URL），且非根路由必坏。
  assetPrefix: process.env.CINE_RELATIVE_ASSETS === "1" ? "./" : undefined,
  // 每路由生成 out/<route>/index.html
  trailingSlash: true,
};

export default nextConfig;
