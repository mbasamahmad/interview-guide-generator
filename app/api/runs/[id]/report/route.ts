import { getRun } from "@/lib/store";
import { buildReport, reportMarkdown } from "@/lib/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The research report as Markdown, available as soon as research finishes (before any pages are written). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const run = getRun((await params).id);
  if (!run) return new Response("Run not found", { status: 404 });
  return new Response(reportMarkdown(buildReport(run)), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${run.input.companySlug}-research-report.md"`,
    },
  });
}
