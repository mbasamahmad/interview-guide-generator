import { getRun } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  const url = new URL(req.url);
  const p = url.searchParams.get("path") ?? "";
  const content = run?.files[p];
  if (content === undefined) return new Response("File not found", { status: 404 });
  const name = p.split("/").pop() ?? "file.md";
  const type = p.endsWith(".json") ? "application/json" : "text/markdown";
  const inline = url.searchParams.get("inline") === "1";
  return new Response(content, {
    headers: {
      "content-type": `${type}; charset=utf-8`,
      ...(inline ? {} : { "content-disposition": `attachment; filename="${name}"` }),
    },
  });
}
