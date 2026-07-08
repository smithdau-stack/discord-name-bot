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
const { appendToSheet, getMembers } = require('./sheets');

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
  { label: 'Rebellion',        value: 'rebellion'        },  
  { label: 'Doram',          value: 'doram'          },
];

const pendingClassChange = new Map();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once('clientReady', () => {
  console.log(`Bot พร้อมแล้ว: ${client.user.tag}`);
});

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

  // ── /เปลี่ยนชื่อ → รับชื่อเก่าจาก Autocomplete แล้วเปิด Modal กรอกชื่อใหม่ ──
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

  // ── /เปลี่ยนอาชีพ → รับชื่อจาก Autocomplete แล้ว Dropdown เลือกอาชีพใหม่ ──
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

});
console.log('Token exists:', !!process.env.DISCORD_TOKEN);
console.log('Token length:', process.env.DISCORD_TOKEN?.length);
client.login(process.env.DISCORD_TOKEN);