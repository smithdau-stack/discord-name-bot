require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
} = require('discord.js');
const { getMemberByDiscordId, writeStatsToSheet, getUnnotifiedReviews, markNotified } = require('./sheets');
const { analyzeImage } = require('./vision');

const pendingUpload      = new Map();
// pendingUpload structure:
// { charName, charClass, discordId, channelId, expiresAt, step, general, quasi, special, notice }
const SESSION_TTL_MS = 10 * 60 * 1000; // session หมดอายุเมื่อไม่มีการส่งรูปเกิน 10 นาที

// ── ISO Week helper ──
function getISOWeekLabel() {
  const now  = new Date();
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages, // ต้องมี ไม่งั้น messageCreate จะไม่ยิงสำหรับ DM
  ],
  partials: [Partials.Channel], // DM channel ที่ยังไม่ cache จะมาเป็น partial ต้องเปิดรับไว้
});

client.once('clientReady', () => {
  console.log(`Bot พร้อมแล้ว: ${client.user.tag}`);
  setInterval(notifyReviewResults, REVIEW_POLL_MS);
});

// ── แจ้งผู้ส่งเมื่อ reviewer อนุมัติ/ปฏิเสธ (ตรวจ Sheet ทุก 2 นาที) ──
const REVIEW_POLL_MS = 2 * 60 * 1000;
let notifying = false;

async function notifyReviewResults() {
  if (notifying) return;
  notifying = true;
  try {
    const items = await getUnnotifiedReviews();
    for (const it of items) {
      const approved = it.status === 'approved';
      const text = approved
        ? `✅ Stats ของ **${it.name}** (${it.week}) ได้รับการ **อนุมัติ** แล้วครับ`
        : `❌ Stats ของ **${it.name}** (${it.week}) ถูก **ปฏิเสธ**\n` +
          `เหตุผล: ${it.note || '-'}\nกรุณาพิมพ์ /stats แล้วส่งใหม่อีกครั้งครับ`;
      try {
        const user = await client.users.fetch(it.discordId);
        await user.send(text);
        console.log(`[review] แจ้ง ${it.name} (${it.status}) สำเร็จ`);
      } catch (err) {
        // เช่น ผู้ใช้ปิดรับ DM — ไม่ retry เพื่อกัน loop
        console.error(`[review] ส่ง DM หา ${it.name} ไม่ได้:`, err.message);
      }
      await markNotified(it.rowNum);
    }
  } catch (err) {
    console.error('[review] ตรวจ Sheet ไม่สำเร็จ:', err?.stack || err);
  } finally {
    notifying = false;
  }
}

// ── รับรูปภาพทีละ step (messageCreate) ──
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const session = pendingUpload.get(message.author.id);
  if (!session) return;
  if (Date.now() > session.expiresAt) {
    pendingUpload.delete(message.author.id);
    return;
  }
  if (message.channelId !== session.channelId) return;
  if (message.attachments.size === 0) return;

  const attachment = message.attachments.first();
  const imageUrl   = attachment.url;
  const userId     = message.author.id;

  const stepMap = {
    general: {
      label:     'General Stats',
      next:      'quasi',
      nextLabel: 'Quasi Stats',
      stepNum:   '2/4',
    },
    quasi: {
      label:     'Quasi Stats',
      next:      'special',
      nextLabel: 'Special',
      stepNum:   '3/4',
    },
    special: {
      label:     'Special',
      next:      'notice',
      nextLabel: 'Notice (PDEF)',
      stepNum:   '4/4',
    },
    notice: {
      label:     'Notice (PDEF)',
      next:      null,
      nextLabel: null,
      stepNum:   null,
    },
  };

  const current = stepMap[session.step];
  if (!current) return;

  let processing;
  try {
    processing = await message.reply(`⏳ กำลังอ่าน **${current.label}**...`);

    console.log(`[stats] step=${session.step} user=${userId} url=${String(imageUrl).split('?')[0]}`);
    const extracted = await analyzeImage(imageUrl, session.step);
    session[session.step] = extracted;

    if (current.next) {
      // ยังไม่ครบ 4 รูป → ขอรูปถัดไป
      session.step = current.next;
      session.expiresAt = Date.now() + SESSION_TTL_MS;
      pendingUpload.set(userId, session);

      await processing.edit(
        `✅ **${current.label}** อ่านได้แล้ว!\n\n` +
        `**Step ${current.stepNum}** → ` +
        `ส่งรูป 📷 **${current.nextLabel}** ต่อเลยครับ`
      );
    } else {
      // ครบ 4 รูปแล้ว → บันทึกลง Sheet
      await processing.edit(`⏳ ครบแล้ว! กำลังบันทึกลง Google Sheet...`);

      await writeStatsToSheet({
        discord_id: session.discordId,
        name:       session.charName,
        class:      session.charClass,
        general:    session.general,
        quasi:      session.quasi,
        special:    session.special,
        notice:     session.notice,
      });

      pendingUpload.delete(userId);

      const g = session.general;
      const q = session.quasi;
      const s = session.special;
      const n = session.notice;

      await processing.edit(
        `✅ **บันทึก Stats เรียบร้อยแล้ว!**\n` +
        `👤 **${session.charName}** (${session.charClass}) | ${getISOWeekLabel()}\n\n` +
        `**📊 General Stats**\n` +
        `HP: \`${g?.hp ?? '-'}\` | PATK: \`${g?.patk ?? '-'}\` | MATK: \`${g?.matk ?? '-'}\`\n\n` +
        `**⚡ Quasi Stats**\n` +
        `CRIT: \`${q?.crit ?? '-'}\` | CRIT DMG: \`${q?.crit_dmg ?? '-'}%\`\n` +
        `PDMG: \`${q?.pdmg ?? '-'}%\` | MDMG: \`${q?.mdmg ?? '-'}%\`\n` +
        `PDMG.R: \`${q?.pdmg_r ?? '-'}%\` | MDMG.R: \`${q?.mdmg_r ?? '-'}%\`\n` +
        `Healing Done: \`${q?.healing_done ?? '-'}%\` | Healing Taken: \`${q?.healing_taken ?? '-'}%\`\n` +
        `Ignore PDEF: \`${q?.ignore_pdef ?? '-'}\` | Ignore MDEF: \`${q?.ignore_mdef ?? '-'}\`\n` +
        `PvE DMG Reduc: \`${q?.pve_dmg_reduc ?? '-'}\` | PvP DMG Reduc: \`${q?.pvp_dmg_reduc ?? '-'}\`\n` +
        `PvE DMG Bonus: \`${q?.pve_dmg_bonus ?? '-'}\` | PvP DMG Bonus: \`${q?.pvp_dmg_bonus ?? '-'}\`\n\n` +
        `**✨ Special**\n` +
        `Equip PDEF%: \`${s?.equip_pdef_pct ?? '-'}%\` | Equip MDEF%: \`${s?.equip_mdef_pct ?? '-'}%\`\n\n` +
        `**📋 Notice**\n` +
        `Base PDEF: \`${n?.base_pdef ?? '-'}\` | Equip PDEF: \`${n?.equip_pdef ?? '-'}\``
      );
    }
  } catch (err) {
    console.error(`[stats] step=${session.step} user=${userId} failed:`, err?.stack || err);
    if (processing) {
      await processing.edit(
        `❌ อ่านรูป **${current.label}** ไม่ได้ครับ\n` +
        `กรุณาส่งรูปใหม่อีกครั้ง (รูปต้องชัดเจน ไม่มีการ crop ส่วนสำคัญออก)`
      );
    }
  }
});

