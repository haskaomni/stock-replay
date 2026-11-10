import type { HistoryResponse, RawBars } from "./types";

/**
 * Put every ticker on one shared calendar.
 * - start at the latest first-trading-day among tickers (so everyone starts together at the same $)
 * - union of all trading dates, missing days forward-filled (e.g. CN vs US holidays)
 */
export function align(all: RawBars[], source: string): HistoryResponse {
  const start = all.map((a) => a.bars[0][0]).reduce((a, b) => (a > b ? a : b));
  const dateSet = new Set<string>();
  for (const a of all) for (const [d] of a.bars) if (d >= start) dateSet.add(d);
  const dates = [...dateSet].sort();

  const series: Record<string, number[]> = {};
  const names: Record<string, string> = {};
  for (const a of all) {
    const map = new Map(a.bars);
    // last known price on/before start
    let last = a.bars[0][1];
    for (const [d, v] of a.bars) {
      if (d <= start) last = v;
      else break;
    }
    series[a.ticker] = dates.map((d) => {
      const v = map.get(d);
      if (v != null) last = v;
      return last;
    });
    names[a.ticker] = a.name;
  }
  return { dates, series, names, source };
}
