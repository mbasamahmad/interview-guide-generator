import { NextResponse } from "next/server";
import { allPrices, DEFAULT_SEARCH_PRICE, PRICES_AS_OF, savePrice, type ModelPrice } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ asOf: PRICES_AS_OF, prices: allPrices(), searchPrice: DEFAULT_SEARCH_PRICE });
}

/** PUT { model, price: { input, cachedInput, output } } saves a custom price; price: null restores the official one. */
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { model?: string; price?: ModelPrice | null };
  try {
    if (!body.model) throw new Error("model is required");
    savePrice(body.model.trim(), body.price === undefined ? null : body.price);
    return NextResponse.json({ prices: allPrices() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
