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
 * Üye aktivitesini kaydeder
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
    const emoji = critical ? '🚨' : '👤';
    
    const embed = baseEmbed(`${emoji} ${action}`, color)
      .setDescription(
        `👤 **Üye:** ${user}\n` +
        `📋 **İşlem:** ${action}` +
        `${details ? `\n📝 **Detay:** ${safeTruncate(details, 300)}` : ''}`
      )
      .setThumbnail(user.displayAvatarURL({ size: 256 }));

    await sendToChannel(client, cfg.logChannels?.memberActivity, { embeds: [embed] });
  } catch (error) {
    console.error('[MEMBER_ACTIVITY_LOG] Hata:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🤖 BOT INTERNAL LOGGING - Bot İç Sistem Günlükleri
// ═══════════════════════════════════════════════════════════════════

/**
 * Bot iç işlemlerini basit şekilde kaydeder
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
      .setDescription(safeTruncate(message, 1024))
      .setTimestamp(Date.now());

    // Sadece gerekli bilgileri ekle
    const fields = [];
    
    if (details) {
      fields.push({
        name: '📋 Detaylar',
        value: safeTruncate(details, 300),
        inline: false
      });
    }

    if (Object.keys(data).length > 0) {
      const dataStr = Object.entries(data)
        .map(([key, value]) => `**${key}:** ${value}`)
        .join('\n');
      fields.push({
        name: '📊 Bilgi',
        value: safeTruncate(dataStr, 300),
        inline: false
      });
    }

    if (fields.length > 0) {
      embed.addFields(...fields);
    }

    embed.setFooter({ 
      text: `${getFormattedTime()}`,
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
 * Komut kullanımını kaydeder
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

    const embed = baseEmbed(`${statusEmoji} ${command.toUpperCase()}`, statusColor)
      .setDescription(
        `👤 **Kullanıcı:** ${member}\n` +
        `${args.length > 0 ? `📋 **Parametreler:** \`${args.join(' ')}\`` : 'Parametre yok'}` +
        `${!success && error ? `\n🚨 **Hata:** ${safeTruncate(error, 300)}` : ''}`
      )
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }));

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
    let emoji = '⚠️';
    let color = 0xff6b6b;
    
    if (severity <= 3) {
      emoji = '⚠️';
      color = 0xffa500;
    } else if (severity >= 7) {
      emoji = '🚨';
      color = 0xff0000;
    }

    const description = 
      `🔐 **Olayı:** ${type}\n` +
      `👤 **Yapan:** ${actor}` +
      `${target ? `\n🎯 **Hedef:** ${target}` : ''}` +
      `${reason ? `\n📌 **Sebep:** ${reason}` : ''}` +
      `${details ? `\n📋 **Detay:** ${safeTruncate(details, 300)}` : ''}`;

    const embed = baseEmbed(`${emoji} ${type.toUpperCase()}`, color)
      .setDescription(description);

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
      'timeout': { emoji: '⏱️', label: 'TIMEOUT', color: 0xff9900 },
      'role_add': { emoji: '➕', label: 'ROL EKLEME', color: 0x57f287 },
      'role_remove': { emoji: '➖', label: 'ROL ÇIKARTMA', color: 0xff0000 }
    };

    const actionInfo = actionMap[action.toLowerCase()] || { emoji: '❓', label: action.toUpperCase(), color: 0x2b2d31 };
    const targetUser = target.user || target;

    const description = 
      `👤 **Hedef:** ${target}\n` +
      `⚙️ **Moderatör:** ${moderator}\n` +
      `📝 **Sebep:** ${safeTruncate(reason, 300)}` +
      `${duration ? `\n⏰ **Süre:** \`${duration}\`` : ''}`;

    const embed = baseEmbed(`${actionInfo.emoji} ${actionInfo.label}`, actionInfo.color)
      .setDescription(description)
      .setThumbnail(targetUser.displayAvatarURL({ size: 256 }));

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
    const embed = baseEmbed(`📝 ${type.toUpperCase()}`, 0x5865f2)
      .setDescription(
        `📌 **Olay:** ${type}\n` +
        `${executor ? `⚙️ **Yapan:** ${executor}` : ''}` +
        `${target ? `\n🎯 **Hedef:** \`${target}\`` : ''}`
      );

    if (before !== null || after !== null) {
      embed.addFields({
        name: '📊 Değişim',
        value: 
          `**Öncesi:** \`${safeTruncate(String(before), 200)}\`\n` +
          `**Sonrası:** \`${safeTruncate(String(after), 200)}\``,
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
 * Hataları kaydeder
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

    const embed = errorEmbed(
      `${errorName}`,
      `**Bağlam:** ${context}\n` +
      `**Mesaj:** ${safeTruncate(errorMessage, 300)}`
    );

    if (userId) {
      embed.addFields({
        name: '👤 Kullanıcı',
        value: `\`${userId}\``,
        inline: true
      });
    }

    if (Object.keys(additionalData).length > 0) {
      const dataStr = Object.entries(additionalData)
        .map(([k, v]) => `${k}: ${safeTruncate(String(v), 100)}`)
        .join('\n');
      embed.addFields({
        name: '📋 Ek Bilgi',
        value: dataStr,
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
    
    const embed = baseEmbed('📊 İSTATİSTİKLER', 0x5865f2)
      .setDescription(
        `👥 **Kullanıcılar:** ${client.users.cache.size}\n` +
        `🏢 **Sunucular:** ${client.guilds.cache.size}\n` +
        `💾 **Bellek:** ${memory.used}MB / ${memory.total}MB (${memory.percentage}%)\n` +
        `⏱️ **Uptime:** ${getFormattedUptime()}`
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
      text: getFormattedTime(),
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
