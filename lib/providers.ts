import type { RawBars } from "./types";

const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const toIso = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

/** Yahoo Finance public chart endpoint — daily bars, adjusted close when available. */
async function fetchYahoo(ticker: string, from: string, to: string): Promise<RawBars> {
  const p1 = Math.floor(new Date(from + "T00:00:00Z").getTime() / 1000);
  // +1 day so the end date is inclusive
  const p2 = Math.floor(new Date(to + "T00:00:00Z").getTime() / 1000) + 86400;
  let lastErr: unknown;
  for (const host of HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(
        ticker,
      )}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
      });
      if (res.status === 404) throw new Error(`找不到代码 ${ticker}`);
      if (!res.ok) throw new Error(`Yahoo 返回 ${res.status}`);
      const json = await res.json();
      const r = json?.chart?.result?.[0];
      if (!r) throw new Error(json?.chart?.error?.description || `没有 ${ticker} 的数据`);
      const ts: number[] = r.timestamp ?? [];
      const adj: (number | null)[] | undefined = r.indicators?.adjclose?.[0]?.adjclose;
      const close: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
      const bars: [string, number][] = [];
      ts.forEach((t, i) => {
        const v = adj?.[i] ?? close[i];
        if (v != null && Number.isFinite(v) && v > 0) bars.push([toIso(t), v]);
      });
      if (bars.length < 2) throw new Error(`${ticker} 在该区间内数据不足`);
      return {
        ticker,
        name: r.meta?.shortName || r.meta?.longName || ticker,
        bars,
      };
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && e.message.startsWith("找不到")) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("请求失败");
}

/** Deterministic pseudo-random walk — ONLY for offline dev (USE_MOCK_DATA=1). */
function fetchMock(ticker: string, from: string, to: string): RawBars {
  let seed = 0;
  for (const c of ticker) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const bars: [string, number][] = [];
  let price = 20 + rnd() * 80;
  const drift = (rnd() - 0.3) * 0.0012;
  const vol = 0.01 + rnd() * 0.02;
  for (let t = new Date(from).getTime(); t <= new Date(to).getTime(); t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    price *= 1 + drift + (rnd() - 0.5) * 2 * vol;
    bars.push([d.toISOString().slice(0, 10), price]);
  }
  return { ticker, name: `${ticker} (mock)`, bars };
}

export async function fetchBars(ticker: string, from: string, to: string): Promise<RawBars> {
  if (process.env.USE_MOCK_DATA === "1") return fetchMock(ticker, from, to);
  return fetchYahoo(ticker, from, to);
}
