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
  formatMessage
};
