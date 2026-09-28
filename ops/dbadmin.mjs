// When2meet+ DB admin. Binds to localhost only; expose it on the tailnet with
// `tailscale serve`, never with Funnel. Fixed actions only — no raw SQL.
//
//   DATABASE_PATH=./data/when2meet.db PUBLIC_URL=https://example.com node ops/dbadmin.mjs
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.DATABASE_PATH ?? "./data/when2meet.db";
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3101);

const db = new DatabaseSync(DB_PATH);

/** Consistent snapshot including WAL contents (a plain file copy would miss recent writes). */
function backup() {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 18);
  db.prepare(`VACUUM INTO ?`).run(`${DB_PATH}.bak-${stamp}`);
}

const notFound = () => Object.assign(new Error("not found"), { status: 404 });

const routes = {
  "GET /api/events": () =>
    db.prepare(`
      SELECT e.id, e.name, e.created_at AS createdAt, e.dates, COUNT(p.id) AS respondents,
             COALESCE(SUM(json_array_length(p.slots)), 0) AS checked
      FROM events e LEFT JOIN participants p ON p.event_id = e.id
      GROUP BY e.id ORDER BY e.created_at DESC
    `).all().map((r) => ({ ...r, dates: JSON.parse(r.dates) })),

  "GET /api/events/:id": ({ id }) => {
    const ev = db.prepare(`SELECT id, name, created_at AS createdAt, dates, timezone FROM events WHERE id = ?`).get(id);
    if (!ev) throw notFound();
    const participants = db.prepare(`
      SELECT id, name, password_hash IS NOT NULL AS hasPassword, json_array_length(slots) AS checked, updated_at AS updatedAt
      FROM participants WHERE event_id = ? ORDER BY name
    `).all(id);
    return { ...ev, dates: JSON.parse(ev.dates), publicUrl: `${PUBLIC_URL}/e/${id}`, participants };
  },

  "POST /api/events/:id/reissue": ({ id }) => {
    const key = randomBytes(24).toString("base64url");
    const r = db.prepare(`UPDATE events SET admin_key_hash = ? WHERE id = ?`).run(createHash("sha256").update(key).digest("hex"), id);
    if (!r.changes) throw notFound();
    return { adminUrl: `${PUBLIC_URL}/e/${id}/admin#key=${key}` };
  },

  "DELETE /api/events/:id": ({ id }) => {
    backup();
    db.prepare(`DELETE FROM participants WHERE event_id = ?`).run(id);
    return { deleted: db.prepare(`DELETE FROM events WHERE id = ?`).run(id).changes };
  },

  "DELETE /api/participants/:id": ({ id }) => {
    backup();
    return { deleted: db.prepare(`DELETE FROM participants WHERE id = ?`).run(id).changes };
  },
};

function match(method, path) {
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = key.split(" ");
    if (m !== method) continue;
    const names = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), "([^/]+)")) + "$");
    const hit = path.match(re);
    if (hit) return { handler, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(hit[i + 1])])) };
  }
  return null;
}

const send = (res, status, body, type = "application/json; charset=utf-8") => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-frame-options": "DENY" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
};

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/") return send(res, 200, PAGE, "text/html; charset=utf-8");

  const route = match(req.method, url.pathname);
  if (!route) return send(res, 404, { error: "not found" });

  // Mutations must be JSON requests, which cross-site forms cannot send without a CORS preflight.
  if (req.method !== "GET" && !String(req.headers["content-type"]).startsWith("application/json"))
    return send(res, 415, { error: "application/json required" });

  try {
    send(res, 200, route.handler(route.params));
  } catch (e) {
    send(res, e.status ?? 500, { error: String(e.message ?? e) });
  }
}).listen(PORT, HOST, () => console.log(`dbadmin on http://${HOST}:${PORT} (db: ${DB_PATH})`));

