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

  const borderEmoji = '━';
  const timestamp = new Date();
  const timeStr = timestamp.toLocaleString('tr-TR', { 
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  
  const uptime = Math.floor(process.uptime());
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const secs = uptime % 60;
  
  let uptimeStr = '';
  if (days > 0) uptimeStr += `${days}g `;
  if (hours > 0) uptimeStr += `${hours}s `;
  if (mins > 0) uptimeStr += `${mins}d `;
  uptimeStr += `${secs}s`;

  const embed = new EmbedBuilder()
    .setTitle(`${emoji[level]} ${title}`)
    .setColor(colorMap[level])
    .setDescription(message)
    .setTimestamp(timestamp);

  // Fields ekle
  const fields = [];

  // Seviye
  fields.push({
    name: '🎯 Seviye',
    value: `\`${level}\``,
    inline: true
  });

  // Bot info
  if (client && client.user) {
    fields.push({
      name: '🤖 Bot',
      value: `\`${client.user.tag}\``,
      inline: true
    });

    fields.push({
      name: '👥 Kullanıcılar',
      value: `\`${client.users.cache.size}\``,
      inline: true
    });
  }

  // Guild count
  if (client) {
    fields.push({
      name: '🏢 Sunucular',
      value: `\`${client.guilds.cache.size}\``,
      inline: true
    });
  }

  // Uptime
  fields.push({
    name: '⏱️ Çalışma Süresi',
    value: `\`${uptimeStr}\``,
    inline: true
  });

  // Memory
  if (true) {
    const used = process.memoryUsage();
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
    fields.push({
      name: '💾 Bellek',
      value: `\`${heapUsedMB}MB / ${heapTotalMB}MB\``,
      inline: true
    });
  }

  // Details (if provided)
  if (details) {
    fields.push({
      name: '📋 Detaylar',
      value: `\`\`\`\n${safeTruncate(details, 500)}\n\`\`\``,
      inline: false
    });
  }

  embed.addFields(...fields);

  // Footer
  const footerText = `${borderEmoji} Sistem Durumu • ${timeStr}`;
  embed.setFooter({ text: footerText, iconURL: client?.user?.displayAvatarURL() });

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
