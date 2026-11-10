# Stock Replay

输入一个或多个股票代码 + 时间范围 → 播放「同样投入，谁赚得更多」的竞速动画 → 一键导出视频。

```bash
bun install
bun dev          # http://localhost:3000
```

- 数据：`/api/history` 服务端请求 Yahoo Finance 日 K（复权收盘价），多代码按共同起点对齐、缺失日前向填充。
- 渲染：Canvas（`lib/render.ts`），支持 16:9 / 9:16 / 1:1 / 4:5、深浅主题、线性/对数轴、水印。
- 视频：浏览器内 `MediaRecorder` 录制 canvas，优先 MP4(H.264)，不支持时回退 WebM。
- 离线开发：`USE_MOCK_DATA=1 bun dev` 使用模拟数据。

## 部署到 Cloudflare Workers

使用 `@opennextjs/cloudflare` + `wrangler`：

```bash
bunx wrangler login     # 或设置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
bun run deploy          # 构建并发布，输出 *.workers.dev 地址
bun run preview         # 本地用 workerd 预览
```
