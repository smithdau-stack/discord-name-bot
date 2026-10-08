// ขั้นที่ 2: เตะคนที่ไม่มียศที่ต้องเก็บไว้ (ใช้เกณฑ์เดียวกับ prune-preview.js)
// กันพลาด: ต้องใส่จำนวนคนให้ตรงกับที่ preview บอก
//   node prune-kick.js --confirm 22
// ข้ามบอททุกตัวและเจ้าของเซิร์ฟเวอร์เสมอ
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const KEEP_ROLES = ['Admin', 'Member', 'Lost Ark God', 'BOT'];
const REASON = 'Server cleanup: no Admin / Member / Lost Ark God / BOT role';
const norm = (s) => s.replace(/[^\p{L}\p{N} ]/gu, '').trim().toLowerCase();
const i = process.argv.indexOf('--confirm');
const expected = i > 0 ? Number(process.argv[i + 1]) : NaN;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

client.once('clientReady', async () => {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const keep = guild.roles.cache.filter((r) => KEEP_ROLES.some((k) => norm(r.name) === norm(k)));
    if (keep.size !== KEEP_ROLES.length) throw new Error(`หายศไม่ครบ (เจอ ${keep.map((r) => r.name).join(', ')}) — หยุดเพื่อความปลอดภัย`);

    const members = await guild.members.fetch();
    const targets = members.filter((m) => m.id !== guild.ownerId && !m.user.bot && !m.roles.cache.some((r) => keep.has(r.id)));
    if (!Number.isFinite(expected)) {
      console.log(`จะเตะ ${targets.size} คน — ถ้าตรงกับที่ตรวจไว้ รัน: node prune-kick.js --confirm ${targets.size}`);
      return;
    }
    if (expected !== targets.size) throw new Error(`จำนวนไม่ตรง (ตอนนี้ ${targets.size} คน แต่ใส่ ${expected}) — มีคนเข้า/ออกหรือเปลี่ยนยศ ให้รัน preview ใหม่`);

    let ok = 0; const fail = [];
    for (const m of targets.values()) {
      if (!m.kickable) { fail.push(`${m.displayName} (ยศสูงกว่าบอท)`); continue; }
      try { await m.kick(REASON); ok++; console.log(`✓ ${m.displayName}`); }
      catch (e) { fail.push(`${m.displayName} (${e.message})`); }
      await sleep(1200);   // กัน rate limit
    }
    console.log(`\nเตะแล้ว ${ok}/${targets.size} คน`);
    if (fail.length) console.log(`ไม่สำเร็จ ${fail.length}:\n  ${fail.join('\n  ')}`);
  } catch (e) {
    console.error(`❌ ${e.message}`);
  } finally {
    client.destroy();
  }
});

client.login(process.env.DISCORD_TOKEN);
