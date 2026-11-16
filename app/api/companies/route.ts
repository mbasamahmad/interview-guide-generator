import { NextResponse } from "next/server";
import { clearSheetLink, getCompanies, saveSheetLink, uploadCsv } from "@/lib/companies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Companies from the Google Sheet, A–Z. ?refresh=1 re-reads the sheet instead of the 10-minute cache. */
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  return NextResponse.json(await getCompanies(force));
}

/** Save the sheet link ({url}); it is tested first and only saved if it can be read. {url: ""} removes it. */
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: string };
  const url = (body.url ?? "").trim();
  try {
    if (!url) return NextResponse.json(await clearSheetLink());
    if (url.length > 2000) throw new Error("The link is too long.");
    return NextResponse.json(await saveSheetLink(url));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** Upload a CSV export of the sheet (request body is the CSV text). */
export async function POST(req: Request) {
  const csv = await req.text();
  if (csv.length > 5_000_000) return NextResponse.json({ error: "The file is too large (5 MB max)." }, { status: 400 });
  try {
    return NextResponse.json(await uploadCsv(csv));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
