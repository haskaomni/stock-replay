import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Replay · 股价走势回放视频生成器",
  description: "输入股票代码和时间范围，生成可下载分享的资金增长竞速动画视频",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
