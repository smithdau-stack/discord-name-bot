require('dotenv').config();
const { google } = require('googleapis');

async function getSheetAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  }
  
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

// บันทึก Log
async function appendToSheet(rowData) {
  const auth   = await getSheetAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId:    process.env.SPREADSHEET_ID,
    range:            'Log!A:F',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowData] },
  });

  console.log('บันทึกลง Sheet สำเร็จ:', rowData);
}

// ── Cache สำหรับ Member List ──
// Member List: A=Name, B=Class JOB, C=Emblem, D=discord_id (1 discord_id = 1 สมาชิกเสมอ)
let memberCache       = null; // [{ name, currentClass, discordId }]
let memberByDiscordId = null; // Map<discordId, member>
let cacheTime = 0;
const CACHE_TTL = 60 * 1000; // 60 วินาที

async function loadMembers() {
  // ถ้ามี cache และยังไม่หมดอายุ → ใช้ของเก่า
  if (memberCache && Date.now() - cacheTime < CACHE_TTL) {
    return memberCache;
  }

  const auth   = await getSheetAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range:         "'Member List'!A2:D",
  });

  const rows = res.data.values || [];
  console.log('ดึงข้อมูลได้:', rows.length, 'แถว');

  const members = rows
    .filter(row => row[0] && row[0].trim() !== '')
    .map(row => ({
      name:         row[0].trim(),
      currentClass: row[1]?.trim() || 'ไม่ระบุ',
      discordId:    row[3]?.trim() || '',
    }));

  // เก็บลง cache
  memberCache       = members;
  memberByDiscordId = new Map(members.filter(m => m.discordId).map(m => [m.discordId, m]));
  cacheTime = Date.now();

  return members;
}

// ดึงรายชื่อจาก Tab "Member List" (ใช้กับ autocomplete ของ /เปลี่ยนชื่อ, /เปลี่ยนอาชีพ)
async function getMembers() {
  return loadMembers();
}

// หาสมาชิกจาก discord_id (ใช้กับ /stats — 1 discord_id ผูกกับสมาชิกเดียวเสมอ
// จึงไม่ต้องให้ผู้ใช้เลือกชื่อเอง กัน mismatch ระหว่าง discord_id กับตัวละครที่เลือก)
async function getMemberByDiscordId(discordId) {
  await loadMembers();
  return memberByDiscordId.get(discordId) || null;
}

// บันทึก Stats ลง stats_log
async function writeStatsToSheet(stats) {
  const auth   = await getSheetAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const week = getISOWeek();

  const row = [
    week,                          // A: week
    stats.discord_id,              // B: discord_id
    stats.name,                    // C: name
    stats.class,                   // D: class
    stats.general?.hp ?? '',       // E: hp
    stats.general?.patk ?? '',     // F: patk
    stats.general?.matk ?? '',     // G: matk
    stats.quasi?.crit ?? '',       // H: crit
    stats.quasi?.crit_dmg ?? '',   // I: crit_dmg
    stats.quasi?.healing_done ?? '',    // J: healing_done
    stats.quasi?.healing_taken ?? '',   // K: healing_taken
    stats.quasi?.pdmg ?? '',       // L: pdmg
    stats.quasi?.mdmg ?? '',       // M: mdmg
    stats.quasi?.pdmg_r ?? '',     // N: pdmg_r
    stats.quasi?.mdmg_r ?? '',     // O: mdmg_r
    stats.quasi?.ignore_pdef ?? '',     // P: ignore_pdef
    stats.quasi?.ignore_mdef ?? '',     // Q: ignore_mdef
    stats.quasi?.pve_dmg_reduc ?? '',   // R: pve_dmg_reduc
    stats.quasi?.pvp_dmg_reduc ?? '',   // S: pvp_dmg_reduc
    stats.quasi?.pve_dmg_bonus ?? '',   // T: pve_dmg_bonus
    stats.quasi?.pvp_dmg_bonus ?? '',   // U: pvp_dmg_bonus
    stats.special?.equip_pdef_pct ?? '', // V: equip_pdef_pct
    stats.special?.equip_mdef_pct ?? '', // W: equip_mdef_pct
    stats.notice?.base_pdef ?? '',       // X: base_pdef
    stats.notice?.equip_pdef ?? '',      // Y: equip_pdef
    'pending',                           // Z: status
    new Date().toISOString(),            // AA: submitted_at
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId:    process.env.SPREADSHEET_ID,
    range:            'stats_log!A:AA',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  console.log('บันทึก stats สำเร็จ:', stats.name, week);
}

// คำนวณ ISO Week
function getISOWeek() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ── Review: แถวที่ reviewer ตัดสินแล้วแต่ยังไม่ได้แจ้งผู้ส่ง ──
// คอลัมน์: B discord_id | C name | A week | Z status | AB review_note | AC notified_at
async function getUnnotifiedReviews() {
  const auth   = await getSheetAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range:         'stats_log!A2:AD',
  });

  const out = [];
  (res.data.values || []).forEach((r, i) => {
    const status = r[25];
    if ((status === 'approved' || status === 'rejected') && !r[28]) {
      out.push({
        rowNum:    i + 2,
        week:      r[0],
        discordId: r[1],
        name:      r[2],
        status,
        note:      r[27] || '',
      });
    }
  });
  return out;
}

async function markNotified(rowNum) {
  const auth   = await getSheetAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.update({
    spreadsheetId:    process.env.SPREADSHEET_ID,
    range:            `stats_log!AC${rowNum}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[new Date().toISOString()]] },
  });
}

module.exports = { appendToSheet, getMembers, getMemberByDiscordId, writeStatsToSheet, getUnnotifiedReviews, markNotified };

