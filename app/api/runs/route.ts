import { NextResponse } from "next/server";
import { createRun, listRuns } from "@/lib/store";
import { runPipeline } from "@/lib/pipeline";
import { slugify } from "@/lib/taxonomy";
import { findCompany, sheetInfo } from "@/lib/companies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ runs: listRuns() });
}

/** Start a run. The company is the only input; roles and interview types are discovered. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { company?: string; slug?: string };
  const company = (body.company ?? "").trim();
  // Companies picked from the sheet carry the sheet's URL slug (e.g. "X (Twitter)" → "x").
  const slug = (body.slug ?? "").trim() || slugify(company);
  const errors: string[] = [];
  if (!company) errors.push("Company name is required.");
  else if (company.length > 80) errors.push("Company name must be 80 characters or fewer.");
  else if (!slugify(company)) errors.push("Company name must contain letters or numbers.");
  else if (slugify(slug) !== slug) errors.push("Company slug may only contain lowercase letters, numbers and hyphens.");
  if (errors.length) return NextResponse.json({ errors }, { status: 400 });

  // Save the company's sheet row (keyword plan) with the run; the agents use it.
  const row = await findCompany(company, body.slug?.trim() || undefined).catch(() => undefined);
  const run = createRun({ company, companySlug: slug, ...(row ? { sheet: sheetInfo(row) } : {}) });
  void runPipeline(run.id); // runs in the background; the UI polls the run
  return NextResponse.json({ id: run.id }, { status: 201 });
}
