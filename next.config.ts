import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 桌面客户端：静态导出（Electron loadFile 加载 out/）
  output: "export",
  // file:// 协议需要相对路径资源；浏览器/HTTP 开发则用绝对路径（否则非根路由 ./_next 会 404）。
  // 桌面生产构建脚本（build:desktop*）注入 CINE_RELATIVE_ASSETS=1。
  assetPrefix: process.env.CINE_RELATIVE_ASSETS === "1" ? "./" : undefined,
  // 每路由生成 out/<route>/index.html，file:// 导航不丢
  trailingSlash: true,
};

export default nextConfig;
