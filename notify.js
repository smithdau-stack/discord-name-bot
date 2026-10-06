// DM แจ้งเตือนลูกกิล: เตือนส่ง Stats (อาทิตย์เย็น) + แจ้งเมื่อเปิดการแจกขนนก/การ์ด
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

// ── เตือนส่ง Stats: อาทิตย์ 18:00 เป็นต้นไป (เวลาไทย = 11:00 UTC) ใครยังไม่มีรายการสัปดาห์นี้ (ไม่นับที่ถูก Reject) ──
async function weeklyStatsReminder(client, now = new Date()) {
  const th = new Date(now.getTime() + 7 * 3600 * 1000);   // เวลาไทย
  if (th.getUTCDay() !== 0 || th.getUTCHours() < 18) return;
  const week = isoWeek(now);
  const [members, subs] = await Promise.all([
    rest('members?select=discord_id,name&status=eq.active'),
    rest(`stats_submissions?select=discord_id&week=eq.${encodeURIComponent(week)}&status=neq.rejected`),
  ]);
  const done = new Set(subs.map((s) => s.discord_id));
  for (const m of members) {
    if (done.has(m.discord_id) || !/^\d{17,20}$/.test(m.discord_id)) continue;
    if (!(await claim('stats_reminder', m.discord_id, week))) continue;
    await dm(client, m.discord_id,
      `⏰ สวัสดี **${m.name}** — สัปดาห์นี้คุณยังไม่ได้ส่ง Stats\nส่งได้ที่ ${HUB}/#stats (ใช้รูป 4 รูป ไม่ถึง 2 นาที)`,
      `stats reminder ${week}`);
  }
}

// ── แจ้งเมื่อเปิดการแจก: คำนวณแบบเดียวกับหน้าคิว (เรียงรอบ → ลำดับ, ต่อคนไม่เกิน cap) ──
async function dropOpenedNotify(client) {
  // เฉพาะการแจกที่เพิ่งเปิด (6 ชม.) — กันบอทรีสตาร์ท/deploy แล้วไล่ DM การแจกเก่าที่ดึงกันไปแล้ว
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const drops = await rest(`feather_drops?select=id,kind,total_white,total_red,cap_white,cap_red&status=eq.open&created_at=gte.${encodeURIComponent(since)}`);
  for (const d of drops) {
    const single = d.kind === 'card';
    const rounds = await rest(`feather_rounds?select=id,no&kind=eq.${d.kind}&order=no.asc`);
    if (!rounds.length) continue;
    const entries = await rest(`feather_entries?select=id,round_id,position,discord_id,want_white,want_red,got_white,got_red&round_id=in.(${rounds.map((r) => r.id).join(',')})`);
    const no = new Map(rounds.map((r) => [r.id, r.no]));
    entries.sort((a, b) => no.get(a.round_id) - no.get(b.round_id) || a.position - b.position);
    // ยอดที่กรอก "ดึงได้จริง" ไปแล้วในการแจกนี้ → บวกคืน ให้ได้แผนเดียวกับตอนเปิดแจก
    const pulled = new Map();
    for (const p of await rest(`feather_pulls?select=entry_id,color,qty&drop_id=eq.${d.id}`)) pulled.set(`${p.entry_id}:${p.color}`, p.qty);
    const gets = new Map();
    for (const color of single ? ['white'] : ['white', 'red']) {
      let free = d[`total_${color}`] || 0;
      const cap = d[`cap_${color}`] ?? Infinity;
      for (const e of entries) {
        if (free <= 0) break;
        const gotBefore = e[`got_${color}`] - (pulled.get(`${e.id}:${color}`) || 0);
        const need = Math.min(cap, Math.max(0, e[`want_${color}`] - gotBefore));
        const take = Math.min(need, free);
        if (!take) continue;
        free -= take;
        const g = gets.get(e.discord_id) || { white: 0, red: 0, round: no.get(e.round_id) };
        g[color] += take;
        gets.set(e.discord_id, g);
      }
    }
    for (const [id, g] of gets) {
      if (!(await claim('drop', id, d.id))) continue;
      const what = single ? `**การ์ด ${g.white} ใบ**` : `**ขนขาว ${g.white} · ขนแดง ${g.red}**`;
      await dm(client, id,
        `${single ? '🃏 เปิดแจกการ์ดแล้ว!' : '🕊️ เปิดแจกขนนกแล้ว!'} รอบนี้คุณได้ ${what} (รอบที่ ${g.round})\n` +
        `ดูตำแหน่งที่ต้องดึงได้ที่ ${HUB}/#${single ? 'cards' : 'feathers'}`,
        `drop ${d.id}`);
    }
  }
}

module.exports = { weeklyStatsReminder, dropOpenedNotify, isoWeek };
