const { EmbedBuilder } = require('discord.js');

// ═══════════════════════════════════════════════════════════════════
// 🔧 UTILITY FUNCTIONS - Temel Yardımcı Fonksiyonlar
// ═══════════════════════════════════════════════════════════════════

/**
 * Metin uzunluğunu belirtilen limit ile kesip sonuna işaret ekler
 * @param {string} str - Kısaltılacak metin
 * @param {number} max - Maksimum karakter sayısı (default: 1800)
 * @returns {string} - Kısaltılmış metin
 */
function safeTruncate(str, max = 1800) {
  if (!str) return '';
  const s = String(str);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Geçerli tarihi ve saati türkçe format ile döndürür
 * @returns {string} - Formatlanmış zaman (HH:MM:SS)
 */
function getFormattedTime() {
  return new Date().toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Geçerli tarihi ve saati tam formatla döndürür
 * @returns {string} - Tam formatlanmış zaman (DD.MM.YYYY HH:MM:SS)
 */
function getFullTimestamp() {
  return new Date().toLocaleString('tr-TR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Bot çalışma süresini insan tarafından okunabilir formata çevirir
 * @returns {string} - Formatlanmış uptime (örn: 5g 3s 45d 12s)
 */
function getFormattedUptime() {
  const uptime = Math.floor(process.uptime());
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const secs = uptime % 60;

  let result = '';
  if (days > 0) result += `${days}g `;
  if (hours > 0) result += `${hours}s `;
  if (mins > 0) result += `${mins}d `;
  result += `${secs}s`;
  return result;
}

/**
 * Bellek kullanım bilgilerini alır
 * @returns {object} - {used: MB, total: MB, percentage: %}
 */
function getMemoryInfo() {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  const percentage = Math.round((heapUsedMB / heapTotalMB) * 100);
  return { used: heapUsedMB, total: heapTotalMB, percentage };
}

/**
 * Kullanıcı veya kanal ID'sini etiketle olarak formatlar
 * @param {string} id - Discord ID
 * @param {string} type - 'user' veya 'channel' veya 'role'
 * @returns {string} - Formatlanmış etiket
 */
function formatMention(id, type = 'user') {
  if (!id) return '`[Bilinmeyen]`';
  switch (type) {
    case 'channel':
      return `<#${id}>`;
    case 'role':
      return `<@&${id}>`;
    case 'user':
    default:
      return `<@${id}>`;
  }
}

/**
 * Sayıyı yaş formatına çevirir (örn: 3 → "3 gün", 60 → "1 saat")
 * @param {number} seconds - Saniye cinsinden değer
 * @returns {string} - İnsan tarafından okunabilir format
 */
function formatDuration(seconds) {
  if (!Number.isInteger(seconds) || seconds < 0) return '0s';
  
  const units = [
    { name: 'hafta', seconds: 604800 },
    { name: 'gün', seconds: 86400 },
    { name: 'saat', seconds: 3600 },
    { name: 'dakika', seconds: 60 },
    { name: 'saniye', seconds: 1 }
  ];

  for (const unit of units) {
    const value = Math.floor(seconds / unit.seconds);
    if (value >= 1) {
      return `${value} ${unit.name}${value !== 1 ? '' : ''}`;
    }
  }
  return 'Az önce';
}

// ═══════════════════════════════════════════════════════════════════
// 📤 CHANNEL & DM FUNCTIONS - Kanal ve Özel Mesaj Gönderme
// ═══════════════════════════════════════════════════════════════════

/**
 * Belirtilen kanala mesaj gönderir
 * @param {Client} client - Discord bot client
 * @param {string} channelId - Hedef kanal ID'si
 * @param {object} payload - Gönderilecek mesaj nesnesi
 * @returns {Promise<void>}
 */
async function sendToChannel(client, channelId, payload) {
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.warn(`[LOGGER] Kanal bulunamadı veya yazı tabanlı değil: ${channelId}`);
      return;
    }
    await channel.send(payload);
  } catch (error) {
    console.error(`[LOGGER] Kanal gönderimi hatası (${channelId}):`, error.message);
  }
}

/**
 * Kullanıcıya özel mesaj gönderir
 * @param {Client} client - Discord bot client
 * @param {string} userId - Hedef kullanıcı ID'si
 * @param {object} payload - Gönderilecek mesaj nesnesi
 * @returns {Promise<void>}
 */
async function sendDM(client, userId, payload) {
  if (!userId) return;
  try {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) {
      console.warn(`[LOGGER] Kullanıcı bulunamadı: ${userId}`);
      return;
    }
    await user.send(payload);
  } catch (error) {
    console.warn(`[LOGGER] DM gönderimi başarısız (${userId}): ${error.message}`);
  }
}

/**
 * Belirtilen kanala dosya ile beraber mesaj gönderir
 * @param {Client} client - Discord bot client
 * @param {string} channelId - Hedef kanal ID'si
 * @param {string} content - Mesaj içeriği
 * @param {Attachment[]} files - Gönderilecek dosyalar
 * @returns {Promise<void>}
 */
async function sendToChannelWithFiles(client, channelId, content, files = []) {
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    await channel.send({ content, files });
  } catch (error) {
    console.error(`[LOGGER] Dosya gönderimi hatası:`, error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🎨 EMBED BUILDER FUNCTIONS - Embed İnşa Etme Fonksiyonları
// ═══════════════════════════════════════════════════════════════════

/**
 * Temel embed oluşturur
 * @param {string} title - Başlık
 * @param {number} color - Hex renk kodu (default: 0x2b2d31)
 * @returns {EmbedBuilder} - Hazırlanmış embed
 */
function baseEmbed(title, color = 0x2b2d31) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp(Date.now());
}

/**
 * Başarı/hata durum göstergesi ile embed oluşturur
 * @param {string} title - Başlık
 * @param {boolean} success - Başarı durumu
 * @returns {EmbedBuilder} - Hazırlanmış embed
 */
function statusEmbed(title, success = true) {
  const color = success ? 0x57f287 : 0xed4245;
  const emoji = success ? '✅' : '❌';
  return baseEmbed(`${emoji} ${title}`, color);
}

/**
 * Uyarı/dikkat durumu ile embed oluşturur
 * @param {string} title - Başlık
 * @param {string} message - Mesaj
 * @returns {EmbedBuilder} - Hazırlanmış embed
 */
function warningEmbed(title, message = '') {
  const embed = baseEmbed(`⚠️ ${title}`, 0xffa500);
  if (message) embed.setDescription(message);
  return embed;
}

/**
 * Hata durumu ile embed oluşturur
 * @param {string} title - Başlık
 * @param {string} message - Hata mesajı
 * @returns {EmbedBuilder} - Hazırlanmış embed
 */
function errorEmbed(title, message = '') {
  const embed = baseEmbed(`❌ ${title}`, 0xff0000);
  if (message) embed.setDescription(message);
  return embed;
}

/**
 * Bilgi durumu ile embed oluşturur
 * @param {string} title - Başlık
 * @param {string} message - Bilgi mesajı
 * @returns {EmbedBuilder} - Hazırlanmış embed
 */
function infoEmbed(title, message = '') {
  const embed = baseEmbed(`ℹ️ ${title}`, 0x5865f2);
  if (message) embed.setDescription(message);
  return embed;
}

// Havalı text format (embed yerine)
function formatMessage(emoji, title, details) {
  const time = getFormattedTime();
  const lines = [
    `${emoji} **${title}**`,
    details,
    `• ${time}`
  ].filter(Boolean);
  
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════
// 👤 MEMBER ACTIVITY LOGGING - Üye Aktivitesi Günlüğü
// ═══════════════════════════════════════════════════════════════════

/**
 * Üye aktivitesini ayrıntılı şekilde kaydeder
 * @param {object} options - Kayıt parametreleri
 * @param {Client} options.client - Discord bot client
 * @param {object} options.cfg - Bot konfigürasyonu
 * @param {User} options.user - İşlem gerçekleştiren üye
 * @param {string} options.action - Gerçekleştirilen işlem
 * @param {string} options.details - İşlem detayları
 * @param {boolean} options.critical - Kritik işlem mi? (default: false)
 * @returns {Promise<void>}
 */
async function logMemberActivity({ 
  client, 
  cfg, 
  user, 
  action, 
  details = '', 
  critical = false 
}) {
  try {
    const color = critical ? 0xff0000 : 0x5865f2;
    const emoji = critical ? '⚠️' : '👤';
    
    const embed = baseEmbed(`${emoji} ÜYE AKTİVİTESİ`, color)
      .setDescription(
        `👤 **Üye:** ${user} (\`${user.id}\`)\n` +
        `📋 **İşlem:** \`${action}\`\n` +
        `${details ? `📝 **Detaylar:** ${safeTruncate(details, 500)}\n` : ''}` +
        `⏰ **Zaman:** \`${getFullTimestamp()}\`\n` +
        `${critical ? `🚨 **Durum:** KRİTİK\n` : ''}`
      )
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        {
          name: '📊 Hesap Bilgisi',
          value: `Oluşturulma: \`${new Date(user.createdTimestamp).toLocaleDateString('tr-TR')}\``,
          inline: false
        }
      );

    await sendToChannel(client, cfg.logChannels?.memberActivity, { embeds: [embed] });
  } catch (error) {
    console.error('[MEMBER_ACTIVITY_LOG] Hata:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🤖 BOT INTERNAL LOGGING - Bot İç Sistem Günlükleri
// ═══════════════════════════════════════════════════════════════════

/**
 * Bot iç işlemlerini ayrıntılı şekilde kaydeder
 * @param {object} options - Kayıt parametreleri
 * @param {Client} options.client - Discord bot client
 * @param {object} options.cfg - Bot konfigürasyonu
 * @param {string} options.level - Log seviyesi (INFO, WARN, ERROR, SUCCESS)
 * @param {string} options.title - Başlık
 * @param {string} options.message - Ana mesaj
 * @param {string} options.details - Ek detaylar
 * @param {object} options.data - İlave veri nesnesi
 * @returns {Promise<void>}
 */
async function logBotInternal({ 
  client, 
  cfg, 
  level = 'INFO', 
  title, 
  message, 
  details = '',
  data = {}
}) {
  try {
    const colorMap = {
      'INFO': 0x5865f2,
      'WARN': 0xffa500,
      'ERROR': 0xff0000,
      'SUCCESS': 0x57f287,
      'DEBUG': 0x808080
    };

    const emojiMap = {
      'INFO': 'ℹ️',
      'WARN': '⚠️',
      'ERROR': '❌',
      'SUCCESS': '✅',
      'DEBUG': '🔍'
    };

    const color = colorMap[level] || 0x2b2d31;
    const emoji = emojiMap[level] || 'ℹ️';

    const embed = new EmbedBuilder()
      .setTitle(`${emoji} ${title}`)
      .setColor(color)
      .setDescription(safeTruncate(message, 2000))
      .setTimestamp(Date.now());

    // ===== FIELDS =====
    const fields = [];

    // Seviye ve Zaman
    fields.push({
      name: '🎯 Seviye',
      value: `\`${level}\``,
      inline: true
    });

    fields.push({
      name: '⏰ Zaman',
      value: `\`${getFormattedTime()}\``,
      inline: true
    });

    // Bot Bilgisi
    if (client?.user) {
      fields.push({
        name: '🤖 Bot',
        value: `\`${client.user.tag}\``,
        inline: true
      });

      fields.push({
        name: '👥 Toplam Kullanıcı',
        value: `\`${client.users.cache.size.toLocaleString('tr-TR')}\``,
        inline: true
      });
    }

    // Sunucu Sayısı
    if (client) {
      fields.push({
        name: '🏢 Aktif Sunucular',
        value: `\`${client.guilds.cache.size}\``,
        inline: true
      });
    }

    // Çalışma Süresi
    fields.push({
      name: '⏱️ Çalışma Süresi',
      value: `\`${getFormattedUptime()}\``,
      inline: true
    });

    // Bellek Kullanımı
    const memory = getMemoryInfo();
    fields.push({
      name: '💾 Bellek',
      value: `\`${memory.used}MB / ${memory.total}MB (${memory.percentage}%)\``,
      inline: true
    });

    // CPU/İşlem Bilgisi
    if (process.cpuUsage) {
      const cpu = process.cpuUsage();
      const userCPU = (cpu.user / 1000000).toFixed(2);
      fields.push({
        name: '⚙️ CPU Zamanı',
        value: `\`${userCPU}s\``,
        inline: true
      });
    }

    // Detaylar
    if (details) {
      fields.push({
        name: '📋 Detaylar',
        value: `\`\`\`\n${safeTruncate(details, 500)}\n\`\`\``,
        inline: false
      });
    }

    // İlave Veri
    if (Object.keys(data).length > 0) {
      const dataStr = Object.entries(data)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
      fields.push({
        name: '📊 Ek Veriler',
        value: `\`\`\`\n${safeTruncate(dataStr, 500)}\n\`\`\``,
        inline: false
      });
    }

    embed.addFields(...fields);

    // Footer
    embed.setFooter({ 
      text: `━ Sistem Durumu • ${getFullTimestamp()}`,
      iconURL: client?.user?.displayAvatarURL()
    });

    await sendToChannel(client, cfg.logChannels?.botInternal, { embeds: [embed] });
  } catch (error) {
    console.error('[BOT_INTERNAL_LOG] Hata:', error.message);
  }
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

// ═══════════════════════════════════════════════════════════════════
// 📋 COMMAND USAGE LOGGING - Komut Kullanım Günlükleri
// ═══════════════════════════════════════════════════════════════════

/**
 * Komut kullanımını detaylı şekilde kaydeder
 * @param {object} options - Kayıt parametreleri
 * @param {Client} options.client - Discord bot client
 * @param {object} options.cfg - Bot konfigürasyonu
 * @param {GuildMember} options.member - Komutu çalıştıran üye
 * @param {string} options.command - Komut adı
 * @param {string[]} options.args - Komut argümanları
 * @param {boolean} options.success - Başarı durumu
 * @param {string} options.error - Hata mesajı (hata varsa)
 * @param {string} options.duration - Komut çalışma süresi
 * @returns {Promise<void>}
 */
async function logCommandUsageDetailed({ 
  client, 
  cfg, 
  member, 
  command, 
  args = [], 
  success = true, 
  error = null,
  duration = '0ms'
}) {
  try {
    const statusEmoji = success ? '✅' : '❌';
    const statusColor = success ? 0x57f287 : 0xff0000;

    const embed = baseEmbed(`${statusEmoji} KOMUT ÇALIŞTIRMA`, statusColor)
      .setDescription(
        `👤 **Kullanıcı:** ${member} (\`${member.id}\`)\n` +
        `📝 **Komut:** \`${command}\`\n` +
        `${args.length > 0 ? `📋 **Parametreler:** \`${args.join(' ')}\`\n` : 'Parametre yok\n'}` +
        `⏱️ **Çalışma Süresi:** \`${duration}\`\n` +
        `⏰ **Zaman:** \`${getFormattedTime()}\`\n` +
        `${!success && error ? `🚨 **Hata Mesajı:** ${safeTruncate(error, 500)}\n` : ''}`
      )
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .addFields(
        {
          name: '📊 Durum Detayları',
          value: `Başarılı: ${success ? '✅ Evet' : '❌ Hayır'}\nRol: ${member.roles.highest.name}`,
          inline: true
        }
      );

    await sendToChannel(client, cfg.logChannels?.botInternal, { embeds: [embed] });
  } catch (error) {
    console.error('[COMMAND_USAGE_LOG] Hata:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🛡️ SECURITY LOGGING - Güvenlik Olayları Günlüğü
// ═══════════════════════════════════════════════════════════════════

/**
 * Güvenlik olaylarını kaydeder
 * @param {object} options - Kayıt parametreleri
 * @param {Client} options.client - Discord bot client
 * @param {object} options.cfg - Bot konfigürasyonu
 * @param {string} options.type - Güvenlik olayı türü
 * @param {User|GuildMember} options.actor - İşlemi gerçekleştiren kişi
 * @param {User|GuildMember} options.target - Hedef kişi (varsa)
 * @param {string} options.reason - Olay sebebi
 * @param {string} options.details - Ayrıntılı bilgi
 * @param {number} options.severity - Tehdit seviyesi (1-3: düşük, 4-6: orta, 7-10: yüksek)
 * @returns {Promise<void>}
 */
async function logSecurityEvent({
  client,
  cfg,
  type,
  actor,
  target = null,
  reason = '',
  details = '',
  severity = 5
}) {
  try {
    let color = 0xff0000;
    let emoji = '🚨';
    
    if (severity <= 3) {
      color = 0xffa500;
      emoji = '⚠️';
    } else if (severity <= 6) {
      color = 0xff6b6b;
      emoji = '⛔';
    }

    const severityLabel = severity <= 3 ? 'DÜŞÜK' : severity <= 6 ? 'ORTA' : 'YÜKSEK';
    const actorTag = actor?.user?.tag || actor?.tag || actor?.toString() || 'Bilinmeyen';

    const embed = baseEmbed(`${emoji} GÜVENLİK OLAYI - ${type.toUpperCase()}`, color)
      .setDescription(
        `🚨 **Olay Tipi:** \`${type}\`\n` +
        `👤 **İşlemi Yapan:** ${actor} (\`${actor?.id || 'N/A'}\`)\n` +
        `${target ? `🎯 **Hedef:** ${target} (\`${target?.id || 'N/A'}\`)\n` : ''}` +
        `📌 **Sebep:** ${reason || 'Belirtilmedi'}\n` +
        `📊 **Tehdit Seviyesi:** \`${severityLabel}\` [${severity}/10]\n` +
        `⏰ **Zaman:** \`${getFullTimestamp()}\`\n` +
        `${details ? `📋 **Detaylar:** ${safeTruncate(details, 500)}\n` : ''}`
      );

    if (severity >= 7) {
      embed.setColor(0xff0000);
      embed.addFields({
        name: '🚨 UYARI',
        value: '`YÜKSEK TİP GÜVENLİK OLAYIDIR - HEMEN İNCELENMELİDİR`',
        inline: false
      });
    }

    await sendToChannel(client, cfg.logChannels?.guard, { embeds: [embed] });
  } catch (error) {
    console.error('[SECURITY_LOG] Hata:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📢 MODERATION LOGGING - Moderasyon İşlemleri Günlüğü
// ═══════════════════════════════════════════════════════════════════

/**
 * Moderasyon işlemlerini kaydeder (warn, mute, kick, ban vb.)
 * @param {object} options - Kayıt parametreleri
 * @param {Client} options.client - Discord bot client
 * @param {object} options.cfg - Bot konfigürasyonu
 * @param {string} options.action - İşlem türü (warn, mute, kick, ban, timeout)
 * @param {GuildMember} options.moderator - İşlemi yapan moderatör
 * @param {User|GuildMember} options.target - Hedef kullanıcı
 * @param {string} options.reason - İşlem sebebi
 * @param {string} options.duration - İşlem süresi (timeout/ban için)
 * @param {number} options.caseNumber - Olay numarası
 * @returns {Promise<void>}
 */
async function logModerationAction({
  client,
  cfg,
  action,
  moderator,
  target,
  reason = 'Sebep belirtilmedi',
  duration = null,
  caseNumber = null
}) {
  try {
    const actionMap = {
      'warn': { emoji: '⚠️', label: 'İKAZ', color: 0xffa500 },
      'mute': { emoji: '🔇', label: 'SESSIZ KILIDI', color: 0xff9900 },
      'unmute': { emoji: '🔊', label: 'SESSIZ KILİDİ KALDIRMA', color: 0x57f287 },
      'kick': { emoji: '👢', label: 'ATMA', color: 0xffa500 },
      'ban': { emoji: '🚫', label: 'YASAKLAMA', color: 0xff0000 },
      'unban': { emoji: '✅', label: 'YASAKLAMA KALDIRMA', color: 0x57f287 },
      'timeout': { emoji: '⏱️', label: 'ZAMAN AŞIMI', color: 0xff9900 },
      'role_add': { emoji: '➕', label: 'ROL EKLEME', color: 0x57f287 },
      'role_remove': { emoji: '➖', label: 'ROL ÇIKARTMA', color: 0xff0000 }
    };

    const actionInfo = actionMap[action.toLowerCase()] || { emoji: '❓', label: action.toUpperCase(), color: 0x2b2d31 };

    const targetUser = target.user || target;
    const moderatorName = moderator.user?.tag || moderator.tag || moderator.toString();

    const description = 
      `${actionInfo.emoji} **İşlem:** \`${actionInfo.label}\`\n` +
      `👤 **Hedef Kullanıcı:** ${target} (\`${targetUser.id}\`)\n` +
      `⚙️ **Moderatör:** ${moderator} (\`${moderator.id || moderator.user?.id}\`)\n` +
      `📝 **Sebep:** ${safeTruncate(reason, 300)}\n` +
      `${duration ? `⏰ **Süre:** \`${duration}\`\n` : ''}` +
      `${caseNumber ? `🔢 **Olay #:** \`${caseNumber}\`\n` : ''}` +
      `📅 **Zaman:** \`${getFullTimestamp()}\``;

    const embed = baseEmbed(`${actionInfo.emoji} MODERASYoN İŞLEMİ`, actionInfo.color)
      .setDescription(description)
      .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
      .addFields({
        name: '👤 Hedef Bilgisi',
        value: `Hesap Yaşı: \`${formatDuration(Date.now() - targetUser.createdTimestamp)}\``,
        inline: true
      });

    await sendToChannel(client, cfg.logChannels?.general, { embeds: [embed] });
  } catch (error) {
    console.error('[MODERATION_LOG] Hata:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🔄 AUDIT LOGGING - Denetim Günlükleri
// ═══════════════════════════════════════════════════════════════════

/**
 * Sunucu ayarlarındaki değişiklikleri kaydeder
 * @param {object} options - Kayıt parametreleri
 * @param {Client} options.client - Discord bot client
 * @param {object} options.cfg - Bot konfigürasyonu
 * @param {string} options.type - Değişiklik türü
 * @param {string} options.before - Önceki değer
 * @param {string} options.after - Sonraki değer
 * @param {User} options.executor - İşlemi yapan kişi
 * @param {string} options.target - Hedef (kanal, rol vb.)
 * @returns {Promise<void>}
 */
async function logAuditEvent({
  client,
  cfg,
  type,
  before = null,
  after = null,
  executor = null,
  target = null
}) {
  try {
    const embed = baseEmbed(`🔍 DENETİM OLAYSI - ${type.toUpperCase()}`, 0x5865f2)
      .setDescription(
        `📝 **Olay Tipi:** \`${type}\`\n` +
        `${executor ? `⚙️ **Uygulayan:** ${executor} (\`${executor.id}\`)\n` : ''}` +
        `${target ? `🎯 **Hedef:** \`${target}\`\n` : ''}` +
        `📅 **Zaman:** \`${getFullTimestamp()}\``
      );

    if (before !== null || after !== null) {
      embed.addFields({
        name: '📊 Değişiklik Detayları',
        value: 
          `**Önceki Değer:**\n\`\`\`\n${safeTruncate(String(before), 300)}\n\`\`\`\n` +
          `**Yeni Değer:**\n\`\`\`\n${safeTruncate(String(after), 300)}\n\`\`\``,
        inline: false
      });
    }

    await sendToChannel(client, cfg.logChannels?.botInternal, { embeds: [embed] });
  } catch (error) {
    console.error('[AUDIT_LOG] Hata:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🚨 ERROR LOGGING - Hata Günlükleri
// ═══════════════════════════════════════════════════════════════════

/**
 * Hataları ayrıntılı şekilde kaydeder
 * @param {object} options - Kayıt parametreleri
 * @param {Client} options.client - Discord bot client
 * @param {object} options.cfg - Bot konfigürasyonu
 * @param {Error} options.error - Hata nesnesi
 * @param {string} options.context - Hatanın oluştuğu bağlam
 * @param {string} options.userId - Hatayla ilgili kullanıcı ID'si
 * @param {object} options.additionalData - İlave veriler
 * @returns {Promise<void>}
 */
async function logError({
  client,
  cfg,
  error,
  context = 'Bilinmeyen',
  userId = null,
  additionalData = {}
}) {
  try {
    const errorName = error?.name || 'Bilinmeyen Hata';
    const errorMessage = error?.message || String(error);
    const errorStack = error?.stack?.split('\n').slice(0, 5).join('\n') || 'Stack bulunamadı';

    const embed = errorEmbed(
      `HATA - ${errorName}`,
      `**Bağlam:** \`${context}\`\n` +
      `**Mesaj:** ${safeTruncate(errorMessage, 300)}`
    ).addFields(
      {
        name: '📍 Konum',
        value: `\`\`\`${safeTruncate(errorStack, 500)}\`\`\``,
        inline: false
      },
      {
        name: '📊 Sistem Bilgisi',
        value: 
          `**Çalışma Süresi:** \`${getFormattedUptime()}\`\n` +
          `**Bellek:** \`${getMemoryInfo().used}MB\`\n` +
          `**Zaman:** \`${getFullTimestamp()}\`` +
          `${userId ? `\n**Kullanıcı:** \`${userId}\`` : ''}`,
        inline: false
      }
    );

    if (Object.keys(additionalData).length > 0) {
      const dataStr = Object.entries(additionalData)
        .map(([k, v]) => `${k}: ${safeTruncate(String(v), 100)}`)
        .join('\n');
      embed.addFields({
        name: '📋 İlave Veriler',
        value: `\`\`\`\n${dataStr}\n\`\`\``,
        inline: false
      });
    }

    await sendToChannel(client, cfg.logChannels?.botInternal, { embeds: [embed] });
  } catch (err) {
    console.error('[ERROR_LOG] Hata kaydı başarısız:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📊 STATISTICS LOGGING - İstatistik Günlükleri
// ═══════════════════════════════════════════════════════════════════

/**
 * Bot istatistiklerini günlüklere kaydeder
 * @param {object} options - Kayıt parametreleri
 * @param {Client} options.client - Discord bot client
 * @param {object} options.cfg - Bot konfigürasyonu
 * @param {object} options.stats - İstatistikler nesnesi
 * @returns {Promise<void>}
 */
async function logStatistics({
  client,
  cfg,
  stats = {}
}) {
  try {
    const memory = getMemoryInfo();
    
    const embed = baseEmbed('📊 BOT İSTATİSTİKLERİ', 0x5865f2)
      .setDescription(`📈 Anlık bot performans ve kullanım verileri`)
      .addFields(
        {
          name: '👥 Kullanıcı İstatistikleri',
          value: 
            `Toplam Kullanıcı: \`${client.users.cache.size}\`\n` +
            `Sunucu Sayısı: \`${client.guilds.cache.size}\`\n` +
            `Toplam Üye: \`${client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)}\``,
          inline: true
        },
        {
          name: '⚙️ Sistem Performansı',
          value: 
            `Çalışma Süresi: \`${getFormattedUptime()}\`\n` +
            `Bellek: \`${memory.used}MB / ${memory.total}MB\`\n` +
            `Bellek Kullanımı: \`${memory.percentage}%\``,
          inline: true
        }
      );

    if (Object.keys(stats).length > 0) {
      const statsStr = Object.entries(stats)
        .map(([k, v]) => `${k}: \`${v}\``)
        .join('\n');
      embed.addFields({
        name: '📋 Özel İstatistikler',
        value: statsStr,
        inline: false
      });
    }

    embed.setFooter({
      text: `━ Güncelleme Zamanı: ${getFullTimestamp()}`,
      iconURL: client.user?.displayAvatarURL()
    });

    await sendToChannel(client, cfg.logChannels?.botInternal, { embeds: [embed] });
  } catch (error) {
    console.error('[STATISTICS_LOG] Hata:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📤 EXPORTS
// ═══════════════════════════════════════════════════════════════════

module.exports = {
  // Utility Functions
  safeTruncate,
  getFormattedTime,
  getFullTimestamp,
  getFormattedUptime,
  getMemoryInfo,
  formatMention,
  formatDuration,

  // Channel & DM Functions
  sendToChannel,
  sendDM,
  sendToChannelWithFiles,

  // Embed Builders
  baseEmbed,
  statusEmbed,
  warningEmbed,
  errorEmbed,
  infoEmbed,
  formatMessage,

  // Logging Functions
  logMemberActivity,
  logBotInternal,
  logCommandUsage,
  logCommandUsageDetailed,
  logSecurityEvent,
  logModerationAction,
  logAuditEvent,
  logError,
  logStatistics
};
