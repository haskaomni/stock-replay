import { NextRequest, NextResponse } from "next/server";
import { fetchBars } from "@/lib/providers";
import { align } from "@/lib/align";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TICKER = /^[A-Za-z0-9.\-=^]{1,15}$/;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tickers = [
    ...new Set(
      (sp.get("tickers") ?? "")
        .split(/[,\s]+/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? new Date().toISOString().slice(0, 10);

  if (!tickers.length) return NextResponse.json({ error: "请至少输入一个股票代码" }, { status: 400 });
  if (tickers.length > 8) return NextResponse.json({ error: "最多同时对比 8 个代码" }, { status: 400 });
  if (tickers.some((t) => !TICKER.test(t))) return NextResponse.json({ error: "股票代码格式不正确" }, { status: 400 });
  if (!ISO.test(from) || !ISO.test(to) || from >= to)
    return NextResponse.json({ error: "时间范围不正确" }, { status: 400 });

  try {
    const results = await Promise.allSettled(tickers.map((t) => fetchBars(t, from, to)));
    const failed = results.flatMap((r, i) =>
      r.status === "rejected" ? [`${tickers[i]}: ${(r.reason as Error).message}`] : [],
    );
    if (failed.length) return NextResponse.json({ error: failed.join("；") }, { status: 502 });
    const ok = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof fetchBars>>>).value);
    const data = align(ok, process.env.USE_MOCK_DATA === "1" ? "mock" : "Yahoo Finance");
    if (data.dates.length < 2) return NextResponse.json({ error: "共同交易日不足，请放宽时间范围" }, { status: 422 });
    return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=600" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
