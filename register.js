require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('เปลี่ยนชื่อ')
    .setDescription('แจ้งเปลี่ยนชื่อตัวละครในเกม')
    .addStringOption(option =>
      option
        .setName('ชื่อเก่า')
        .setDescription('ชื่อตัวละครปัจจุบัน')
        .setRequired(true)
        .setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName('เปลี่ยนอาชีพ')
    .setDescription('แจ้งเปลี่ยนอาชีพตัวละครในเกม')
    .addStringOption(option =>
      option
        .setName('ชื่อตัวละคร')
        .setDescription('ชื่อตัวละครของคุณ')
        .setRequired(true)
        .setAutocomplete(true)
    ),
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