// ── Slash Commands & Interactions ──
client.on('interactionCreate', async (interaction) => {

  // ── /upload-stats ──
  if (interaction.isChatInputCommand() && interaction.commandName === 'stats') {
    // หาตัวละครจาก discord_id ของคนพิมพ์คำสั่งเอง (1 discord_id = 1 สมาชิกเสมอ)
    // กันไม่ให้เลือกชื่อ/อาชีพผิดคน หรือเลือกชื่อคนอื่นโดยตั้งใจ
    const member = await getMemberByDiscordId(interaction.user.id);
    if (!member) {
      await interaction.reply({
        content: `❌ ไม่พบตัวละครของคุณในรายชื่อสมาชิกกิลครับ\nกรุณาสร้างตัวละครที่หน้าเว็บ (เมนู 🧑 ตัวละครของฉัน) แล้วรอแอดมินอนุมัติก่อน`,
        flags: 64,
      });
      return;
    }
    const charName  = member.name;
    const charClass = member.currentClass;

    // ทำขั้นตอนส่งรูปทั้งหมดใน DM แทนห้องเซิร์ฟเวอร์ กันไม่ให้คนอื่นในห้องเห็นรูป/ข้อความรกๆ 4 รูปต่อคน
    let dm;
    try {
      dm = await interaction.user.createDM();
    } catch (err) {
      console.error(`[stats] createDM failed for ${interaction.user.id}:`, err.message);
    }
    if (!dm) {
      await interaction.reply({
        content: `❌ เปิด DM กับบอทไม่ได้ครับ กรุณาเปิดรับ Direct Message จากสมาชิกเซิร์ฟเวอร์นี้ก่อน (ตั้งค่าความเป็นส่วนตัวของเซิร์ฟเวอร์) แล้วลองใหม่`,
        flags: 64,
      });
      return;
    }

    // เริ่ม session ใหม่ — ผูกกับห้อง DM แทนห้องที่พิมพ์คำสั่ง
    pendingUpload.set(interaction.user.id, {
      charName,
      charClass,
      discordId: interaction.user.id,
      channelId: dm.id,
      expiresAt: Date.now() + SESSION_TTL_MS,
      step:    'general',
      general: null,
      quasi:   null,
      special: null,
      notice:  null,
    });

    try {
      await dm.send(
        `📊 **Upload Stats ประจำสัปดาห์**\n` +
        `👤 **${charName}** (${charClass}) | ${getISOWeekLabel()}\n\n` +
        `**Step 1/4** — ส่งรูป 📷 **General Stats** มาเลยครับ\n` +
        `_(แนบรูปภาพใน message ถัดไปได้เลย)_`
      );
    } catch (err) {
      console.error(`[stats] dm.send failed for ${interaction.user.id}:`, err.message);
      pendingUpload.delete(interaction.user.id);
      await interaction.reply({
        content: `❌ ส่งข้อความ DM ไม่สำเร็จครับ กรุณาเปิดรับ Direct Message จากสมาชิกเซิร์ฟเวอร์นี้ก่อน แล้วลองใหม่`,
        flags: 64,
      });
      return;
    }

    await interaction.reply({
      content: `📬 เช็ค DM จากบอทได้เลยครับ! (หาไม่เจอลองดูที่ Message Requests)`,
      flags: 64,
    });
  }

});

console.log('Token exists:', !!process.env.DISCORD_TOKEN);
console.log('Token length:', process.env.DISCORD_TOKEN?.length);
client.login(process.env.DISCORD_TOKEN);
// log error จริงๆ แทนที่จะ crash เงียบๆ (ดูได้ใน flyctl logs)
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err?.stack || err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err?.stack || err));
