// DM เตือนลูกกิลที่ยังไม่ส่ง Stats: จันทร์ + อังคาร 18:00 (เวลาไทย) วันละครั้ง
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

// ── เตือนส่ง Stats: จันทร์/อังคาร 18:00 เป็นต้นไป (เวลาไทย = 11:00 UTC) ใครยังไม่มีรายการสัปดาห์นี้ (ไม่นับที่ถูก Reject) ──
async function weeklyStatsReminder(client, now = new Date()) {
  const th = new Date(now.getTime() + 7 * 3600 * 1000);   // เวลาไทย
  const day = th.getUTCDay();   // 1 = จันทร์, 2 = อังคาร
  if ((day !== 1 && day !== 2) || th.getUTCHours() < 18) return;
  const week = isoWeek(now);
  const key = `${week}-${day === 1 ? 'mon' : 'tue'}`;   // วันละครั้ง
  const [members, subs] = await Promise.all([
    rest('members?select=discord_id,name&status=eq.active'),
    rest(`stats_submissions?select=discord_id&week=eq.${encodeURIComponent(week)}&status=neq.rejected`),
  ]);
  const done = new Set(subs.map((s) => s.discord_id));
  for (const m of members) {
    if (done.has(m.discord_id) || !/^\d{17,20}$/.test(m.discord_id)) continue;
    if (!(await claim('stats_reminder', m.discord_id, key))) continue;
    await dm(client, m.discord_id,
      `⏰ สวัสดี **${m.name}** — สัปดาห์นี้คุณยังไม่ได้ส่ง Stats\nส่งได้ที่ ${HUB}/#stats (ใช้รูป 4 รูป ไม่ถึง 2 นาที)`,
      `stats reminder ${key}`);
  }
}

module.exports = { weeklyStatsReminder, isoWeek };
