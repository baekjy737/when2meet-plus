"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { bestBlocks, type Block } from "@/lib/analysis";
import { dateLabel, parseSlot, slotId } from "@/lib/slots";
import type { PublicEvent, PublicParticipant } from "@/lib/types";
import { Legend } from "./EventView";
import Grid from "./Grid";
import DateGrid from "./DateGrid";
import SlotDetail from "./SlotDetail";
import { usePeople } from "./usePeople";
import AllocationView, { AllocationResults, useAllocation } from "./AllocationView";

type KeyState = "checking" | "ok" | "missing" | "invalid";

export default function AdminView({ event, initialPeople }: { event: PublicEvent; initialPeople: PublicParticipant[] }) {
  const dateOnly = event.mode === "date";
  const { people, counts } = usePeople(event.id, initialPeople);
  const allocation = useAllocation(event, people);
  const allocationPicked = allocation.picked;
  const [adminKey, setAdminKey] = useState("");
  const [keyState, setKeyState] = useState<KeyState>("checking");
  const [origin, setOrigin] = useState("");
  const [duration, setDuration] = useState(Math.max(event.slotMinutes, 60));
  const [minPeople, setMinPeople] = useState(1);
  const [required, setRequired] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Block | null>(null);
  const [resultTab, setResultTab] = useState<"best" | "allocation">("best");
  const tabId = useId();
  const [hover, setHover] = useState<string | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    setOrigin(location.origin);
    const fromHash = new URLSearchParams(location.hash.slice(1)).get("key");
    let stored: string | null = null;
    try { stored = localStorage.getItem(`admin:${event.id}`); } catch {}
    const k = fromHash ?? stored;
    if (!k) return setKeyState("missing");
    fetch(`/api/events/${event.id}/export?format=json&limit=1`, { headers: { authorization: `Bearer ${k}` } }).then((r) => {
      if (!r.ok) return setKeyState("invalid");
      setAdminKey(k);
      setKeyState("ok");
      try { localStorage.setItem(`admin:${event.id}`, k); } catch {}
    });
  }, [event.id]);

  const blocks = useMemo(
    () => bestBlocks(event, people, { durationMin: duration, minPeople, required: [...required], limit: 20 }),
    [event, people, duration, minPeople, required],
  );

  const highlight = useMemo(() => {
    const active = !dateOnly && resultTab === "allocation" ? allocationPicked : picked;
    if (!active) return undefined;
    if (event.mode === "date") return new Set([active.date]);
    const { min: start } = parseSlot(`${active.date}T${active.start}`);
    const s = new Set<string>();
    for (let m = start; m < start + active.minutes; m += event.slotMinutes) s.add(slotId(active.date, m));
    return s;
  }, [picked, allocationPicked, resultTab, dateOnly, event]);

  if (keyState === "checking") return <p className="muted">관리자 키 확인 중…</p>;
  if (keyState !== "ok") {
    return (
      <div className="card">
        <h1>관리자 권한이 필요합니다</h1>
        <p className="muted">{keyState === "invalid" ? "관리자 키가 올바르지 않습니다." : "이벤트를 만들 때 받은 관리자 링크로 접속하세요."}</p>
        <a href={`/e/${event.id}`}>참가자 페이지로 이동 →</a>
      </div>
    );
  }

  const publicUrl = `${origin}/e/${event.id}`;
  const adminUrl = `${origin}/e/${event.id}/admin#key=${adminKey}`;
  const exportQuery = `${dateOnly ? "" : `duration=${duration}&`}minPeople=${minPeople}`;

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  };

  async function download(format: "xlsx" | "csv" | "json") {
    const res = await fetch(`/api/events/${event.id}/export?format=${format}&${exportQuery}`, {
      headers: { authorization: `Bearer ${adminKey}` },
    });
    if (!res.ok) return alert("내보내기 실패");
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `${event.name}-${event.id}.${format}` });
    a.click();
    URL.revokeObjectURL(url);
  }

  const durations = [1, 2, 3, 4, 6, 8].map((n) => n * event.slotMinutes).filter((m) => m <= event.endMin - event.startMin && m <= 240);

  return (
    <div className="event">
      <div className="event-head">
        <h1>{event.name} <span className="badge">관리자</span></h1>
        <p className="muted">응답 {people.length}명 · {dateOnly ? "날짜 조율" : `${event.timezone} 기준`}</p>
      </div>

      <section className="card links">
        <div className="link-row">
          <span>참가자 링크</span>
          <code>{publicUrl}</code>
          <button onClick={() => copy("public", publicUrl)}>{copied === "public" ? "복사됨" : "복사"}</button>
        </div>
        <div className="link-row">
          <span>관리자 링크</span>
          <code className="secret">{adminUrl}</code>
          <button onClick={() => copy("admin", adminUrl)}>{copied === "admin" ? "복사됨" : "복사"}</button>
        </div>
        <p className="muted small">관리자 링크는 이 이벤트의 데이터 내보내기 권한입니다. 공유하지 말고 안전한 곳에 보관하세요.</p>
      </section>

      <div className="panels">
        <section className="panel">
          {!dateOnly && (
            <div className="result-tabs" role="tablist" aria-label="결과 유형" onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
              e.preventDefault();
              const next = e.key === "Home" ? "best" : e.key === "End" ? "allocation" : resultTab === "best" ? "allocation" : "best";
              setResultTab(next);
              e.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
            }}>
              <button type="button" role="tab" id={`${tabId}-best-tab`} aria-controls={`${tabId}-best-panel`} aria-selected={resultTab === "best"} tabIndex={resultTab === "best" ? 0 : -1} data-tab="best" onClick={() => setResultTab("best")}>최적 시간</button>
              <button type="button" role="tab" id={`${tabId}-allocation-tab`} aria-controls={`${tabId}-allocation-panel`} aria-selected={resultTab === "allocation"} tabIndex={resultTab === "allocation" ? 0 : -1} data-tab="allocation" onClick={() => setResultTab("allocation")}>TF 시간 배분</button>
            </div>
          )}
          <div id={`${tabId}-best-panel`} role={dateOnly ? undefined : "tabpanel"} aria-labelledby={dateOnly ? undefined : `${tabId}-best-tab`} tabIndex={dateOnly ? undefined : 0} hidden={!dateOnly && resultTab !== "best"}>
            <h2>최적 {dateOnly ? "날짜" : "시간"}</h2>
            <div className="filters">
              {!dateOnly && <label className="field">
                <span>회의 길이</span>
                <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                  {durations.map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60}시간` : `${m}분`}</option>)}
                </select>
              </label>}
              <label className="field">
                <span>최소 인원</span>
                <input type="number" min={1} max={Math.max(1, people.length)} value={minPeople} onChange={(e) => setMinPeople(Math.max(1, Number(e.target.value)))} />
              </label>
            </div>
            {people.length > 0 && (
              <div className="required">
                <span className="muted small">꼭 참석해야 하는 사람</span>
                <div className="chips">
                  {people.map((p) => (
                    <button
                      key={p.id} type="button"
                      className={`chip ${required.has(p.name) ? "on" : ""}`}
                      onClick={() => setRequired((r) => { const n = new Set(r); n.has(p.name) ? n.delete(p.name) : n.add(p.name); return n; })}
                    >{p.name}</button>
                  ))}
                </div>
              </div>
            )}
            <p className="muted small">{blocks.length ? `조건에 맞는 후보 ${blocks.length}개를 아래 표에서 비교하세요.` : `조건에 맞는 ${dateOnly ? "날짜가" : "시간이"} 없습니다.`}</p>
            {blocks.length > 0 && <button type="button" className="results-jump" onClick={() => {
              const results = document.getElementById(`${tabId}-best-results`);
              results?.scrollIntoView({ block: "start" });
              results?.focus({ preventScroll: true });
            }}>아래 결과표 보기 ↓</button>}
          </div>
          {!dateOnly && (
            <div id={`${tabId}-allocation-panel`} role="tabpanel" aria-labelledby={`${tabId}-allocation-tab`} tabIndex={0} hidden={resultTab !== "allocation"}>
              <AllocationView allocation={allocation} />
            </div>
          )}
        </section>

        <section className="panel">
          <h2>모두의 가능한 {dateOnly ? "날짜" : "시간"}</h2>
          <Legend total={people.length} />
          {dateOnly
            ? <DateGrid event={event} counts={counts} total={people.length} highlight={highlight} onHover={setHover} />
            : <Grid event={event} counts={counts} total={people.length} highlight={highlight} onHover={setHover} />}
          <SlotDetail slot={hover} people={people} slotMinutes={event.slotMinutes} mode={event.mode} />
        </section>
      </div>

      <section className="card result-section best-results" id={`${tabId}-best-results`} aria-labelledby={`${tabId}-best-heading`} tabIndex={-1} hidden={!dateOnly && resultTab !== "best"}>
        <div className="result-section-head">
          <div>
            <h2 id={`${tabId}-best-heading`}>최적 {dateOnly ? "날짜" : "시간"} 결과</h2>
            <p className="muted small">가능 인원이 많은 순서로 표시합니다. 인원이 같으면 빠른 {dateOnly ? "날짜" : "시간"}이 먼저 나옵니다.</p>
          </div>
          <span className="muted small">최대 20개</span>
        </div>
        <p className="muted small" id={`${tabId}-best-help`}>{dateOnly ? "날짜를" : "시간을"} 누르면 위 시간표에서 강조됩니다.</p>
        {blocks.length === 0 ? <p className="muted">조건에 맞는 {dateOnly ? "날짜가" : "시간이"} 없습니다.</p> : (
          <div className="results-table-wrap" role="region" aria-label={`최적 ${dateOnly ? "날짜" : "시간"} 결과표`} aria-describedby={`${tabId}-best-help`}>
            <table className={`results-table best-results-table${dateOnly ? " date-results-table" : ""}`}>
              <colgroup><col className="result-rank-col" /><col className="result-date-col" />{!dateOnly && <col className="result-time-col" />}<col className="result-count-col" /><col /><col /></colgroup>
              <thead><tr><th scope="col">순위</th><th scope="col">날짜</th>{!dateOnly && <th scope="col">시간</th>}<th scope="col">가능 / 전체</th><th scope="col">가능한 사람</th><th scope="col">불가능한 사람</th></tr></thead>
              <tbody>{blocks.map((block, index) => {
                const on = picked?.date === block.date && picked.start === block.start;
                const select = () => setPicked(on ? null : block);
                const selection = <button type="button" className="result-pick" aria-pressed={on} onClick={select}
                  aria-label={`${dateLabel(block.date)}${dateOnly ? "" : ` ${block.start}–${block.end}`}, ${block.available.length}명 가능, 시간표에서 보기`}>
                  {dateOnly ? dateLabel(block.date) : `${block.start}–${block.end}`}
                </button>;
                return (
                  <tr key={block.date + block.start} className={on ? "on" : ""} onClick={(e) => {
                    if (!(e.target as HTMLElement).closest("button, details, a")) select();
                  }}>
                    <td className="result-number" data-label="순위">{index + 1}</td>
                    {dateOnly ? <th scope="row" data-label="날짜">{selection}</th> : <td className="result-date" data-label="날짜"><time dateTime={block.date}>{dateLabel(block.date)}</time></td>}
                    {!dateOnly && <th scope="row" data-label="시간">{selection}</th>}
                    <td className="result-number" data-label="가능 / 전체">{block.available.length} / {people.length}명</td>
                    <td className="result-names" data-label="가능한 사람">{block.available.length ? block.available.join(", ") : <span className="muted">없음</span>}</td>
                    <td className="result-names muted" data-label="불가능한 사람">{block.unavailable.length ? block.unavailable.join(", ") : "없음"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      {!dateOnly && <div hidden={resultTab !== "allocation"}><AllocationResults allocation={allocation} /></div>}

      <section className="card availability-export" hidden={!dateOnly && resultTab === "allocation"}>
        <h2>데이터 내보내기</h2>
        <p className="muted">현재 필터({dateOnly ? "최소 인원" : "회의 길이·최소 인원"})가 최적 {dateOnly ? "날짜" : "시간"} 순위에 반영됩니다.</p>
        <div className="exports">
          <button className="primary" onClick={() => download("xlsx")}>엑셀 (.xlsx)</button>
          <button onClick={() => download("csv")}>CSV</button>
          <button onClick={() => download("json")}>JSON</button>
        </div>
        <details>
          <summary>API로 가져오기</summary>
          <p className="muted small">관리자 키를 Bearer 토큰으로 사용합니다. format은 json · csv · xlsx 중 하나입니다.</p>
          <pre>{`curl -H "Authorization: Bearer ${adminKey}" \\
  "${origin}/api/events/${event.id}/export?format=json&${exportQuery}"`}</pre>
        </details>
      </section>
    </div>
  );
}
