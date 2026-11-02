"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { bestBlocks, mergeContinuousBlocks, type Block } from "@/lib/analysis";
import { defaultMeetingDuration } from "@/lib/event-options";
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
  const { people, setPeople, counts } = usePeople(event.id, initialPeople);
  const allocation = useAllocation(event, people);
  const allocationPicked = allocation.picked;
  const [adminKey, setAdminKey] = useState("");
  const [keyState, setKeyState] = useState<KeyState>("checking");
  const [origin, setOrigin] = useState("");
  const [duration, setDuration] = useState(defaultMeetingDuration(event));
  const [minPeople, setMinPeople] = useState(1);
  const [required, setRequired] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Block | null>(null);
  const [resultTab, setResultTab] = useState<"best" | "allocation">("best");
  const tabId = useId();
  const [hover, setHover] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const [mergeContinuous, setMergeContinuous] = useState(false);
  const [managementStatus, setManagementStatus] = useState("");
  const [busyParticipant, setBusyParticipant] = useState("");
  const [recovery, setRecovery] = useState<{ id: string; name: string; url: string } | null>(null);
  const [exportError, setExportError] = useState("");

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
    }).catch(() => setKeyState("invalid"));
  }, [event.id]);

  const blocks = useMemo(() => {
    const candidates = bestBlocks(event, people, { durationMin: duration, minPeople, required: [...required] });
    return (mergeContinuous && !dateOnly ? mergeContinuousBlocks(candidates) : candidates).slice(0, 20);
  }, [event, people, duration, minPeople, required, mergeContinuous, dateOnly]);

  useEffect(() => {
    const names = new Set(people.map((p) => p.name));
    setRequired((current) => [...current].every((name) => names.has(name)) ? current : new Set([...current].filter((name) => names.has(name))));
    setRecovery((current) => current && !people.some((p) => p.id === current.id) ? null : current);
  }, [people]);

  useEffect(() => {
    setPicked((current) => current && !blocks.some((b) => b.date === current.date && b.start === current.start && b.end === current.end && b.available.join("\0") === current.available.join("\0")) ? null : current);
  }, [blocks]);

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
  const query = new URLSearchParams({ minPeople: String(minPeople), limit: "20" });
  if (!dateOnly) query.set("duration", String(duration));
  if (mergeContinuous && !dateOnly) query.set("merge", "1");
  for (const name of required) query.append("required", name);
  const exportQuery = query.toString();

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    } catch { setManagementStatus("복사하지 못했습니다. 링크를 직접 선택해 복사해 주세요."); }
  };

  async function download(format: "xlsx" | "csv" | "json") {
    setExportError("");
    try {
      const res = await fetch(`/api/events/${event.id}/export?format=${format}&${exportQuery}`, {
        headers: { authorization: `Bearer ${adminKey}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "내보내기에 실패했습니다.");
      }
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: `${event.name}-${event.id}.${format}` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setExportError(error instanceof Error ? error.message : "연결을 확인해 주세요."); }
  }

  async function manageParticipant(person: PublicParticipant, action: "delete" | "recovery") {
    const message = action === "delete"
      ? `${person.name}님의 응답과 참여를 삭제할까요? 집계에서 제외되며 되돌릴 수 없습니다.`
      : `${person.name}님의 수정 권한을 재발급할까요? 기존 기기의 접속 권한과 개인 수정 링크가 모두 무효화됩니다. 본인임을 확인한 뒤 새 링크를 전달하세요.`;
    if (busyParticipant || !confirm(message)) return;
    setBusyParticipant(person.id);
    setManagementStatus("");
    try {
      const res = await fetch(`/api/events/${event.id}/participants/${person.id}${action === "recovery" ? "/recovery" : ""}`, {
        method: action === "delete" ? "DELETE" : "POST", headers: { authorization: `Bearer ${adminKey}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "처리하지 못했습니다.");
      if (action === "delete") {
        setPeople((current) => current.filter((p) => p.id !== person.id));
        setRequired((current) => new Set([...current].filter((name) => name !== person.name)));
        setPicked(null);
        setHover(null);
        allocation.onPick(null);
        setRecovery((current) => current?.id === person.id ? null : current);
        setManagementStatus(`${person.name}님의 응답을 삭제했습니다.`);
      } else {
        const params = new URLSearchParams({ participant: person.id, edit: data.editKey });
        setRecovery({ id: person.id, name: person.name, url: `${origin}/e/${event.id}#${params}` });
        setManagementStatus(`${person.name}님의 수정 링크를 재발급했습니다.`);
      }
    } catch (error) { setManagementStatus(error instanceof Error ? error.message : "연결을 확인해 주세요."); }
    finally { setBusyParticipant(""); }
  }

  const durations = Array.from({ length: Math.floor((event.endMin - event.startMin) / event.slotMinutes) }, (_, i) => (i + 1) * event.slotMinutes);

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
        <p className="muted small">관리자 링크에는 데이터 내보내기·응답 삭제·수정 권한 재발급 권한이 포함되어 있습니다. 공유하지 말고 안전한 곳에 보관하세요.</p>
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
                <input type="number" min={1} step={1} value={minPeople} onChange={(e) => setMinPeople(Math.max(1, Math.floor(Number(e.target.value)) || 1))} />
              </label>
            </div>
            {minPeople > people.length && <p className="response-notice small">최소 인원 {minPeople}명을 유지하고 있습니다. 현재 응답은 {people.length}명이라 조건을 충족하지 못합니다.</p>}
            {!dateOnly && <label className="merge-option"><input type="checkbox" checked={mergeContinuous} onChange={(e) => setMergeContinuous(e.target.checked)} />같은 참석자의 연속 구간 묶어 보기</label>}
            {!dateOnly && mergeContinuous && <p className="muted small">참석자가 같은 후보가 겹치거나 이어지면 한 구간으로 표시합니다. 표시된 구간은 회의 길이보다 길 수 있습니다.</p>}
            {people.length > 0 && (
              <div className="required">
                <span className="muted small">꼭 참석해야 하는 사람</span>
                <div className="chips">
                  {people.map((p) => (
                    <button
                      key={p.id} type="button"
                      className={`chip ${required.has(p.name) ? "on" : ""}`} aria-pressed={required.has(p.name)}
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
        <p className="muted">현재 필터({dateOnly ? "최소 인원·필수 참석자" : "회의 길이·최소 인원·필수 참석자·연속 구간 묶기"})와 최대 20개 제한이 엑셀·JSON의 최적 결과에 반영됩니다. CSV는 전체 응답 칸을 내보냅니다.</p>
        {exportError && <p className="error" role="alert">{exportError}</p>}
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
      <section className="card participant-management">
        <h2>참가자 응답 관리</h2>
        <p className="muted small">중복·장난 응답을 삭제하거나 본인 확인 후 개인 수정 링크를 재발급할 수 있습니다.</p>
        <p role="status" aria-live="polite">{managementStatus}</p>
        {people.length === 0 ? <p className="muted">아직 참가자가 없습니다.</p> : <ul className="participant-list">
          {people.map((person) => <li key={person.id}>
            <div><strong>{person.name}</strong><span className="muted small">선택 {person.slots.length}{dateOnly ? "일" : "칸"}</span></div>
            <div className="response-actions">
              <button disabled={!!busyParticipant} onClick={() => manageParticipant(person, "recovery")} aria-label={`${person.name}님 수정 권한 재발급`}>수정 권한 재발급</button>
              <button className="danger-button" disabled={!!busyParticipant} onClick={() => manageParticipant(person, "delete")} aria-label={`${person.name}님 응답 삭제`}>응답 삭제</button>
            </div>
          </li>)}
        </ul>}
        {recovery && <div className="private-link response-notice">
          <label className="field"><span>{recovery.name}님의 새 개인 수정 링크</span><input readOnly value={recovery.url} onFocus={(e) => e.target.select()} /></label>
          <button onClick={() => copy("recovery", recovery.url)}>{copied === "recovery" ? "복사됨" : "개인 수정 링크 복사"}</button>
          <p className="muted small">기존 기기의 접속 권한과 수정 링크는 만료되었습니다. 본인에게만 이 링크를 전달하세요.</p>
        </div>}
      </section>
    </div>
  );
}
