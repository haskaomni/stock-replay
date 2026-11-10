import Replay from "@/components/Replay";

export default function Page() {
  return (
    <main className="container">
      <header className="hero">
        <span className="badge">STOCK REPLAY</span>
        <h1>
          同样的本金，<em>谁跑到最后？</em>
        </h1>
        <p>把任意股票、指数、加密货币的历史走势，变成一段带配乐的竞速短片。选好选手，一键导出，直接发。</p>
      </header>
      <Replay />
    </main>
  );
}
