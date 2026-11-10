# Stock Replay

输入一个或多个股票代码 + 时间范围 → 播放「同样投入，谁赚得更多」的竞速动画 → 一键导出视频。

```bash
bun install
bun dev          # http://localhost:3000
```

- **数据**：`/api/history` 服务端请求 Yahoo Finance 日 K（复权收盘价），多代码按共同起点对齐、缺失日前向填充。
  Yahoo 没有沪深 300 指数的历史日线，`000300.SS` 会自动改用沪深 300 ETF（`510300.SS`）。
- **成片结构**（`lib/scene.ts`，纯 Canvas）：
  1. 片头钩子：「如果在 X 年各投入 $10,000，谁是最后的赢家？」
  2. 竞速：发光折线 + 渐变面积、背景大年份、实时排行榜（名次交换动画、领先者皇冠）、
     反超 / 翻倍 / 腰斩事件横幅与冲击波、底部进度条
  3. 结尾：冠军卡、收益率滚动计数、年化收益、完整排名、彩带
- **配乐**（`lib/audio.ts`）：`OfflineAudioContext` 程序生成，旋律音高随领先者资产变化，事件有音效，结尾重击。
- **导出**（`lib/recorder.ts`）：WebCodecs 逐帧编码 H.264 + `mp4-muxer` 封装，时长精确；
  音轨优先 AAC，浏览器不支持时用 Opus；不支持 WebCodecs 时退回 `MediaRecorder` 实时录制（无音轨）。
- 可选：9:16 / 16:9 / 1:1 / 4:5，720p / 1080p，30 / 60 fps，三种风格，中英文案，线性/对数轴，自定义标题与水印。
- 离线开发：`USE_MOCK_DATA=1 bun dev` 使用模拟数据。

## 部署到 Cloudflare Workers

使用 `@opennextjs/cloudflare` + `wrangler`：

```bash
bunx wrangler login     # 或设置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
bun run deploy          # 构建并发布，输出 *.workers.dev 地址
bun run preview         # 本地用 workerd 预览
```
