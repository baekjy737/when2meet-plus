import { NextResponse } from "next/server";
import { exportCsv, exportJson, exportXlsx, type ExportOptions } from "@/lib/export";
import { adminKeyFrom, isAdmin, jsonError, loadEvent, toPublicEvent } from "@/lib/server";

/**
 * Organizer export. Auth: `Authorization: Bearer <adminKey>` or `?key=<adminKey>`.
 * Query: format=xlsx|csv|json, duration=<minutes>, minPeople=<n>, limit=<n>,
 * repeated required=<exact participant name>, merge=1 (continuous blocks).
 * CSV always contains unfiltered slot data.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const data = await loadEvent((await params).id);
  if (!data) return jsonError(404, "event not found");
  if (!isAdmin(data.ev, adminKeyFrom(req))) return jsonError(401, "invalid admin key");

  const q = new URL(req.url).searchParams;
  const ev = toPublicEvent(data.ev);
  const filename = encodeURIComponent(`${ev.name}-${ev.id}`);
  const format = q.get("format") ?? "json";
  if (format === "csv") {
    return new Response(exportCsv(ev, data.people), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename*=UTF-8''${filename}.csv`,
      },
    });
  }
  if (format !== "json" && format !== "xlsx") return jsonError(400, "format must be xlsx, csv or json");

  const opts: ExportOptions = {};
  for (const [query, property] of [["duration", "durationMin"], ["minPeople", "minPeople"], ["limit", "limit"]] as const) {
    if (query === "duration" && ev.mode === "date") continue;
    const values = q.getAll(query);
    if (!values.length) continue;
    const value = Number(values[0]);
    if (values.length !== 1 || !/^\d+$/.test(values[0]) || !Number.isSafeInteger(value) || value < 1 || value > 10_000) {
      return jsonError(400, `${query} must be a positive integer no greater than 10000`);
    }
    opts[property] = value;
  }
  if (opts.durationMin !== undefined && (opts.durationMin % ev.slotMinutes !== 0 || opts.durationMin > ev.endMin - ev.startMin)) {
    return jsonError(400, "회의 길이는 이벤트 시간 범위 안에서 선택 간격의 배수로 지정하세요.");
  }
  const required = [...new Set(q.getAll("required"))];
  const names = new Set(data.people.map((person) => person.name));
  if (required.some((name) => name.length > 50 || !names.has(name))) return jsonError(400, "필수 참석자 목록이 변경되었습니다. 최신 응답을 확인해 주세요.");
  opts.required = required;
  const merge = q.getAll("merge");
  if (merge.length > 1 || (merge.length === 1 && merge[0] !== "0" && merge[0] !== "1")) return jsonError(400, "merge must be 0 or 1");
  opts.mergeContinuous = merge[0] === "1";

  if (format === "json") return NextResponse.json(exportJson(ev, data.people, opts));
  return new Response(new Uint8Array(await exportXlsx(ev, data.people, opts)), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename*=UTF-8''${filename}.xlsx`,
    },
  });
}
