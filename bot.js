require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { getUnnotifiedReviews, markNotified } = require('./db');
const { weeklyStatsReminder, dropOpenedNotify } = require('./notify');

// ส่ง Stats ย้ายไปหน้าเว็บ (Guild Hub → Submit stats) แล้ว — บอทเหลือหน้าที่ DM แจ้งผลรีวิว
const HUB_URL = 'https://roo-manager.vercel.app/#stats';
const REVIEW_POLL_MS = 2 * 60 * 1000;
const REMINDER_POLL_MS = 15 * 60 * 1000;   // เตือนส่ง Stats: เช็คทุก 15 นาที (ส่งจริงเฉพาะอาทิตย์ 18:00+ และคนละครั้ง)

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', () => {
  console.log(`Bot พร้อมแล้ว: ${client.user.tag}`);
  notifyReviewResults();
  setInterval(notifyReviewResults, REVIEW_POLL_MS);
  runSafe('drop', () => dropOpenedNotify(client));
  setInterval(() => runSafe('drop', () => dropOpenedNotify(client)), REVIEW_POLL_MS);
  runSafe('reminder', () => weeklyStatsReminder(client));
  setInterval(() => runSafe('reminder', () => weeklyStatsReminder(client)), REMINDER_POLL_MS);
});

// กันงานเดียวกันรันซ้อน (เช่น รอบก่อนยังส่ง DM ไม่เสร็จ)
const running = new Set();
async function runSafe(name, fn) {
  if (running.has(name)) return;
  running.add(name);
  try { await fn(); } catch (err) { console.error(`[${name}]`, err?.message || err); } finally { running.delete(name); }
}

let notifying = false;

async function notifyReviewResults() {
  if (notifying) return;
  notifying = true;
  try {
    const items = await getUnnotifiedReviews();
    for (const it of items) {
      const text = it.status === 'approved'
        ? `✅ Stats ของ **${it.name}** (${it.week}) ได้รับการ **อนุมัติ** แล้วครับ`
        : `❌ Stats ของ **${it.name}** (${it.week}) **ไม่ผ่าน**\n` +
          `เหตุผล: ${it.note || '-'}\nส่งใหม่ได้ที่ ${HUB_URL}`;
      try {
        const user = await client.users.fetch(it.discordId);
        await user.send(text);
        console.log(`[review] แจ้ง ${it.name} (${it.status}) สำเร็จ`);
      } catch (err) {
        // เช่น ผู้ใช้ปิดรับ DM — ไม่ retry เพื่อกัน loop
        console.error(`[review] ส่ง DM หา ${it.name} ไม่ได้:`, err.message);
      }
      await markNotified(it.id);
    }
  } catch (err) {
    console.error('[review] ตรวจสถานะรีวิวไม่สำเร็จ:', err?.stack || err);
  } finally {
    notifying = false;
  }
}

client.login(process.env.DISCORD_TOKEN);

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err?.stack || err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err?.stack || err));
