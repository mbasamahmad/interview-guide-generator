import { getRun } from "@/lib/store";
import { buildZip, hasOldLayout, rebuildPackage } from "@/lib/pipeline";
import { packageRoot } from "@/lib/assemble";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run = getRun(id);
  if (!run) return new Response("Run not found", { status: 404 });
  if (run.status !== "done") return new Response("The guide is not complete yet, so there is no ZIP to download.", { status: 409 });
  try {
    // Runs packaged before the current folder layout are rebuilt once (no AI calls).
    if (hasOldLayout(run)) run = await rebuildPackage(id);
    const zip = await buildZip(run);
    return new Response(new Uint8Array(zip), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${packageRoot(run.input.company)}.zip"`,
      },
    });
  } catch (err) {
    return new Response(`ZIP generation failed: ${(err as Error).message}`, { status: 500 });
  }
}
