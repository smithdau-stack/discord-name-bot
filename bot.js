require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');
const { appendToSheet, getMembers, writeStatsToSheet, getUnnotifiedReviews, markNotified } = require('./sheets');
const { analyzeImage } = require('./vision');

const CLASS_LIST = [
  { label: 'Champion',       value: 'champion'       },
  { label: 'High Priest',    value: 'high_priest'    },
  { label: 'Sniper',         value: 'sniper'         },
  { label: 'High Wizard',    value: 'high_wizard'    },
  { label: 'Lord Knight',    value: 'lord_knight'    },
  { label: 'Assassin Cross', value: 'assassin_cross' },
  { label: 'Paladin',        value: 'paladin'        },
  { label: 'Mastersmith',    value: 'mastersmith'    },
  { label: 'Biochemist',     value: 'biochemist'     },
  { label: 'Minstrel',       value: 'minstrel'       },
  { label: 'Gypsy',          value: 'gypsy'          },
  { label: 'Professor',      value: 'professor'      },
  { label: 'Stalker',        value: 'stalker'        },
  { label: 'Rebellion',      value: 'rebellion'      },
  { label: 'Doram',          value: 'doram'          },
];

const pendingClassChange = new Map();
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
  ]
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

  // ── Autocomplete ──
  if (interaction.isAutocomplete()) {
    const members = await getMembers();
    const typed   = interaction.options.getFocused().toLowerCase();

    const filtered = members
      .filter(m => m.name.toLowerCase().includes(typed))
      .slice(0, 25)
      .map(m => ({
        name:  `${m.name} (${m.currentClass})`,
        value: m.name,
      }));

    await interaction.respond(filtered);
    return;
  }

  // ── /เปลี่ยนชื่อ ──
  if (interaction.isChatInputCommand() && interaction.commandName === 'เปลี่ยนชื่อ') {
    const oldName = interaction.options.getString('ชื่อเก่า');

    const modal = new ModalBuilder()
      .setCustomId(`modal_new_name__${oldName}`)
      .setTitle('📝 เปลี่ยนชื่อในเกม');

    const newInput = new TextInputBuilder()
      .setCustomId('new_name')
      .setLabel(`ชื่อใหม่  (เก่า: ${oldName})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('กรอกชื่อใหม่ที่ต้องการ')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(newInput));
    await interaction.showModal(modal);
  }

  // Modal Submit เปลี่ยนชื่อ
  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_new_name__')) {
    const oldName   = interaction.customId.replace('modal_new_name__', '');
    const newName   = interaction.fields.getTextInputValue('new_name');
    const discordId = interaction.user.id;
    const username  = interaction.user.username;
    const timestamp = new Date().toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

    await appendToSheet([
      timestamp, discordId, username,
      'ชื่อ', oldName, newName
    ]);

    await interaction.reply({
      content:
        `✅ **บันทึกแล้ว!**\n` +
        `👤 ${username}\n` +
        `📝 **ชื่อ:** \`${oldName}\` → \`${newName}\``,
    });
  }

  // ── /เปลี่ยนอาชีพ ──
  if (interaction.isChatInputCommand() && interaction.commandName === 'เปลี่ยนอาชีพ') {
    const charName = interaction.options.getString('ชื่อตัวละคร');

    const members      = await getMembers();
    const charData     = members.find(m => m.name === charName);
    const currentClass = charData?.currentClass || 'ไม่ระบุ';

    pendingClassChange.set(interaction.user.id, { charName, oldClass: currentClass });

    const selectNewClass = new StringSelectMenuBuilder()
      .setCustomId('select_new_class')
      .setPlaceholder('เลือกอาชีพใหม่ที่ต้องการ')
      .addOptions(
        CLASS_LIST
          .filter(c => c.label !== currentClass)
          .map(c =>
            new StringSelectMenuOptionBuilder()
              .setLabel(c.label)
              .setValue(c.value)
          )
      );

    await interaction.reply({
      content:
        `**ตัวละคร:** ${charName}\n` +
        `**อาชีพปัจจุบัน:** ${currentClass}\n` +
        `ต้องการเปลี่ยนเป็นอาชีพอะไร?`,
      components: [new ActionRowBuilder().addComponents(selectNewClass)],
      flags: 64,
    });
  }

  // เลือกอาชีพใหม่แล้ว → บันทึก
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_new_class') {
    const newClassValue = interaction.values[0];
    const newLabel      = CLASS_LIST.find(c => c.value === newClassValue).label;
    const pending       = pendingClassChange.get(interaction.user.id);
    const charName      = pending?.charName || 'ไม่ทราบ';
    const oldClass      = pending?.oldClass || 'ไม่ทราบ';
    const discordId     = interaction.user.id;
    const username      = interaction.user.username;
    const timestamp     = new Date().toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

    pendingClassChange.delete(interaction.user.id);

    await appendToSheet([
      timestamp, discordId, username,
      'อาชีพ', `${charName} (${oldClass})`, `${charName} (${newLabel})`
    ]);

    await interaction.update({
      content:
        `✅ **บันทึกแล้ว!**\n` +
        `👤 ${username} — ตัวละคร: **${charName}**\n` +
        `⚔️ **อาชีพ:** \`${oldClass}\` → \`${newLabel}\``,
      components: [],
    });
  }

  // ── /upload-stats ──
  if (interaction.isChatInputCommand() && interaction.commandName === 'stats') {
    const charName  = interaction.options.getString('ชื่อตัวละคร');
    const members   = await getMembers();
    const charData  = members.find(m => m.name === charName);
    const charClass = charData?.currentClass || 'ไม่ระบุ';

    // เริ่ม session ใหม่
    pendingUpload.set(interaction.user.id, {
      charName,
      charClass,
      discordId: interaction.user.id,
      channelId: interaction.channelId,
      expiresAt: Date.now() + SESSION_TTL_MS,
      step:    'general',
      general: null,
      quasi:   null,
      special: null,
      notice:  null,
    });

    await interaction.reply({
      content:
        `📊 **Upload Stats ประจำสัปดาห์**\n` +
        `👤 **${charName}** (${charClass}) | ${getISOWeekLabel()}\n\n` +
        `**Step 1/4** — ส่งรูป 📷 **General Stats** มาเลยครับ\n` +
        `_(แนบรูปภาพใน message ถัดไปได้เลย)_`,
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