const PAGE = /* html */ `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>When2meet+ DB</title>
<style>
:root{--bg:#f7f8fa;--surface:#fff;--text:#16181d;--muted:#6b7280;--border:#e3e6eb;--accent:#2563eb;--danger:#dc2626;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f1115;--surface:#171a21;--text:#e7e9ee;--muted:#9aa1ad;--border:#2a2f39;--accent:#4f8cff;--danger:#f87171;color-scheme:dark}}
:root[data-theme=dark]{--bg:#0f1115;--surface:#171a21;--text:#e7e9ee;--muted:#9aa1ad;--border:#2a2f39;--accent:#4f8cff;--danger:#f87171;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
header{padding:14px 16px;border-bottom:1px solid var(--border);background:var(--surface);display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
header b{font-size:16px}header span{color:var(--muted);font-size:12px}
main{max-width:1100px;margin:0 auto;padding:20px 16px 60px;display:grid;gap:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;min-width:0}
h2{font-size:15px;margin:0}.muted{color:var(--muted)}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--border);white-space:nowrap}
th{font-size:12px;color:var(--muted);font-weight:600}.num{text-align:right;font-variant-numeric:tabular-nums}
tbody tr.click{cursor:pointer}tbody tr.click:hover td,tr.sel td{background:color-mix(in srgb,var(--accent) 10%,transparent)}
.scroll{overflow-x:auto;margin-top:10px}
button{font:inherit;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:7px;padding:5px 10px;cursor:pointer}
button.danger{color:var(--danger);border-color:var(--danger)}
.head{display:flex;justify-content:space-between;align-items:center;gap:8px}
code{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.link{display:flex;gap:8px;align-items:center;margin:8px 0}.link>span{flex:0 0 48px;font-weight:600}
.link code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--bg);padding:5px 8px;border-radius:6px}
</style></head><body>
<header><b>When2meet+ DB</b><span>tailnet 전용 · 삭제 전 자동 백업</span></header>
<main>
<section class="card"><div class="head"><h2>이벤트</h2><button id="refresh">새로고침</button></div>
<div class="scroll"><table><thead><tr><th>이름</th><th>ID</th><th>생성</th><th>날짜</th><th class="num">응답</th><th class="num">체크</th></tr></thead><tbody id="events"></tbody></table></div></section>
<section class="card" id="detail" hidden></section>
</main>
<script>
const $=(s)=>document.querySelector(s);
const esc=(v)=>String(v??"").replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=(iso)=>new Date(iso).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
async function api(method,path){const r=await fetch(path,{method,headers:{"content-type":"application/json"}});const j=await r.json();if(!r.ok)throw new Error(j.error);return j}
let current=null;

async function loadEvents(){
  const list=await api("GET","/api/events");
  $("#events").innerHTML=list.length?list.map(e=>\`<tr class="click \${e.id===current?"sel":""}" data-id="\${esc(e.id)}"><td>\${esc(e.name)}</td><td><code>\${esc(e.id)}</code></td><td>\${fmt(e.createdAt)}</td><td>\${esc(e.dates[0])}\${e.dates.length>1?" 외 "+(e.dates.length-1)+"일":""}</td><td class="num">\${e.respondents}</td><td class="num">\${e.checked}</td></tr>\`).join(""):'<tr><td colspan="6" class="muted">이벤트 없음</td></tr>';
  document.querySelectorAll("#events tr[data-id]").forEach(tr=>tr.onclick=()=>show(tr.dataset.id));
}

async function show(id){
  current=id;loadEvents();
  const e=await api("GET","/api/events/"+encodeURIComponent(id));const d=$("#detail");d.hidden=false;
  d.innerHTML=\`<div class="head"><h2>\${esc(e.name)}</h2><button class="danger" id="delEv">이벤트 삭제</button></div>
  <div class="muted">\${e.dates.map(esc).join(", ")} · \${esc(e.timezone)}</div>
  <div class="link"><span>참가자</span><code>\${esc(e.publicUrl)}</code><a href="\${esc(e.publicUrl)}" target="_blank" rel="noopener">열기</a></div>
  <div class="link"><span>관리자</span><code id="adm" class="muted">키는 해시로만 저장돼요. 재발급하면 이전 링크는 무효가 됩니다.</code><button id="reissue">재발급</button></div>
  <div class="scroll"><table><thead><tr><th>이름</th><th class="num">체크</th><th>비밀번호</th><th>마지막 수정</th><th></th></tr></thead><tbody>
  \${e.participants.map(p=>\`<tr><td>\${esc(p.name)}</td><td class="num">\${p.checked}</td><td>\${p.hasPassword?"있음":"-"}</td><td>\${fmt(p.updatedAt)}</td><td><button class="danger" data-pid="\${esc(p.id)}" data-name="\${esc(p.name)}">삭제</button></td></tr>\`).join("")||'<tr><td colspan="5" class="muted">응답 없음</td></tr>'}
  </tbody></table></div>\`;
  $("#reissue").onclick=async()=>{
    if(!confirm("관리자 링크를 재발급할까요? 기존 링크는 더 이상 작동하지 않습니다."))return;
    const r=await api("POST","/api/events/"+encodeURIComponent(id)+"/reissue");
    const c=$("#adm");c.textContent=r.adminUrl;c.classList.remove("muted");
    const b=$("#reissue");b.textContent="복사";b.onclick=()=>navigator.clipboard.writeText(r.adminUrl).then(()=>b.textContent="복사됨");
  };
  $("#delEv").onclick=async()=>{
    if(prompt("삭제하려면 이벤트 ID("+id+")를 입력하세요")!==id)return;
    await api("DELETE","/api/events/"+encodeURIComponent(id));current=null;d.hidden=true;loadEvents();
  };
  d.querySelectorAll("[data-pid]").forEach(b=>b.onclick=async()=>{
    if(!confirm(b.dataset.name+"님의 응답을 삭제할까요?"))return;
    await api("DELETE","/api/participants/"+encodeURIComponent(b.dataset.pid));show(id);
  });
}
$("#refresh").onclick=()=>current?show(current):loadEvents();
loadEvents();
</script></body></html>`;
