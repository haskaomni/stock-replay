import Replay from "@/components/Replay";

export default function Page() {
  return (
    <main className="container">
      <header>
        <h1>Stock Replay</h1>
        <p>把股价历史走势做成「同样投入，谁赚得更多」的竞速动画，一键导出视频发到社交媒体。</p>
      </header>
      <Replay />
    </main>
  );
}
