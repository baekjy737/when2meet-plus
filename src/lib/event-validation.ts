import { isValidDate } from "./slots";
import type { EventRecord } from "./types";

export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100 || !/^[A-Za-z][A-Za-z0-9_+\/-]*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Calendar date in the event's zone, independent of the server or viewer zone. */
export function dateInTimezone(timezone: string, now: Date | number = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

type EventInput = Pick<EventRecord, "name" | "mode" | "dates" | "startMin" | "endMin" | "slotMinutes" | "timezone">;
type Validation = { ok: true; value: EventInput } | { ok: false; error: string };

/** Applied only to new events. Historic schedules remain readable and editable. */
export function validateEventInput(input: unknown, now = new Date()): Validation {
  const fail = (error: string): Validation => ({ ok: false, error });
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("이벤트 정보를 확인해 주세요.");
  const body = input as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  if (!name) return fail("이벤트 이름을 입력하세요.");
  const mode = body.mode ?? "time";
  if (mode !== "time" && mode !== "date") return fail("조율 방식을 확인해 주세요.");
  const timezone = body.timezone === undefined ? "Asia/Seoul" : body.timezone;
  if (!isValidTimezone(timezone)) return fail("올바른 기준 시간대를 선택하세요.");
  if (!Array.isArray(body.dates) || body.dates.length === 0 || body.dates.some((date) => typeof date !== "string" || !isValidDate(date))) {
    return fail("올바른 날짜를 1~62개 선택하세요.");
  }
  const dates = [...new Set(body.dates as string[])].sort();
  if (dates.length > 62) return fail("날짜는 최대 62일까지 선택할 수 있습니다.");
  if (dates.some((date) => date < dateInTimezone(timezone, now))) return fail("선택한 기준 시간대에서 오늘 이전 날짜로 새 일정을 만들 수 없습니다.");
  const slotMinutes = mode === "date" ? 1440 : Number(body.slotMinutes ?? 30);
  const startMin = mode === "date" ? 0 : Number(body.startMin);
  const endMin = mode === "date" ? 1440 : Number(body.endMin);
  if (mode === "time" && ![15, 30, 60].includes(slotMinutes)) return fail("선택 간격은 15분, 30분, 1시간 중에서 고르세요.");
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0 || endMin > 1440 || endMin - startMin < slotMinutes) {
    return fail("종료 시각은 시작 시각보다 최소 한 칸 이상 늦어야 합니다.");
  }
  if (startMin % slotMinutes || endMin % slotMinutes) return fail("시작·종료 시각을 선택 간격에 맞춰 다시 고르세요.");
  return { ok: true, value: { name, mode, dates, startMin, endMin, slotMinutes, timezone } };
}
