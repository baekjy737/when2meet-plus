import type { AllocationResult } from "./allocation";

function csvCell(value: string | number): string {
  let text = String(value);
  // Participant names are free text. Keep spreadsheet apps from treating them as formulas.
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Export the displayed allocation snapshot, including intervals too short for a full shift. */
export function exportAllocationCsv(result: AllocationResult): string {
  const rows = [
    ...result.blocks.map((block) => {
      const assigned = new Set(block.assigned.map((person) => person.id));
      return {
        date: block.date, start: block.start,
        cells: [
          block.date, block.start, block.end, "배정 타임", block.minutes,
          block.assigned.length + block.missing, block.assigned.length, block.missing,
          block.assigned.map((person) => person.name).join("; "),
          block.eligible.filter((person) => !assigned.has(person.id)).map((person) => person.name).join("; "),
          block.missing ? "최소 인원 부족" : "",
        ],
      };
    }),
    ...result.remainders.map((remainder) => ({
      date: remainder.date, start: remainder.start,
      cells: [remainder.date, remainder.start, remainder.end, "미배정 잔여", remainder.minutes, "", 0, "", "", "", "타임 길이보다 짧은 구간"],
    })),
  ].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const header = ["날짜", "시작", "종료", "구분", "길이(분)", "필요 인원", "배정 인원", "부족 인원", "배정자", "그 외 가능한 사람", "설명"];
  return "\uFEFF" + [header, ...rows.map((row) => row.cells)].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
