const { EmbedBuilder } = require('discord.js');

function safeTruncate(str, max = 1800) {
  if (!str) return '';
  const s = String(str);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function sendToChannel(client, channelId, payload) {
  if (!channelId) return;
  try {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || !ch.isTextBased()) return;
    await ch.send(payload);
  } catch {
    // sessiz geç
  }
}

async function sendDM(client, userId, payload) {
  if (!userId) return;
  try {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return;
    await user.send(payload);
  } catch {
    // Kullanıcının DM'i kapalı olabilir; sessiz geç
  }
}

function baseEmbed(title, color = 0x2b2d31) {
  return new EmbedBuilder().setTitle(title).setColor(color).setTimestamp(Date.now());
}

// Havalı text format (embed yerine)
function formatMessage(emoji, title, details) {
  const time = new Date().toLocaleTimeString('tr-TR');
  const lines = [
    `${emoji} **${title}**`,
    details,
    `• ${time}`
  ].filter(Boolean);
  
  return lines.join('\n');
}

module.exports = {
  safeTruncate,
  sendToChannel,
  sendDM,
  baseEmbed,
  formatMessage,
  logMemberActivity,
  logBotInternal,
  logCommandUsage
};

// Advanced Logging Functions

function logMemberActivity({ client, cfg, user, action, details = '' }) {
  const embed = baseEmbed('📊 MEMBER ACTIVITY', 0x5865f2)
    .setDescription(
      `👤 **Üye:** ${user}\n` +
      `📋 **İşlem:** ${action}\n` +
      `${details ? `📝 **Detay:** ${details}\n` : ''}` +
      `⏰ **Zaman:** ${new Date().toLocaleTimeString('tr-TR')}`
    )
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setColor(0x5865f2);

  sendToChannel(client, cfg.logChannels.memberActivity, { embeds: [embed] }).catch(() => {});
}

function logBotInternal({ client, cfg, level = 'INFO', title, message, details = '' }) {
  const colorMap = {
    'INFO': 0x5865f2,
    'WARN': 0xffa500,
    'ERROR': 0xff0000,
    'SUCCESS': 0x00ff00
  };

  const emoji = {
    'INFO': 'ℹ️',
    'WARN': '⚠️',
    'ERROR': '❌',
    'SUCCESS': '✅'
  };

  const embed = baseEmbed(`${emoji[level]} ${title}`, colorMap[level])
    .setDescription(
      `📌 **Seviye:** ${level}\n` +
      `📝 **Mesaj:** ${message}\n` +
      `${details ? `📋 **Detay:** ${safeTruncate(details, 500)}\n` : ''}` +
      `⏰ **Zaman:** ${new Date().toLocaleTimeString('tr-TR')}`
    )
    .setColor(colorMap[level]);

  sendToChannel(client, cfg.logChannels.botInternal, { embeds: [embed] }).catch(() => {});
}

function logCommandUsage({ client, cfg, member, command, args, success = true, error = null }) {
  const statusEmoji = success ? '✅' : '❌';
  const statusColor = success ? 0x00ff00 : 0xff0000;

  const embed = baseEmbed(`${statusEmoji} COMMAND EXECUTED`, statusColor)
    .setDescription(
      `👤 **Üye:** ${member}\n` +
      `📝 **Komut:** \`${command}\`\n` +
      `${args.length > 0 ? `📋 **Args:** \`${args.join(' ')}\`\n` : ''}` +
      `${error ? `⚠️ **Hata:** ${error}\n` : ''}` +
      `⏰ **Zaman:** ${new Date().toLocaleTimeString('tr-TR')}`
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setColor(statusColor);

  sendToChannel(client, cfg.logChannels.botInternal, { embeds: [embed] }).catch(() => {});
}
