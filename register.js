require('dotenv').config();
const { REST, Routes } = require('discord.js');

// ไม่มี slash command แล้ว (ส่ง Stats / แก้ชื่อ-อาชีพ ทำบนเว็บ Guild Hub)
// รันไฟล์นี้เพื่อล้างคำสั่งเก่าออกจากเซิร์ฟเวอร์
const commands = [];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log('ล้าง Slash Commands สำเร็จ');
  } catch (err) {
    console.error(err);
  }
})();
