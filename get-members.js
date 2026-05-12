require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ]
});

client.once('clientReady', async () => {
  console.log('กำลังดึงข้อมูลสมาชิก...');

  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const members = await guild.members.fetch();

  // กรองเฉพาะคนที่มี Role "Member"
  const memberOnly = members.filter(m => 
    !m.user.bot && m.roles.cache.some(r => r.name === 'Member')
  );

  let csv = 'Nickname,Discord ID\n';

  memberOnly.forEach(member => {
    const nickname = member.nickname || member.user.displayName || member.user.username;
    csv += `"${nickname}",${member.user.id}\n`;
  });

  fs.writeFileSync('members.csv', '\ufeff' + csv, 'utf8');

  console.log(`เสร็จแล้ว! รวม ${memberOnly.size} คน`);
  console.log('ดูไฟล์ members.csv ใน Folder ได้เลยครับ');
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);