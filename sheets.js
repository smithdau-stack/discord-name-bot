require('dotenv').config();
const { google } = require('googleapis');

async function getSheetAuth() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
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

// ดึงรายชื่อจาก Tab "Member List"
async function getMembers() {
  const auth   = await getSheetAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range:         "'Member List'!A2:B",
  });

  const rows = res.data.values || [];
  console.log('ดึงข้อมูลได้:', rows.length, 'แถว'); // เช็คตรงนี้

  return rows
    .filter(row => row[0] && row[0].trim() !== '')
    .map(row => ({
      name:         row[0].trim(),
      currentClass: row[1]?.trim() || 'ไม่ระบุ',
    }));
}

module.exports = { appendToSheet, getMembers };