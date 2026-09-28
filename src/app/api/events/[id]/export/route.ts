import { NextResponse } from "next/server";
import { exportCsv, exportJson, exportXlsx, type ExportOptions } from "@/lib/export";
import { adminKeyFrom, isAdmin, jsonError, loadEvent, toPublicEvent } from "@/lib/server";

/**
 * Organizer export. Auth: `Authorization: Bearer <adminKey>` or `?key=<adminKey>`.
 * Query: format=xlsx|csv|json, duration=<minutes>, minPeople=<n>, limit=<n>
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const data = await loadEvent((await params).id);
  if (!data) return jsonError(404, "event not found");
  if (!isAdmin(data.ev, adminKeyFrom(req))) return jsonError(401, "invalid admin key");

  const q = new URL(req.url).searchParams;
  const num = (k: string) => (q.get(k) ? Number(q.get(k)) || undefined : undefined);
  const opts: ExportOptions = { durationMin: num("duration"), minPeople: num("minPeople"), limit: num("limit") };
  const ev = toPublicEvent(data.ev);
  const filename = encodeURIComponent(`${ev.name}-${ev.id}`);
  const format = q.get("format") ?? "json";

  if (format === "json") return NextResponse.json(exportJson(ev, data.people, opts));
  if (format === "csv") {
    return new Response(exportCsv(ev, data.people), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename*=UTF-8''${filename}.csv`,
      },
    });
  }
  if (format === "xlsx") {
    return new Response(new Uint8Array(await exportXlsx(ev, data.people, opts)), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename*=UTF-8''${filename}.xlsx`,
      },
    });
  }
  return jsonError(400, "format must be xlsx, csv or json");
}
