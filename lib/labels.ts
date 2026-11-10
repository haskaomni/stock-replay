const ALIAS: Record<string, string> = {
  "^GSPC": "S&P 500",
  "^IXIC": "NASDAQ",
  "^DJI": "DOW",
  "^NDX": "NASDAQ 100",
  "^HSI": "Hang Seng",
  "000300.SS": "CSI 300",
  "000001.SS": "SSE Comp",
  "399006.SZ": "ChiNext",
  "BTC-USD": "BTC",
  "ETH-USD": "ETH",
  "GC=F": "Gold",
};
export const labelOf = (t: string) => ALIAS[t] ?? t;
