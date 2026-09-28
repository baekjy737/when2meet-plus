"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { pad } from "@/lib/slots";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export default function CreateForm() {
  const router = useRouter();
  const today = new Date();
  const [name, setName] = useState("");
  const [month, setMonth] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [start, setStart] = useState(9);
  const [end, setEnd] = useState(21);
  const [slot, setSlot] = useState(30);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());

  const cells = useMemo(() => {
    const first = new Date(month.y, month.m, 1).getDay();
    const days = new Date(month.y, month.m + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => iso(month.y, month.m, i + 1))];
  }, [month]);

  const toggle = (d: string) => setDates((s) => {
    const n = new Set(s);
    n.has(d) ? n.delete(d) : n.add(d);
    return n;
  });

  const shift = (delta: number) => setMonth(({ y, m }) => {
    const t = new Date(y, m + delta, 1);
    return { y: t.getFullYear(), m: t.getMonth() };
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name, dates: [...dates], startMin: start * 60, endMin: end * 60, slotMinutes: slot,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "생성 실패");
    try { localStorage.setItem(`admin:${data.id}`, data.adminKey); } catch {}
    router.push(`/e/${data.id}/admin#key=${data.adminKey}`);
  }

  const hours = Array.from({ length: 25 }, (_, h) => h);

  return (
    <form className="card create" onSubmit={submit}>
      <label className="field">
        <span>이벤트 이름</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 학생회 정기회의" maxLength={100} required />
      </label>

      <div className="field">
        <span>날짜 선택 <small>({dates.size}일)</small></span>
        <div className="cal">
          <div className="cal-head">
            <button type="button" onClick={() => shift(-1)} aria-label="이전 달">‹</button>
            <strong>{month.y}년 {month.m + 1}월</strong>
            <button type="button" onClick={() => shift(1)} aria-label="다음 달">›</button>
          </div>
          <div className="cal-grid">
            {WEEK.map((w) => <div key={w} className="cal-wd">{w}</div>)}
            {cells.map((d, i) => d ? (
              <button
                type="button" key={d} onClick={() => toggle(d)}
                className={`cal-day ${dates.has(d) ? "on" : ""} ${d < todayIso ? "past" : ""}`}
              >{Number(d.slice(8))}</button>
            ) : <div key={`x${i}`} />)}
          </div>
        </div>
      </div>

      <div className="row">
        <label className="field">
          <span>시작</span>
          <select value={start} onChange={(e) => setStart(Number(e.target.value))}>
            {hours.slice(0, 24).map((h) => <option key={h} value={h}>{pad(h)}:00</option>)}
          </select>
        </label>
        <label className="field">
          <span>종료</span>
          <select value={end} onChange={(e) => setEnd(Number(e.target.value))}>
            {hours.slice(1).map((h) => <option key={h} value={h}>{pad(h)}:00</option>)}
          </select>
        </label>
        <label className="field">
          <span>단위</span>
          <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
            <option value={15}>15분</option>
            <option value={30}>30분</option>
            <option value={60}>1시간</option>
          </select>
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy || !name || dates.size === 0 || end <= start}>
        {busy ? "만드는 중…" : "이벤트 만들기"}
      </button>
    </form>
  );
}
