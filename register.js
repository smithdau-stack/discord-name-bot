require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// ชื่อ/อาชีพ แก้ที่หน้าเว็บ (ตัวละครของฉัน) — รันไฟล์นี้แล้ว /เปลี่ยนชื่อ /เปลี่ยนอาชีพ จะหายจาก Discord
const commands = [
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('อัปโหลด Stats ตัวละครประจำสัปดาห์ (ตัวละครดึงจากรายชื่อสมาชิกตาม Discord ของคุณ)'),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('กำลังลง Slash Commands...');
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );
    console.log('ลง Commands สำเร็จ!');
  } catch (err) {
    console.error(err);
  }
})();
