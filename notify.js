// รอบส่ง Stats: เดือนละครั้ง ช่วงวันที่ 16 – สิ้นเดือน (เวลาไทย)
// DM เตือนคนที่ยังไม่ส่ง: วันที่ 16, 23 และวันสุดท้ายของเดือน 18:00 (เวลาไทย) วันละครั้ง
// + สรุปรอบลงช่อง: วันที่ 1 ของเดือนถัดไป 09:00
// ส่งคนละครั้งเท่านั้น: จองแถวใน notify_log ก่อนส่ง (ถ้ามีแล้ว = เคยส่ง ข้าม)
const HUB = 'https://roo-manager.vercel.app';

function headers(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: key, 'Content-Type': 'application/json', ...extra };
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}
const base = () => `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1`;
async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${base()}/${path}`, { method, headers: headers(prefer ? { Prefer: prefer } : {}), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// true = จองได้ (ยังไม่เคยส่ง) — ใช้ ignore-duplicates: ถ้ามีแถวอยู่แล้วจะได้ [] กลับมา
async function claim(kind, discordId, key) {
  const rows = await rest('notify_log?on_conflict=kind,discord_id,key', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: { kind, discord_id: discordId, key: String(key) },
  });
  return Array.isArray(rows) && rows.length > 0;
}

function isoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function dm(client, discordId, text, label) {
  try {
    const user = await client.users.fetch(discordId);
    await user.send(text);
    console.log(`[notify] ${label} → ${discordId}`);
  } catch (err) {
    console.error(`[notify] ส่ง DM ${label} หา ${discordId} ไม่ได้:`, err.message);   // ปิดรับ DM ฯลฯ — ไม่ส่งซ้ำ
  }
}

// ── รอบส่ง: วันที่ 16 00:00 → สิ้นเดือน (เวลาไทย) ──
const TH = 7 * 3600 * 1000;
const thNow = (now) => new Date(now.getTime() + TH);
const pad = (n) => String(n).padStart(2, '0');
// y/m = เดือนตามเวลาไทย (m 0-based) → { key: '2026-11', from/to เป็น ISO UTC }
function period(y, m) {
  const from = new Date(Date.UTC(y, m, 16) - TH), to = new Date(Date.UTC(y, m + 1, 1) - TH);
  const start = new Date(Date.UTC(y, m, 1));   // ทำให้เดือนติดลบ/เกิน 11 เป็นปี-เดือนจริง
  return { key: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}`, from: from.toISOString(), to: to.toISOString() };
}
const inPeriod = (p) => `submitted_at=gte.${encodeURIComponent(p.from)}&submitted_at=lt.${encodeURIComponent(p.to)}`;

// ── เตือนส่ง Stats: วันที่ 16 / 23 / วันสุดท้ายของเดือน 18:00 เป็นต้นไป ใครยังไม่มีรายการในรอบนี้ (ไม่นับที่ถูก Reject) ──
async function statsReminder(client, now = new Date()) {
  const th = thNow(now);
  const y = th.getUTCFullYear(), m = th.getUTCMonth(), d = th.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  if (![16, 23, lastDay].includes(d) || th.getUTCHours() < 18) return;
  const p = period(y, m);
  const key = `${p.key}-d${pad(d)}`;   // วันละครั้ง
  const [members, subs] = await Promise.all([
    rest('members?select=discord_id,name&status=eq.active'),
    rest(`stats_submissions?select=discord_id&${inPeriod(p)}&status=neq.rejected`),
  ]);
  const done = new Set(subs.map((s) => s.discord_id));
  const deadline = d === lastDay ? 'วันนี้วันสุดท้าย' : `ส่งได้ถึงวันที่ ${lastDay}`;
  for (const mem of members) {
    if (done.has(mem.discord_id) || !/^\d{17,20}$/.test(mem.discord_id)) continue;
    if (!(await claim('stats_reminder', mem.discord_id, key))) continue;
    await dm(client, mem.discord_id,
      `⏰ สวัสดี **${mem.name}** — รอบนี้คุณยังไม่ได้ส่ง Stats (${deadline})\nส่งได้ที่ ${HUB}/#stats (ใช้รูป 4 รูป ไม่ถึง 2 นาที)`,
      `stats reminder ${key}`);
  }
}

