// Supabase (REST) — บอทใช้แค่แจ้งผลรีวิว Stats ทาง DM
function headers() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: key, 'Content-Type': 'application/json' };
  // key แบบใหม่ (sb_secret_...) ไม่ใช่ JWT ใส่ใน Authorization ไม่ได้ — ใส่เฉพาะ legacy (eyJ...)
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}
const base = () => `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1`;

// รีวิวแล้ว (ผ่าน/ไม่ผ่าน) แต่ยังไม่ได้ DM แจ้งเจ้าของ
async function getUnnotifiedReviews() {
  const url = `${base()}/stats_submissions?select=id,week,discord_id,name,status,review_note`
    + '&status=in.(approved,rejected)&notified_at=is.null&order=reviewed_at.asc&limit=50';
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Supabase stats_submissions → ${res.status}: ${await res.text()}`);
  return (await res.json()).map((r) => ({
    id: r.id, week: r.week, discordId: r.discord_id, name: r.name, status: r.status, note: r.review_note,
  }));
}

async function markNotified(id) {
  const res = await fetch(`${base()}/stats_submissions?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: headers(), body: JSON.stringify({ notified_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase markNotified → ${res.status}: ${await res.text()}`);
}

module.exports = { getUnnotifiedReviews, markNotified };
