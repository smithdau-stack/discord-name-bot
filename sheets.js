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
let memberCache = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000; // 60 วินาที

// ดึงรายชื่อจาก Tab "Member List"
async function getMembers() {
  // ถ้ามี cache และยังไม่หมดอายุ → ใช้ของเก่า
  if (memberCache && Date.now() - cacheTime < CACHE_TTL) {
    return memberCache;
  }

  const auth   = await getSheetAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range:         "'Member List'!A2:B",
  });

  const rows = res.data.values || [];
  console.log('ดึงข้อมูลได้:', rows.length, 'แถว');

  const members = rows
    .filter(row => row[0] && row[0].trim() !== '')
    .map(row => ({
      name:         row[0].trim(),
      currentClass: row[1]?.trim() || 'ไม่ระบุ',
    }));

  // เก็บลง cache
  memberCache = members;
  cacheTime = Date.now();

  return members;
}

module.exports = { appendToSheet, getMembers };