// ── สรุปรอบลงช่อง Discord: วันที่ 1 09:00 (เวลาไทย) หลังปิดรอบ — เดือนละครั้ง ──
// ตั้ง STATS_SUMMARY_CHANNEL_ID ใน env ถึงจะส่ง (ไม่ตั้ง = ปิด)
const fmt = (n) => Math.round(Number(n)).toLocaleString('en-US');
const list = (names, max = 25) => names.length > max ? `${names.slice(0, max).join(', ')} และอีก ${names.length - max} คน` : names.join(', ');

async function statsSummary(client, now = new Date()) {
  const channelId = process.env.STATS_SUMMARY_CHANNEL_ID;
  if (!channelId) return;
  const th = thNow(now);
  if (th.getUTCDate() !== 1 || th.getUTCHours() < 9) return;
  const y = th.getUTCFullYear(), mo = th.getUTCMonth();
  const cur = period(y, mo - 1), last = period(y, mo - 2);   // Date.UTC รับเดือนติดลบได้
  if (!(await claim('stats_summary', 'channel', cur.key))) return;

  const [members, subs, prev, ths] = await Promise.all([
    rest('members?select=discord_id,name,class,gl_job&status=eq.active'),
    rest(`stats_submissions?select=*&${inPeriod(cur)}&status=neq.rejected&order=submitted_at.asc`),
    rest(`stats_submissions?select=discord_id,hp,patk,matk&${inPeriod(last)}&status=eq.approved&order=submitted_at.asc`),
    rest('stats_thresholds?select=class,field,min_value'),
  ]);
  const latest = new Map(); for (const s of subs) latest.set(s.discord_id, s);
  const before = new Map(); for (const s of prev) before.set(s.discord_id, s);
  const bench = {}; for (const t of ths) (bench[t.class] ??= {})[t.field] = Number(t.min_value);

  const missing = [], below = [], gains = [];
  for (const m of members) {
    const s = latest.get(m.discord_id);
    if (!s) { missing.push(m.name); continue; }
    const b = bench[m.gl_job || m.class] || {};
    const fails = Object.entries(b).filter(([f, min]) => s[f] != null && Number(s[f]) < min).length;
    if (fails) below.push({ name: m.name, fails });
    const p = before.get(m.discord_id);
    if (p?.hp && s.hp) gains.push({ name: m.name, d: Number(s.hp) - Number(p.hp) });
  }
  below.sort((a, b) => b.fails - a.fails);
  gains.sort((a, b) => b.d - a.d);
  const top = gains.filter((g) => g.d > 0).slice(0, 5);

  const lines = [
    `📊 **สรุป Stats รอบ ${cur.key}** (16 – สิ้นเดือน)`,
    `ส่งแล้ว **${members.length - missing.length}/${members.length}** คน`,
    missing.length ? `\n⏳ **ยังไม่ส่ง (${missing.length})**: ${list(missing)}` : '\n✅ ทุกคนส่งครบแล้ว',
    below.length ? `\n🔻 **ต่ำกว่าเกณฑ์ (${below.length})**: ${list(below.map((x) => `${x.name} (${x.fails})`))}` : '',
    top.length ? `\n📈 **HP เพิ่มขึ้นมากสุด**: ${top.map((g, i) => `${i + 1}. ${g.name} +${fmt(g.d)}`).join(' · ')}` : '',
    `\nดูทั้งหมด: ${HUB}/#stats`,
  ].filter(Boolean);
  let text = lines.join('\n');
  if (text.length > 1950) text = text.slice(0, 1950) + '…';
  try {
    const ch = await client.channels.fetch(channelId);
    await ch.send(text);
    console.log(`[notify] stats summary ${cur.key} → #${channelId}`);
  } catch (err) {
    console.error('[notify] ส่งสรุป Stats ไม่ได้:', err.message);
  }
}

module.exports = { statsReminder, statsSummary, isoWeek };
