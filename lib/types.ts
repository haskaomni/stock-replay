export interface HistoryResponse {
  /** ISO dates (YYYY-MM-DD), common trading calendar for all tickers */
  dates: string[];
  /** ticker -> adjusted close aligned to `dates` (forward-filled) */
  series: Record<string, number[]>;
  /** ticker -> display name */
  names: Record<string, string>;
  source: string;
}

export interface RawBars {
  ticker: string;
  name: string;
  /** [isoDate, close] ascending */
  bars: [string, number][];
}
