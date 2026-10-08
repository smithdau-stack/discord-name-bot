// ขั้นที่ 1: ดูรายชื่อคนที่ "ไม่มี" ยศที่ต้องเก็บไว้ — อ่านอย่างเดียว ไม่เตะใคร
// รัน: node prune-preview.js   (บน Fly: fly ssh console -C "node prune-preview.js")
// ต้องเปิด Server Members Intent ใน Developer Portal ก่อน
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const KEEP_ROLES = ['Admin', 'Member', 'Lost Ark God', 'BOT'];   // ชื่อยศ (ไม่สนตัวพิมพ์เล็ก/ใหญ่ และอีโมจิ/ไอคอนหน้าชื่อ)
const norm = (s) => s.replace(/[^\p{L}\p{N} ]/gu, '').trim().toLowerCase();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('clientReady', async () => {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const keep = guild.roles.cache.filter((r) => KEEP_ROLES.some((k) => norm(r.name) === norm(k)));
    const missing = KEEP_ROLES.filter((k) => !keep.some((r) => norm(r.name) === norm(k)));
    if (missing.length) console.warn(`⚠️  หายศไม่เจอ: ${missing.join(', ')} — เช็คชื่อยศอีกที`);
    console.log(`ยศที่เก็บไว้: ${keep.map((r) => r.name).join(', ')}\n`);

    const members = await guild.members.fetch();
    const out = members.filter((m) => m.id !== guild.ownerId && !m.roles.cache.some((r) => keep.has(r.id)));
    const bots = out.filter((m) => m.user.bot), people = out.filter((m) => !m.user.bot);

    const line = (m) => {
      const roles = m.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.name).join(', ') || '(ไม่มียศ)';
      const joined = m.joinedAt ? m.joinedAt.toISOString().slice(0, 10) : '?';
      return `  ${m.displayName.padEnd(24)} @${m.user.username.padEnd(22)} ${m.id}  เข้า ${joined}  ยศ: ${roles}`;
    };
    console.log(`สมาชิกทั้งหมด ${members.size} คน · จะเก็บไว้ ${members.size - out.size} · จะถูกเตะ ${out.size} (คน ${people.size}, บอท ${bots.size})\n`);
    if (bots.size) console.log(`🤖 บอทที่ไม่มียศ BOT (ใส่ยศ BOT ก่อน ไม่งั้นจะโดนเตะ):\n${bots.map(line).join('\n')}\n`);
    console.log(`👤 คนที่จะถูกเตะ:\n${people.sort((a, b) => a.displayName.localeCompare(b.displayName)).map(line).join('\n') || '  (ไม่มี)'}`);
    console.log('\nยังไม่ได้เตะใคร — ตรวจรายชื่อแล้วค่อยไปขั้นที่ 2');
  } catch (e) {
    console.error(e.code === 'DisallowedIntents' || /intent/i.test(e.message)
      ? '❌ ยังไม่ได้เปิด Server Members Intent ใน Developer Portal'
      : `❌ ${e.message}`);
  } finally {
    client.destroy();
  }
});

client.login(process.env.DISCORD_TOKEN).catch((e) => {
  console.error(/intent/i.test(e.message) ? '❌ ยังไม่ได้เปิด Server Members Intent ใน Developer Portal' : `❌ ${e.message}`);
  process.exit(1);
});
