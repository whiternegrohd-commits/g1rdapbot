require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  AuditLogEvent,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');

const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')
);

const { handleCommand, isAdmin } = require('./commands');
const { safeTruncate, baseEmbed, sendToChannel, sendDM, formatMessage } = require('./logger');
const {
  handleGuardEvent,
  notifyChannelChangeDM,
  handleRoleSpamGuard,
  handleContextMenuBan,
  handleContextMenuTimeout,
  handleContextMenuNickChange,
  handleRoleDeleteRecreate,
  backupRoleBeforeDelete,
  handleRoleCreate,
  handleGuildUpdate,
  handleBulkRoleGuard,
  handleBulkChannelGuard,
  handleChannelDeleteRecreate
} = require('./guard');
const { addMessageCount, addVoiceDurationSplit, getJails, removeJail, isVipGranted, getGuildLeaderboard } = require('./storage');
const { releaseMemberFromJail } = require('./jail');
const { createBackup, cleanOldBackups } = require('./backup');
const { logMemberActivity, logBotInternal, logCommandUsage } = require('./logger');

// Silinen mesajları takip et (guildId:channelId -> { author, content, at })
const deletedMessages = new Map();
global.deletedMessages = deletedMessages;

// YT1 violation tracking
const yt1Violations = new Map();
const yt1SuspendedUsers = new Map();

// Ban tracker
const banTracker = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User]
});

function channelLink(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function isAllowedGuild(guildOrId) {
  const allowed = cfg.guildId;
  if (!allowed) return true;
  const id = typeof guildOrId === 'string' ? guildOrId : guildOrId?.id;
  return Boolean(id && String(id) === String(allowed));
}

async function leaveForeignGuilds() {
  if (!cfg.guildId) return;
  for (const [id, guild] of client.guilds.cache) {
    if (isAllowedGuild(id)) continue;
    console.log(`Bu bot sadece ${cfg.guildId} için. Ayrılıyor: ${guild.name} (${id})`);
    await guild.leave().catch((e) => console.error(`Sunucudan ayrılamadı (${id}):`, e.message));
  }
}

async function findRoleUpdateExecutor(member) {
  try {
    const logs = await member.guild.fetchAuditLogs({
      limit: 5,
      type: AuditLogEvent.MemberRoleUpdate
    });
    const entry = logs.entries.find((e) => {
      const sameTarget = e.target?.id ? String(e.target.id) === String(member.id) : false;
      const fresh = Date.now() - e.createdTimestamp < 15_000;
      return fresh && sameTarget;
    });
    if (!entry) return null;
    return entry.executor;
  } catch {
    return null;
  }
}

client.on('ready', async () => {
  console.log(`✅ Bot giriş yaptı: ${client.user.tag}`);
  
  // Bot internal log
  logBotInternal({
    client,
    cfg,
    level: 'SUCCESS',
    title: 'Bot Başlatıldı',
    message: `${client.user.tag} başarılı bir şekilde başlatıldı.`,
    details: `Guilds: ${client.guilds.cache.size} • Users: ${client.users.cache.size}`
  });
  
  if (cfg.guildId) {
    console.log(`📌 İzin verilen sunucu: ${cfg.guildId}`);
    await leaveForeignGuilds();
  }
  const status = (process.env.BOT_STATUS?.trim() || cfg.status || '').trim();
  if (status) {
    try {
      client.user.setActivity(status);
      console.log(`🎯 Bot durumu ayarlandı: ${status}`);
    } catch (e) {
      console.error(`⚠️ Bot durumu ayarlanamadı:`, e.message);
    }
  }

  // Bot'u sabit kanalda tut (voice channel join)
  const voiceChannelId = '1520787780207378433';
  if (cfg.guildId) {
    const guild = client.guilds.cache.get(String(cfg.guildId));
    if (guild) {
      const channel = guild.channels.cache.get(voiceChannelId);
      if (channel && channel.isVoiceBased()) {
        try {
          const { joinVoiceChannel } = require('@discordjs/voice');
          const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: true
          });
          console.log(`✅ Bot ${channel.name} kanalına bağlandı (sessize alındı)`);
        } catch (e) {
          console.error(`❌ Bot ses kanalına bağlanamadı:`, e.message);
        }
      }
    }
  }

  // her 60 sn jail sürelerini kontrol et
  setInterval(() => {
    tryUnjailExpired().catch(() => {});
  }, 60_000);
  // ilk çalışmada da kontrol et
  tryUnjailExpired().catch(() => {});

  // Her gece 04:00'te backup al
  function scheduleBackup() {
    const now = new Date();
    const target = new Date();
    target.setHours(4, 0, 0, 0);
    
    // Eğer 04:00 geçtiyse, yarın için schedule yap
    if (now > target) {
      target.setDate(target.getDate() + 1);
    }
    
    const delay = target - now;
    
    console.log(`[BACKUP] Sonraki backup: ${target.toLocaleString('tr-TR')}`);
    
    setTimeout(() => {
      if (cfg.guildId) {
        createBackup(client, cfg.guildId).then(() => {
          console.log('[BACKUP] ✅ Günlük backup tamamlandı');
        });
      }
      // Sonraki gün için tekrar schedule yap
      scheduleBackup();
    }, delay);
  }
  
  scheduleBackup();
});

client.on('guildCreate', async (guild) => {
  if (!isAllowedGuild(guild)) {
    console.log(`Davet reddedildi, ayrılıyor: ${guild.name} (${guild.id})`);
    await guild.leave().catch(() => {});
  }
});

// Vanity URL değişikliği koruması: muaf değilse rol kırp + DM + GERI YAZ
client.on('guildUpdate', async (oldGuild, newGuild) => {
  if (!isAllowedGuild(newGuild)) return;
  try {
    const logs = await newGuild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.GuildUpdate });
    const entry = logs.entries.find((e) => Date.now() - e.createdTimestamp < 15_000);
    if (!entry) return;

    const executorId = entry.executorId;
    if (!executorId) return;

    // Muaf bot ise skip
    if (cfg.exemptBotId && String(executorId) === String(cfg.exemptBotId)) return;

    const member = await newGuild.members.fetch(executorId).catch(() => null);
    if (!member) return;

    // Bots rolü için özel guard - sunucu ayarları değişikliği
    const botsRoleId = cfg.roles?.botsRoleId;
    if (botsRoleId && member.roles.cache.has(botsRoleId)) {
      await handleGuildUpdate({ client, guild: newGuild, cfg, oldGuild, executorId });
    }

    // Vanity URL değişikliğini kontrol et
    const changed = (entry.changes ?? []).some((c) => {
      const k = String(c.key ?? '').toLowerCase();
      return k.includes('vanity') || k === 'vanity_url_code';
    });
    
    if (!changed) return;

    const oldCode = oldGuild.vanityURLCode ?? '(bilinmiyor)';
    const newCode = newGuild.vanityURLCode ?? '(bilinmiyor)';
    const officialCode = cfg.officialVanityCode || oldCode; // Config'deki official URL

    console.log(`[VANITY_URL] Değişim tespit: ${oldCode} -> ${newCode} (Yapan: ${member.user.tag})`);

    // URL'yi resmi URL'ye geri yaz (3 kez retry)
    async function restoreVanityUrl(retries = 3) {
      for (let i = 0; i < retries; i++) {
        try {
          if (officialCode && officialCode !== '(bilinmiyor)') {
            await newGuild.setVanityCode(officialCode, `Guard: URL restore (attempt ${i + 1})`);
            console.log(`[VANITY_URL] Restore başarılı: ${officialCode}`);
            return true;
          }
        } catch (e) {
          console.log(`[VANITY_URL] Restore deneme ${i + 1} başarısız: ${e.message}`);
          if (i < retries - 1) {
            await new Promise(r => setTimeout(r, 500)); // 500ms bekle
          }
        }
      }
      return false;
    }

    // SuperAdmin'se direk ceza + URL restore
    if (member.roles.cache.has(cfg.roles.superAdminRoleId)) {
      console.log(`[VANITY_URL] SuperAdmin tespit: ${member.user.tag}, ceza veriliyor...`);
      await punishSuperAdmin(newGuild, executorId, 'Vanity URL değişikliği');
      
      const restored = await restoreVanityUrl(3);
      
      await sendDM(client, cfg.notifyUserId, {
        embeds: [
          baseEmbed('🚨 UYARI: Vanity URL Değişikliği (SuperAdmin)', 0xff0000).setDescription(
            `👤 Yapan: ${member} (\`${executorId}\`)\n` +
            `📝 Eski: **discord.gg/${oldCode}**\n` +
            `❌ Yeni: **discord.gg/${newCode}**\n` +
            `⚡ Aksiyon: SuperAdmin rolü silindi + tüm admin rolleri alındı\n` +
            `✅ URL Restore: ${restored ? '**Başarılı** ✓' : '**Başarısız** ✗'}`
          )
        ]
      });
      return;
    }

    // YT1 kontrolü
    await checkYT1Violation(newGuild, executorId, 'Vanity URL değişikliği');

    // rol kırp (@everyone hariç her şeyi kaldır)
    let punished = false;
    if (member.manageable) {
      const keepEveryone = member.roles.cache.filter((r) => r.id === member.guild.id);
      punished = await member.roles
        .set([...keepEveryone.keys()], 'Vanity URL değişikliği koruması')
        .then(() => true)
        .catch(() => false);
    }

    // URL'yi geri yaz
    const restored = await restoreVanityUrl(3);

    await sendDM(client, cfg.notifyUserId, {
      embeds: [
        baseEmbed('⚠️ UYARI: Vanity URL Değişikliği', 0xffa500).setDescription(
          `👤 Yapan: ${member} (\`${executorId}\`)\n` +
          `📝 Eski: **discord.gg/${oldCode}**\n` +
          `❌ Yeni: **discord.gg/${newCode}**\n` +
          `⚡ Aksiyon: ${punished ? 'Roller alındı (Jail aktif)' : 'Rol alınamadı (bot yetkisi yetmedi)'}\n` +
          `✅ URL Restore: ${restored ? '**Başarılı** ✓' : '**Başarısız** ✗'}`
        )
      ]
    });
  } catch (e) {
    console.error('[VANITY_URL] Hata:', e.message);
  }
});

async function tryUnjailExpired() {
  if (!cfg.guildId) return;
  const guild = client.guilds.cache.get(String(cfg.guildId));
  if (!guild || !cfg.jailRoleId) return;

  const jails = getJails(guild.id);
  const now = Date.now();
  for (const [userId, data] of Object.entries(jails)) {
    if (!data?.until || now < data.until) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      removeJail(guild.id, userId);
      continue;
    }

    if (member.roles.cache.has(cfg.roles.superAdminRoleId)) {
      removeJail(guild.id, userId);
      continue;
    }

    await releaseMemberFromJail(guild, member, cfg, 'Jail süresi bitti');
  }
}

function memberHasTag(member, tagText) {
  const t = String(tagText ?? '').toLowerCase().trim();
  if (!t) return false;
  const a = (member?.displayName ?? '').toLowerCase();
  const b = (member?.user?.username ?? '').toLowerCase();
  const c = (member?.user?.globalName ?? '').toLowerCase();
  return a.includes(t) || b.includes(t) || c.includes(t);
}

async function punishSuperAdmin(guild, executorId, reason) {
  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return;

  const boosterRoleId = '1484308603711262872'; // DOKUNMA

  // Bot'un altındaki tüm rolleri al (booster hariç)
  const rolesToRemove = member.roles.cache.filter((role) => {
    // Booster rolüne dokunma
    if (role.id === boosterRoleId) return false;
    // @everyone dokunma
    if (role.id === guild.id) return false;
    // Bot'un altındaki rolleri al
    return true;
  });

  if (rolesToRemove.size > 0) {
    const roleIds = rolesToRemove.map(r => r.id);
    await member.roles.remove(roleIds, `Ceza: ${reason}`).catch(() => {});
  }

  // DM'e bildirim gönder
  const removedCount = rolesToRemove.size;
  await sendDM(client, cfg.notifyUserId, {
    embeds: [
      baseEmbed('🚨 CEZA VERİLDİ', 0xff0000).setDescription(
        `Üye: ${member} (\`${executorId}\`)\n` +
          `İhlal: **${reason}**\n` +
          `Aksiyon: ${removedCount} rol alındı (Booster hariç)`
      )
    ]
  });
}

async function checkYT1Violation(guild, executorId, violationType) {
  const yt1RoleId = '1509941362600972329';
  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member || !member.roles.cache.has(yt1RoleId)) return;

  // Zaten suspend edilmişse tekrar yapma
  if (yt1SuspendedUsers.has(executorId)) return;

  const data = yt1Violations.get(executorId) ?? { count: 0, violations: [] };
  data.violations.push({ type: violationType, at: Date.now() });
  data.count = (data.violations.filter(v => Date.now() - v.at < 24 * 60 * 60 * 1000)).length;
  yt1Violations.set(executorId, data);

  // Herhangi bir ihlal = suspend
  await suspendYT1Permissions(guild, executorId);

  await sendDM(client, cfg.notifyUserId, {
    embeds: [
      baseEmbed('🚨 YT1 Güvenlik İhlali', 0xff0000).setDescription(
        `Üye: ${member} (\`${executorId}\`)\n` +
          `İhlal: **${violationType}**\n` +
          `Aksiyon: YT1 izinleri kaldırıldı\n` +
          `Geri Açılış: 10 dakika sonra otomatik veya \`.ytaç @uye\` komutuyla`
      )
    ]
  });
}

async function suspendYT1Permissions(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  const yt1RoleId = '1509941362600972329';
  if (member.roles.cache.has(yt1RoleId)) {
    await member.roles.remove(yt1RoleId, 'YT1 güvenlik: İhlal tespit edildi').catch(() => {});
  }

  yt1SuspendedUsers.set(userId, true);

  // 10 dakika sonra geri aç
  const timeoutId = setTimeout(async () => {
    const m = await guild.members.fetch(userId).catch(() => null);
    if (m && m.roles.cache.has(yt1RoleId) === false) {
      await m.roles.add(yt1RoleId, 'YT1 güvenlik: 10 dakika geçti, izinler geri verildi').catch(() => {});
    }
    yt1SuspendedUsers.delete(userId);
  }, 10 * 60 * 1000);

  yt1SuspendedUsers.set(userId, timeoutId);
}

async function syncTagRole(member) {
  const tagCfg = cfg.tag;
  if (!tagCfg?.text || !tagCfg?.roleId) return;
  if (!member || member.user?.bot) return;

  const has = memberHasTag(member, tagCfg.text);
  const hasRole = member.roles.cache.has(tagCfg.roleId);

  if (has && !hasRole) {
    await member.roles.add(tagCfg.roleId, 'Sunucu tagı alındı').catch(() => {});
  }
  if (!has && hasRole && tagCfg.removeWhenMissing) {
    const vipRoleId = cfg.vipRoleId;
    if (vipRoleId && String(tagCfg.roleId) === String(vipRoleId) && isVipGranted(member.guild.id, member.id)) {
      return;
    }
    await member.roles.remove(tagCfg.roleId, 'Sunucu tagı kaldırıldı').catch(() => {});
  }
}

// Voice oturum takibi (guildId:userId -> { channelId, startMs })
const voiceSessions = new Map();

// Spam tracking (userId -> { messages, links, emojis, warnings, lastCheck })
const spamTracker = new Map();

// Mention spam tracking (userId -> { count, lastAt })
const mentionSpamTracker = new Map();

function trackSpam(userId, type) {
  const now = Date.now();
  const tracker = spamTracker.get(userId) || { 
    messages: [], 
    links: [], 
    emojis: [], 
    warnings: 0,
    lastCheck: now 
  };
  
  // 10 saniyeden eski olanları sil
  tracker.messages = tracker.messages.filter(t => now - t < 5000); // 5 saniye pencerim
  tracker.links = tracker.links.filter(t => now - t < 10000);
  tracker.emojis = tracker.emojis.filter(t => now - t < 5000);
  
  if (type === 'message') tracker.messages.push(now);
  if (type === 'link') tracker.links.push(now);
  if (type === 'emoji') tracker.emojis.push(now);
  
  spamTracker.set(userId, tracker);
  return tracker;
}

function getLinkCount(text) {
  const linkRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  return (text.match(linkRegex) || []).length;
}

function isShortURL(url) {
  const shorteners = ['bit.ly', 'tinyurl', 'short.link', 'ow.ly', 'goo.gl', 'is.gd', 'buff.ly', 'adf.ly', 't.co', 'discord.gg'];
  return shorteners.some(s => url.toLowerCase().includes(s));
}

// Button interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
  
  // SELECT MENU HANDLER
  if (interaction.isStringSelectMenu()) {
    const customId = interaction.customId;

    // Leaderboard time select
    if (customId === 'leaderboard_time_select') {
      const selectedDays = Number(interaction.values[0]);
      const { getGuildLeaderboard } = require('./storage');

      const { voiceByUser, msgByUser } = getGuildLeaderboard(interaction.guild.id, selectedDays);

      const fmtDur = (sec) => {
        const s = Math.max(0, Math.floor(Number(sec ?? 0)));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        if (h > 0) return `${h}s ${m}d`;
        if (m > 0) return `${m}d ${ss}s`;
        return `${ss}s`;
      };

      const getRankEmoji = (position) => {
        if (position === 1) return '🥇';
        if (position === 2) return '🥈';
        if (position === 3) return '🥉';
        return `#${position}`;
      };

      const topVoiceUsers = Object.entries(voiceByUser)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 10);
        
      const topMsgUsers = Object.entries(msgByUser)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 10);

      // Grafik için veri hazırla (ilk 5)
      const voiceLabels = topVoiceUsers.slice(0, 5).map(([uid]) => `<@${uid}>`);
      const voiceData = topVoiceUsers.slice(0, 5).map(([, sec]) => Math.floor(Number(sec ?? 0) / 3600));
      
      const msgLabels = topMsgUsers.slice(0, 5).map(([uid]) => `<@${uid}>`);
      const msgData = topMsgUsers.slice(0, 5).map(([, c]) => Number(c ?? 0));

      // Quickchart URL'leri
      const voiceChartConfig = {
        type: 'bar',
        data: {
          labels: voiceLabels,
          datasets: [{
            label: 'Ses Saati',
            data: voiceData,
            backgroundColor: ['#5865F2', '#5865F2', '#5865F2', '#5865F2', '#5865F2'],
            borderColor: '#5865F2',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            title: { display: true, text: '🎧 Top 5 Ses Süresi' }
          },
          scales: { y: { beginAtZero: true } }
        }
      };

      const msgChartConfig = {
        type: 'bar',
        data: {
          labels: msgLabels,
          datasets: [{
            label: 'Mesaj Sayısı',
            data: msgData,
            backgroundColor: ['#57F287', '#57F287', '#57F287', '#57F287', '#57F287'],
            borderColor: '#57F287',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            title: { display: true, text: '💬 Top 5 Mesaj' }
          },
          scales: { y: { beginAtZero: true } }
        }
      };

      const voiceChartUrl = `https://quickchart.io/chart?bkg=white&c=${encodeURIComponent(JSON.stringify(voiceChartConfig))}`;
      const msgChartUrl = `https://quickchart.io/chart?bkg=white&c=${encodeURIComponent(JSON.stringify(msgChartConfig))}`;

      const voiceLines = topVoiceUsers.length > 0
        ? topVoiceUsers.map(([uid, sec], i) => `${getRankEmoji(i + 1)} <@${uid}> — **${fmtDur(sec)}**`).join('\n')
        : '📭 Veri yok';
        
      const msgLines = topMsgUsers.length > 0
        ? topMsgUsers.map(([uid, c], i) => `${getRankEmoji(i + 1)} <@${uid}> — **${c}** 💬`).join('\n')
        : '📭 Veri yok';

      const totalVoiceSum = Object.values(voiceByUser).reduce((a, b) => a + Number(b ?? 0), 0);
      const totalMsgSum = Object.values(msgByUser).reduce((a, b) => a + Number(b ?? 0), 0);
      const totalVoiceHours = Math.floor(totalVoiceSum / 3600);

      await interaction.update({
        embeds: [
          baseEmbed(`🏆 GIRDAP LEADERBOARD - Son ${selectedDays} Gün`, 0x00b0f4)
            .setDescription(
              `🏢 **Sunucu:** ${interaction.guild.name}\n` +
              `👥 **Aktif Üyeler:** ${Object.keys({...voiceByUser, ...msgByUser}).length}\n\n` +
              `📊 **İstatistikler:**\n` +
              `🎧 Toplam Ses: **${totalVoiceHours}s** (${(totalVoiceSum / 60).toFixed(0)}d)\n` +
              `💬 Toplam Mesaj: **${totalMsgSum}** mesaj`
            )
            .setImage(voiceChartUrl)
            .addFields(
              { 
                name: '🎧 En Çok Ses Süresi (Top 10)', 
                value: voiceLines || '📭 Veri yok', 
                inline: false 
              }
            )
            .setColor(0x00b0f4)
            .setFooter({ text: `✨ Güncelleme: ${new Date().toLocaleDateString('tr-TR')} ${new Date().toLocaleTimeString('tr-TR')}` })
        ]
      });

      await interaction.channel.send({
        embeds: [
          baseEmbed(`💬 MESAJ SIRALAMASI`, 0x57f287)
            .setImage(msgChartUrl)
            .addFields(
              { 
                name: '💬 En Çok Mesaj (Top 10)', 
                value: msgLines || '📭 Veri yok', 
                inline: false 
              }
            )
            .setColor(0x57f287)
        ]
      });
      return;
    }

    return;
  }
  
  // BUTTON HANDLER
  if (!interaction.isButton()) return;

  const customId = interaction.customId;
  
  // TIMEOUT CONFIRM
  if (customId.startsWith('timeout_confirm_')) {
    const parts = customId.split('_');
    const targetId = parts[2];
    const mins = Number(parts[3]);
    const authorId = parts[4];

    // Sadece komutu kullanan kişi tıklayabilir
    if (interaction.user.id !== authorId) {
      await interaction.reply({ content: '❌ Sadece bu komutu kullanan kişi tıklayabilir.', ephemeral: true });
      return;
    }

    const guild = interaction.guild;
    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) {
      await interaction.reply({ content: '❌ Üye bulunamadı.', ephemeral: true });
      return;
    }

    // Hiyerarşi kontrolü
    const { canActionTarget } = require('./commands');
    const executor = interaction.member;
    if (!canActionTarget(executor, member, cfg)) {
      await interaction.reply({ content: '❌ Bu üyeye işlem yapamıyorsun (rütbe sınırı).', ephemeral: true });
      return;
    }

    // Sebep bilgisi - embed'den çek
    let reason = 'Sebep yok';
    if (interaction.message.embeds && interaction.message.embeds[0]) {
      const embed = interaction.message.embeds[0];
      const desc = embed.description || '';
      const reasonMatch = desc.match(/\*\*Sebep:\*\* (.+)/);
      if (reasonMatch) reason = reasonMatch[1];
    }

    const modInfo = `${interaction.user.tag} (\`${interaction.user.id}\`)`;

    await member.timeout(mins * 60 * 1000, `Timeout: ${reason}`).catch((e) => {
      interaction.reply({ content: `❌ Timeout başarısız: ${e.message}`, ephemeral: true });
    });

    await interaction.reply({
      content: `✅ ${member} ${mins} dakika timeout aldı.`,
      ephemeral: true
    });

    // Detaylı timeout logu
    await sendToChannel(client, cfg.logChannels.general, {
      embeds: [
        baseEmbed('⏱️ Timeout Verildi', 0xff9900)
          .setDescription(
            `**Hedef:** ${member.user.tag} (\`${targetId}\`)\n` +
            `**Mod:** ${modInfo}\n` +
            `**Süre:** ${mins} dakika\n` +
            `**Sebep:** ${reason}\n` +
            `**Zamanı:** ${new Date().toLocaleString('tr-TR')}`
          )
      ]
    });

    // Orijinal mesajı güncelle
    await interaction.message.edit({ components: [] }).catch(() => {});
    return;
  }

  // BAN CONFIRM
  if (customId.startsWith('ban_confirm_')) {
    const parts = customId.split('_');
    const targetId = parts[2];
    const authorId = parts[3];

    // Sadece komutu kullanan kişi tıklayabilir
    if (interaction.user.id !== authorId) {
      await interaction.reply({ content: '❌ Sadece bu komutu kullanan kişi tıklayabilir.', ephemeral: true });
      return;
    }

    const guild = interaction.guild;
    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) {
      await interaction.reply({ content: '❌ Üye bulunamadı.', ephemeral: true });
      return;
    }

    // Hiyerarşi kontrolü
    const { canActionTarget } = require('./commands');
    const executor = interaction.member;
    if (!canActionTarget(executor, member, cfg)) {
      await interaction.reply({ content: '❌ Bu üyeye işlem yapamıyorsun (rütbe sınırı).', ephemeral: true });
      return;
    }

    // Sebep, Mod bilgisi - embed'den çek
    let reason = 'Sebep yok';
    let modInfo = `${interaction.user.tag} (\`${interaction.user.id}\`)`;
    if (interaction.message.embeds && interaction.message.embeds[0]) {
      const embed = interaction.message.embeds[0];
      const desc = embed.description || '';
      const reasonMatch = desc.match(/\*\*Sebep:\*\* (.+)/);
      if (reasonMatch) reason = reasonMatch[1];
    }

    await member.ban({ reason: `Ban: ${reason}` }).catch((e) => {
      interaction.reply({ content: `❌ Ban başarısız: ${e.message}`, ephemeral: true });
    });

    await interaction.reply({
      content: `✅ ${member.user.tag} banlandı.`,
      ephemeral: true
    });

    // Detaylı ban logu
    await sendToChannel(client, cfg.logChannels.general, {
      embeds: [
        baseEmbed('🚫 Üye Banlandı', 0xff0000)
          .setDescription(
            `**Hedef:** ${member.user.tag} (\`${targetId}\`)\n` +
            `**Mod:** ${modInfo}\n` +
            `**Sebep:** ${reason}\n` +
            `**Zamanı:** ${new Date().toLocaleString('tr-TR')}`
          )
      ]
    });

    // Orijinal mesajı güncelle
    await interaction.message.edit({ components: [] }).catch(() => {});
    return;
  }

  // KICK CONFIRM
  if (customId.startsWith('kick_confirm_')) {
    const parts = customId.split('_');
    const targetId = parts[2];
    const authorId = parts[3];

    // Sadece komutu kullanan kişi tıklayabilir
    if (interaction.user.id !== authorId) {
      await interaction.reply({ content: '❌ Sadece bu komutu kullanan kişi tıklayabilir.', ephemeral: true });
      return;
    }

    const guild = interaction.guild;
    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) {
      await interaction.reply({ content: '❌ Üye bulunamadı.', ephemeral: true });
      return;
    }

    // Hiyerarşi kontrolü
    const { canActionTarget } = require('./commands');
    const executor = interaction.member;
    if (!canActionTarget(executor, member, cfg)) {
      await interaction.reply({ content: '❌ Bu üyeye işlem yapamıyorsun (rütbe sınırı).', ephemeral: true });
      return;
    }

    // Sebep bilgisi - embed'den çek
    let reason = 'Sebep yok';
    if (interaction.message.embeds && interaction.message.embeds[0]) {
      const embed = interaction.message.embeds[0];
      const desc = embed.description || '';
      const reasonMatch = desc.match(/\*\*Sebep:\*\* (.+)/);
      if (reasonMatch) reason = reasonMatch[1];
    }

    const modInfo = `${interaction.user.tag} (\`${interaction.user.id}\`)`;

    await member.kick(`Kick: ${reason}`).catch((e) => {
      interaction.reply({ content: `❌ Kick başarısız: ${e.message}`, ephemeral: true });
    });

    await interaction.reply({
      content: `✅ ${member.user.tag} kicklendi.`,
      ephemeral: true
    });

    // Detaylı kick logu
    await sendToChannel(client, cfg.logChannels.general, {
      embeds: [
        baseEmbed('👢 Üye Kicklendi', 0xffa500)
          .setDescription(
            `**Hedef:** ${member.user.tag} (\`${targetId}\`)\n` +
            `**Mod:** ${modInfo}\n` +
            `**Sebep:** ${reason}\n` +
            `**Zamanı:** ${new Date().toLocaleString('tr-TR')}`
          )
      ]
    });

    // Orijinal mesajı güncelle
    await interaction.message.edit({ components: [] }).catch(() => {});
    return;
  }

  // İPTAL BUTONLARI
  if (customId.startsWith('timeout_cancel_') || customId.startsWith('ban_cancel_') || customId.startsWith('kick_cancel_')) {
    await interaction.reply({ content: '❌ İşlem iptal edildi.', ephemeral: true });
    await interaction.message.edit({ components: [] }).catch(() => {});
    return;
  }
});

// Prefix komutlar
client.on('messageCreate', async (message) => {
  if (message.guild && !isAllowedGuild(message.guild)) return;
  if (message.author.bot) return;
  
  // Spam kontrolleri
  if (message.guild) {
    const userId = message.author.id;
    const content = message.content;
    const tracker = trackSpam(userId, 'message');
    
    // 1. Kısaltılmış URL kontrolü
    const links = content.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/gi) || [];
    for (const link of links) {
      if (isShortURL(link)) {
        await message.delete().catch(() => {});
        const guardMsg = formatMessage('🚫', 'Kısaltılmış URL Tespit', `${message.author}\nKanal: <#${message.channelId}>\nURL: \`${link}\``);
        await sendToChannel(client, cfg.logChannels.guard, guardMsg);
        return;
      }
    }
    
    // 2. Mesaj spam (10+ mesaj 5 saniyede) - 2 uyarı + 3.de timeout
    if (tracker.messages.length >= 10) {
      const userTracker = spamTracker.get(userId);
      userTracker.warnings = (userTracker.warnings ?? 0) + 1;
      spamTracker.set(userId, userTracker);
      
      if (userTracker.warnings < 3) {
        // Uyarı gönder
        const warnMsg = formatMessage(
          '⚠️', 
          'Spam Uyarısı', 
          `${message.author} - Mesaj spam tespit (10+ mesaj 5 saniyede)\n` +
          `Uyarı Sayısı: ${userTracker.warnings}/2\n` +
          `Kanal: <#${message.channelId}>\n` +
          `Not: Bir daha yaparsanız 60 saniye timeout alacaksınız!`
        );
        await sendToChannel(client, cfg.logChannels.general, warnMsg);
        
        try {
          await message.author.send({
            content: `⚠️ **Spam Uyarısı!**\n\n${message.guild.name} sunucusunda spam yaptığınız tespit edildi.\n` +
            `**Uyarı Sayısı:** ${userTracker.warnings}/2\n` +
            `**Sonraki ihlalde:** 60 saniye timeout alacaksınız!`
          }).catch(() => {});
        } catch {}
      } else {
        // 3. kez: Timeout
        await message.member.timeout(60000, 'Spam: 3 kez uyarıdan sonra').catch(() => {});
        
        const timeoutMsg = formatMessage(
          '⏱️', 
          'Spam Timeout', 
          `${message.author} - Mesaj spam (3 kez uyarıdan sonra)\n` +
          `Timeout Süresi: 60 saniye\n` +
          `Kanal: <#${message.channelId}>`
        );
        await sendToChannel(client, cfg.logChannels.general, timeoutMsg);
        
        try {
          await message.author.send({
            content: `⏱️ **60 Saniye Timeout!**\n\n${message.guild.name} sunucusunda spam yaptığınız için 60 saniye timeout aldınız.\n` +
            `Uyarıları dikkate almadığınız için bu cezaya tabi tutuldunuz.`
          }).catch(() => {});
        } catch {}
        
        // Reset warnings
        const resetTracker = spamTracker.get(userId);
        resetTracker.warnings = 0;
        resetTracker.messages = [];
        spamTracker.set(userId, resetTracker);
      }
      return;
    }
    
    // 3. Link spam (5+ link 10 saniyede)
    if (tracker.links.length >= 5) {
      await message.member.timeout(60000, 'Link spam').catch(() => {});
      const spamMsg = formatMessage('⏱️', 'Link Spam Timeout', `${message.author} - Link spam (5+ link 10 saniyede)\nTimeout Süresi: 60 saniye\nKanal: <#${message.channelId}>`);
      await sendToChannel(client, cfg.logChannels.general, spamMsg);
      spamTracker.delete(userId);
      return;
    }
    
    // Link count tracking
    if (links.length > 0) {
      trackSpam(userId, 'link');
    }
    
    // 4. Mention spam (@everyone/@here blocker) - 1 kere izin, 2. kere block
    const mentionData = mentionSpamTracker.get(userId) ?? { count: 0, lastAt: 0 };
    const now = Date.now();
    
    // 24 saati aşmışsa reset et
    if (now - mentionData.lastAt > 24 * 60 * 60 * 1000) {
      mentionData.count = 0;
    }
    
    const hasMentionEveryone = message.mentions.has(message.guild.roles.everyone);
    const hasHereMention = content.includes('@here');
    
    if (hasMentionEveryone || hasHereMention) {
      mentionData.count++;
      mentionData.lastAt = now;
      mentionSpamTracker.set(userId, mentionData);
      
      if (mentionData.count >= 2) {
        // 2. kere - block et
        await message.delete().catch(() => {});
        await message.author.send({ content: `⛔ **Mention Spam Yasak!**\n\nGirdap Sunucusu'nda @everyone veya @here mention'ı bir kez yapılabilir.\nSiz zaten bunu yaptınız ve tekrar denediğiniz için mesajınız silindi.` }).catch(() => {});
        
        const mentionMsg = formatMessage('🚫', 'Mention Spam Bloklandi (2. Kere)', `${message.author}\nKanal: <#${message.channelId}>\nTip: ${hasMentionEveryone ? '@everyone' : '@here'}`);
        await sendToChannel(client, cfg.logChannels.guard, mentionMsg);
        return;
      } else {
        // 1. kere - uyar et
        const warnMsg = formatMessage('⚠️', 'Mention Spam Uyarısı (1. Kere)', `${message.author}\nTip: ${hasMentionEveryone ? '@everyone' : '@here'}\nNot: Bir daha yaparsanız mesajınız silinecektir!`);
        await sendToChannel(client, cfg.logChannels.guard, warnMsg);
        return;
      }
    }
    
    // Mesaj sayısını track et
    addMessageCount(message.guild.id, message.author.id, message.channelId, new Date());
  }
  
  await handleCommand({ client, message, cfg });
});

// Welcome
client.on('guildMemberAdd', async (member) => {
  if (!isAllowedGuild(member.guild)) return;
  
  // BOT EKLEME KORUMASI
  if (member.user.bot) {
    try {
      const logs = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.BotAdd }).catch(() => null);
      const entry = logs?.entries?.first();
      const adderInfo = entry?.executor ? `${entry.executor.tag} (\`${entry.executor.id}\`)` : 'Bilinmeyen';
      
      // Bot'u atan kişi sahibi ya da full admin değilse, botu kick et
      const fullAdminRoleId = '1510665683275616427';
      const ownerId = '588050048882049035';
      
      const adder = entry?.executor;
      if (adder && adder.id !== ownerId && !member.guild.members.cache.get(adder.id)?.roles.cache.has(fullAdminRoleId)) {
        await member.kick('Yetkisiz bot ekleme').catch(() => {});
        
        await sendToChannel(client, cfg.logChannels.guard, {
          embeds: [
            baseEmbed('🚫 Bot Ekleme Engellendi', 0xff0000)
              .setDescription(
                `**Bot:** ${member.user.tag} (\`${member.id}\`)\n` +
                `**Ekleyen:** ${adderInfo}\n` +
                `**Aksiyon:** Bot sunucudan çıkarıldı\n` +
                `**Sebep:** Sadece sunucu sahibi veya Full Admin bot ekleyebilir`
              )
          ]
        });
      }
    } catch (e) {
      console.error('[BOT_ADD] Hata:', e.message);
    }
    return;
  }
  
  // Cezalı mı kontrol et
  const jails = getJails(member.guild.id);
  if (jails[member.id]) {
    const jailRoleId = cfg.jailRoleId;
    if (jailRoleId) {
      await member.roles.add(jailRoleId, 'Cezalı rol geri verildi (sunucudan ayrılıp geri girdi)').catch(() => {});
    }
  }

  // Detaylı JOIN analitikleri
  const now = Date.now();
  const accountAge = now - member.user.createdTimestamp;
  const accountAgeDays = Math.floor(accountAge / (1000 * 60 * 60 * 24));
  const hasAvatar = member.user.avatar !== null;
  const isBot = member.user.bot;
  
  // Geri dönen üye kontrolü (geçmiş kayıt var mı?)
  const allMembers = await member.guild.members.fetch().catch(() => null);
  const memberMessageCount = 0; // Başında 0
  
  // Risk seviyesi hesapla
  let riskLevel = '🟢 Düşük';
  let riskFlags = [];
  if (accountAgeDays < 7) { riskLevel = '🔴 Yüksek'; riskFlags.push('Çok yeni hesap'); }
  if (!hasAvatar) { riskLevel = '🟡 Orta'; riskFlags.push('Avatar yok'); }
  if (isBot) { riskLevel = '🟡 Orta'; riskFlags.push('Bot'); }
  
  const riskText = riskFlags.length > 0 ? riskFlags.join(', ') : 'Uygun görünüyor';

  await sendToChannel(client, cfg.logChannels.welcome, {
    embeds: [
      baseEmbed('Üye giriş yaptı', 0x57f287)
        .setDescription(`${member} (\`${member.id}\`) sunucuya katıldı.`)
        .addFields(
          { name: 'Hesap Bilgisi', value: `${member.user.tag}`, inline: false },
          { name: 'Hesap Yaşı', value: `${accountAgeDays} gün eski`, inline: true },
          { name: 'Avatar', value: hasAvatar ? '✅ Var' : '❌ Yok', inline: true },
          { name: 'Tür', value: isBot ? '🤖 Bot' : '👤 İnsan', inline: true },
          { name: 'Risk Seviyesi', value: `${riskLevel}`, inline: true },
          { name: 'Uyarılar', value: riskText, inline: true }
        )
    ]
  });
});

// Quit - Gelişmiş çıkış logu
client.on('guildMemberRemove', async (member) => {
  if (!isAllowedGuild(member.guild)) return;
  
  // Detaylı LEAVE analitikleri
  const joinedAt = member.joinedTimestamp;
  const now = Date.now();
  const membershipDays = joinedAt ? Math.floor((now - joinedAt) / (1000 * 60 * 60 * 24)) : 0;
  const membershipHours = joinedAt ? Math.floor((now - joinedAt) / (1000 * 60 * 60)) : 0;
  
  // Ayrılış sebebi kontrolü (audit log'dan)
  let leaveReason = '❓ Bilinmeyen';
  let leaveReasonDetail = '';
  try {
    const logs = await member.guild.fetchAuditLogs({ limit: 10, type: AuditLogEvent.MemberKick }).catch(() => null);
    const entry = logs?.entries?.find(e => e.targetId === member.id && Date.now() - e.createdTimestamp < 5000);
    if (entry) {
      leaveReason = `🔨 Kicklendi`;
      leaveReasonDetail = entry.reason ? `${entry.reason}` : 'Sebep belirtilmemiş';
    } else {
      leaveReason = `👋 Sunucudan ayrıldı`;
      leaveReasonDetail = 'Manuel çıkış';
    }
  } catch {}
  
  // Mesaj ve ses aktivitesi
  const summary = getGuildLeaderboard(member.guild.id, 30);
  const userVoice = summary.voiceByUser[member.id] ?? 0;
  const userMsg = summary.msgByUser[member.id] ?? 0;
  const voiceHours = Math.floor(userVoice / 3600);
  
  // Roller
  const roles = member.roles.cache
    .filter(r => r.id !== member.guild.id)
    .map(r => `<@&${r.id}>`)
    .join(', ') || 'Rol yok';

  await sendToChannel(client, cfg.logChannels.quit, {
    embeds: [
      baseEmbed('Üye ayrıldı', 0xed4245)
        .setDescription(`${member.user?.tag ?? 'Bilinmeyen'} (\`${member.id}\`) sunucudan ayrıldı.`)
        .addFields(
          { name: 'Ayrılış Bilgisi', value: `${leaveReason}\n${leaveReasonDetail}`, inline: false },
          { name: 'Sunucuda Kalış', value: `${membershipDays} gün${membershipHours > 0 ? ` (${membershipHours} saat)` : ''}`, inline: true },
          { name: 'Toplam Mesaj', value: `💬 ${userMsg} mesaj`, inline: true },
          { name: 'Toplam Ses', value: `🔊 ${voiceHours} saat`, inline: true },
          { name: 'Sahip Olduğu Roller', value: roles, inline: false }
        )
    ]
  });
});

// Tag rol kontrolü (nickname vb. değişince) + Yetki / rol değişimi logu
// Yetki / rol değişimi logu (guildMemberUpdate)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (!isAllowedGuild(newMember.guild)) return;
  const oldRoles = new Set(oldMember.roles.cache.keys());
  const newRoles = new Set(newMember.roles.cache.keys());

  const added = [...newRoles].filter((r) => !oldRoles.has(r) && r !== newMember.guild.id);
  const removed = [...oldRoles].filter((r) => !newRoles.has(r) && r !== newMember.guild.id);
  if (!added.length && !removed.length) return;

  const executor = await findRoleUpdateExecutor(newMember);
  const execStr = executor ? `${executor} (\`${executor.id}\`)` : '(audit log bulunamadı)';

  const fmt = (ids) => (ids.length ? ids.map((id) => `<@&${id}>`).join(', ') : '-');

  await sendToChannel(client, cfg.logChannels.yetki, {
    embeds: [
      baseEmbed('Rol / Yetki güncellemesi', 0x5865f2).setDescription(
        `Üye: ${newMember} (\`${newMember.id}\`)\n` +
          `Yapan: ${execStr}\n` +
          `Eklenen: ${fmt(added)}\n` +
          `Kaldırılan: ${fmt(removed)}`
      )
    ]
  });
});

// Kullanıcı adı / global ad değişince
client.on('userUpdate', async (oldUser, newUser) => {
  if (!cfg.guildId) return;
  const guild = client.guilds.cache.get(String(cfg.guildId));
  if (!guild) return;
});

// Mesaj silinme logu
client.on('messageDelete', async (message) => {
  if (!message.guild) return;
  if (!isAllowedGuild(message.guild)) return;
  if (message.author?.bot) return;

  // Silinen mesajı kaydet (snipe için)
  const key = `${message.guildId}:${message.channelId}`;
  deletedMessages.set(key, {
    author: message.author,
    content: message.content || '(boş)',
    at: Date.now()
  });

  const content = message.partial ? '(mesaj cache yok)' : (message.content || '(boş)');
  const author = message.author ? `${message.author.tag} (\`${message.author.id}\`)` : '(bilinmiyor)';
  const contentTruncated = safeTruncate(content, 500); // İlk 500 karakter
  
  // Kimin sildiğini bul (audit log)
  let deletedBy = 'Bot/Bilinmeyen';
  try {
    const logs = await message.guild.fetchAuditLogs({ limit: 5, type: 72 }).catch(() => null); // 72 = MESSAGE_DELETE
    const entry = logs?.entries?.find(e => e.targetId === message.author?.id && Date.now() - e.createdTimestamp < 5000);
    if (entry && entry.executor) {
      deletedBy = `${entry.executor.tag} (\`${entry.executor.id}\`)`;
    }
  } catch {}

  await sendToChannel(client, cfg.logChannels.general, {
    embeds: [
      baseEmbed('Mesaj silindi', 0xed4245)
        .setDescription(
          `Yazar: ${author}\n` +
          `Silen: ${deletedBy}\n` +
          `Kanal: <#${message.channelId}>\n` +
          `İçerik:\n${contentTruncated}`
        )
    ]
  });
});

// Mesaj edit logu
client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;
  if (!isAllowedGuild(newMessage.guild)) return;
  if (newMessage.author?.bot) return;

  const before = oldMessage.partial ? '(önceki mesaj cache yok)' : (oldMessage.content || '(boş)');
  const after = newMessage.partial ? '(yeni mesaj cache yok)' : (newMessage.content || '(boş)');
  if (before === after) return;

  await sendToChannel(client, cfg.logChannels.general, {
    embeds: [
      baseEmbed('Mesaj düzenlendi', 0xfaa61a).setDescription(
        `Yazar: ${newMessage.author.tag} (\`${newMessage.author.id}\`)\n` +
          `Kanal: <#${newMessage.channelId}> (${channelLink(newMessage.guild.id, newMessage.channelId)})\n\n` +
          `**Önce**:\n${safeTruncate(before, 900)}\n\n` +
          `**Sonra**:\n${safeTruncate(after, 900)}`
      )
    ]
  });
});

// Context Menu Interactions (Sağ Tık Koruması)
client.on('interactionCreate', async (interaction) => {
  if (!isAllowedGuild(interaction.guild)) return;
  if (!interaction.isContextMenuCommand()) return;

  const executorId = interaction.user.id;
  const targetId = interaction.targetId;
  const guild = interaction.guild;

  try {
    // Ban context menu
    if (
      interaction.commandName === 'Ban' ||
      interaction.commandName === 'Kick' ||
      (interaction.commandName === 'Timeout' && interaction.options?.getSubcommand?.() !== 'remove')
    ) {
      if (interaction.commandName === 'Ban' || interaction.commandName === 'Kick') {
        await handleContextMenuBan({ client, guild, cfg, executorId, targetId });
      }

      // Timeout context menu
      if (interaction.commandName === 'Timeout') {
        await handleContextMenuTimeout({ client, guild, cfg, executorId, targetId });
      }
    }

    // Nick change context menu
    if (interaction.commandName === 'Edit Nick' || interaction.commandName === 'Change Nickname') {
      await handleContextMenuNickChange({ client, guild, cfg, executorId });
    }
  } catch (e) {
    console.error('[CONTEXT_MENU_ERROR]', e.message);
  }
});

// Webhook guard + Ban spam guard
// --- Basit Guard Olayları ---
client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;
  if (!isAllowedGuild(channel.guild)) return;

  // Kanal oluşturmayı tespit et
  try {
    const logs = await channel.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.ChannelCreate });
    const entry = logs.entries.find(e => e.targetId === channel.id && Date.now() - e.createdTimestamp < 5000);
    
    if (entry && entry.executorId) {
      console.log(`[CHANNEL_CREATE] ${entry.executor?.tag || entry.executorId} oluşturdu: ${channel.name}`);
      
      // Muaf bot ise skip
      if (cfg.exemptBotId && String(entry.executorId) === String(cfg.exemptBotId)) return;
      
      const executor = await channel.guild.members.fetch(entry.executorId).catch(() => null);
      if (!executor) return;

      // OWNER ROLÜ ise DIREK admin rolleri al
      const ownerRoleId = cfg.roles?.ownerRoleId;
      if (executor.roles.cache.has(ownerRoleId)) {
        console.log(`[CHANNEL_CREATE] OWNER ROLÜ TESPIT - DIREK CEZA`);
        try {
          if (executor.manageable) {
            await executor.roles.remove(ownerRoleId, 'Guard: Kanal oluşturma - Owner rolü');
          }
        } catch (e) {
          console.error(`[CHANNEL_CREATE] Owner rolü alınamadı:`, e.message);
        }
        
        await sendToChannel(client, cfg.logChannels.guard, {
          embeds: [
            baseEmbed('Guard: Kanal Oluşturma - OWNER ROLÜ', 0xff0000).setDescription(
              `${executor} (@${executor.user.tag}) kanal oluşturdu: #${channel.name}\n\n**Aksiyon:** Owner rolü alındı.`
            )
          ]
        });
        
        await sendDM(client, cfg.notifyUserId, {
          embeds: [
            baseEmbed('Uyarı: Kanal Oluşturma - OWNER ROLÜ', 0xff0000).setDescription(
              `${executor} kanal oluşturdu: #${channel.name}\n\n**Aksiyon:** Owner rolü alındı.`
            )
          ]
        });
        return;
      }

      // BOTS ROLÜ ise DIREK admin rolleri al
      const botsRoleId = cfg.roles?.botsRoleId;
      if (executor.roles.cache.has(botsRoleId)) {
        console.log(`[CHANNEL_CREATE] BOTS ROLÜ TESPIT - DIREK CEZA`);
        const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
        try {
          if (executor.manageable) {
            await executor.roles.remove(adminRoles, 'Guard: Kanal oluşturma - Bots rolü');
          }
        } catch (e) {
          console.error(`[CHANNEL_CREATE] Rol alınamadı:`, e.message);
        }
        
        await sendToChannel(client, cfg.logChannels.guard, {
          embeds: [
            baseEmbed('Guard: Kanal Oluşturma - BOTS ROLÜ', 0xff0000).setDescription(
              `${executor} (@${executor.user.tag}) kanal oluşturdu: #${channel.name}\n\n**Aksiyon:** Admin rolleri alındı.`
            )
          ]
        });
        
        await sendDM(client, cfg.notifyUserId, {
          embeds: [
            baseEmbed('Uyarı: Kanal Oluşturma - BOTS ROLÜ', 0xff0000).setDescription(
              `${executor} kanal oluşturdu: #${channel.name}\n\n**Aksiyon:** Admin rolleri alındı.`
            )
          ]
        });
        return;
      }
      
      // Bulk kanal guard'ı çalıştır
      await handleBulkChannelGuard({ client, guild: channel.guild, cfg, executorId: entry.executorId });
    }
  } catch (e) {
    console.error(`[CHANNEL_CREATE] Hata:`, e.message);
  }
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  if (!isAllowedGuild(channel.guild)) return;

  // Kanal silmeyi tespit et
  try {
    const logs = await channel.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.ChannelDelete });
    const entry = logs.entries.find(e => e.targetId === channel.id && Date.now() - e.createdTimestamp < 5000);
    
    if (entry && entry.executorId) {
      console.log(`[CHANNEL_DELETE] ${entry.executor?.tag || entry.executorId} sildi: ${channel.name}`);
      
      // Muaf bot ise skip
      if (cfg.exemptBotId && String(entry.executorId) === String(cfg.exemptBotId)) return;
      
      const executor = await channel.guild.members.fetch(entry.executorId).catch((e) => {
        console.log(`[CHANNEL_DELETE] Executor fetch hatası: ${e.message}`);
        return null;
      });
      
      if (!executor) {
        console.log(`[CHANNEL_DELETE] Executor bulunamadı: ${entry.executorId}`);
        return;
      }
      
      console.log(`[CHANNEL_DELETE] Executor rolleri: ${executor.roles.cache.map(r => r.id).join(', ')}`);
      console.log(`[CHANNEL_DELETE] SuperAdmin rol ID: ${cfg.roles.superAdminRoleId}`);
      
      // OWNER ROLÜ ise DIREK ceza
      const ownerRoleId = cfg.roles?.ownerRoleId;
      if (executor.roles.cache.has(ownerRoleId)) {
        console.log(`[CHANNEL_DELETE] OWNER ROLÜ TESPIT - DIREK CEZA`);
        try {
          if (executor.manageable) {
            await executor.roles.remove(ownerRoleId, 'Guard: Kanal silme - Owner rolü');
          }
        } catch (e) {
          console.error(`[CHANNEL_DELETE] Owner rolü alınamadı:`, e.message);
        }
        
        await sendToChannel(client, cfg.logChannels.guard, {
          embeds: [
            baseEmbed('Guard: Kanal Silme - OWNER ROLÜ', 0xff0000).setDescription(
              `${executor} (#${channel.name} sildi)\n\n**Aksiyon:** Owner rolü alındı.`
            )
          ]
        });
        
        await sendDM(client, cfg.notifyUserId, {
          embeds: [
            baseEmbed('Uyarı: Kanal Silme - OWNER ROLÜ', 0xff0000).setDescription(
              `${executor} kanal sildi: #${channel.name}\n\n**Aksiyon:** Owner rolü alındı.`
            )
          ]
        });
        return;
      }
      
      // SuperAdmin'se direk ceza (kanal restore YOK, özel oda sistemi var)
      if (executor.roles.cache.has(cfg.roles.superAdminRoleId)) {
        console.log(`[CHANNEL_DELETE] SuperAdmin tespit edildi, ceza veriliyor...`);
        await punishSuperAdmin(channel.guild, entry.executorId, 'Kanal silme');
        
        await sendToChannel(client, cfg.logChannels.guard, {
          embeds: [baseEmbed('Guard: Kanal Silme (Ceza)', 0xff0000).setDescription(
            `SuperAdmin: ${executor} (#${channel.name} sildi)\n` +
            `Aksiyon: SuperAdmin rolü silindi + tüm admin rolleri alındı\n` +
            `Not: Özel oda sistemi aktif, restore yapılmıyor.`
          )]
        });
        return;
      }
      
      // YT1 kontrolü
      await checkYT1Violation(channel.guild, entry.executorId, 'Kanal silme');
      
      // Bulk kanal guard'ı çalıştır
      await handleBulkChannelGuard({ client, guild: channel.guild, cfg, executorId: entry.executorId });
      
      await sendToChannel(client, cfg.logChannels.guard, {
        embeds: [baseEmbed('Guard: Kanal Silme Tespit', 0xffa500).setDescription(
          `Üye: ${executor} (#${channel.name} sildi)\n` +
          `Aksiyon: YT1 jail 10 dakika\n` +
          `Not: Özel oda sistemi aktif, restore yapılmıyor.`
        )]
      });
    }
  } catch (e) {
    console.error(`[CHANNEL_DELETE] Hata:`, e.message);
  }
});

client.on('roleCreate', async (role) => {
  if (!isAllowedGuild(role.guild)) return;
  
  // Oluşturulan rolü backup'a al (silmeye karşı hazırlık)
  await backupRoleBeforeDelete(role);
  
  // Rol oluşturmayı tespit et
  try {
    const logs = await role.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.RoleCreate });
    const entry = logs.entries.find(e => e.targetId === role.id && Date.now() - e.createdTimestamp < 5000);
    
    if (entry && entry.executorId) {
      console.log(`[ROLE_CREATE] ${entry.executor?.tag || entry.executorId} oluşturdu: ${role.name}`);
      
      // Muaf bot ise skip
      if (cfg.exemptBotId && String(entry.executorId) === String(cfg.exemptBotId)) return;
      
      const executor = await role.guild.members.fetch(entry.executorId).catch((e) => {
        console.log(`[ROLE_CREATE] Executor fetch hatası: ${e.message}`);
        return null;
      });
      
      if (!executor) {
        console.log(`[ROLE_CREATE] Executor bulunamadı: ${entry.executorId}`);
        return;
      }
      
      // Bots rolü için özel guard
      const botsRoleId = cfg.roles?.botsRoleId;
      if (botsRoleId && executor.roles.cache.has(botsRoleId)) {
        await handleRoleCreate({ client, guild: role.guild, cfg, executorId: entry.executorId });
        return;
      }

      // Owner rolü için özel guard
      const ownerRoleId = cfg.roles?.ownerRoleId;
      if (ownerRoleId && executor.roles.cache.has(ownerRoleId)) {
        console.log(`[ROLE_CREATE] OWNER ROLÜ TESPIT - DIREK CEZA`);
        try {
          if (executor.manageable) {
            // Owner rolünü kaldır
            await executor.roles.remove(ownerRoleId, 'Guard: Rol oluşturma - Owner rolü');
          }
        } catch (e) {
          console.error(`[ROLE_CREATE] Owner rolü alınamadı:`, e.message);
        }
        
        await sendToChannel(client, cfg.logChannels.guard, {
          embeds: [
            baseEmbed('Guard: Rol Oluşturma - OWNER ROLÜ', 0xff0000).setDescription(
              `${executor} (@${executor.user.tag}) rol oluşturdu: ${role.name}\n\n**Aksiyon:** Owner rolü alındı.`
            )
          ]
        });
        
        await sendDM(client, cfg.notifyUserId, {
          embeds: [
            baseEmbed('Uyarı: Rol Oluşturma - OWNER ROLÜ', 0xff0000).setDescription(
              `${executor} rol oluşturdu: ${role.name}\n\n**Aksiyon:** Owner rolü alındı.`
            )
          ]
        });
        return;
      }
      
      // SuperAdmin'se direk ceza
      if (executor.roles.cache.has(cfg.roles.superAdminRoleId)) {
        console.log(`[ROLE_CREATE] SuperAdmin tespit edildi, ceza veriliyor...`);
        await punishSuperAdmin(role.guild, entry.executorId, 'Rol oluşturma');
        return;
      }
      
      // Bulk rol guard'ı çalıştır
      await handleBulkRoleGuard({ client, guild: role.guild, cfg, executorId: entry.executorId });
      
      // YT1 kontrolü
      await checkYT1Violation(role.guild, entry.executorId, 'Rol oluşturma');
    }
  } catch {}

  await handleRoleSpamGuard({
    client,
    guild: role.guild,
    cfg,
    type: 'roleCreate',
    auditEvent: AuditLogEvent.RoleCreate,
    targetId: role.id,
    details: `Rol: <@&${role.id}> (${role.name})`
  });
});

client.on('roleDelete', async (role) => {
  if (!isAllowedGuild(role.guild)) return;
  
  // Rol silmeyi tespit et
  try {
    const logs = await role.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.RoleDelete });
    const entry = logs.entries.find(e => e.targetId === role.id && Date.now() - e.createdTimestamp < 5000);
    
    if (entry && entry.executorId) {
      console.log(`[ROLE_DELETE] ${entry.executor?.tag || entry.executorId} sildi: ${role.name}`);
      
      // Muaf bot ise skip
      if (cfg.exemptBotId && String(entry.executorId) === String(cfg.exemptBotId)) return;
      
      const executor = await role.guild.members.fetch(entry.executorId).catch((e) => {
        console.log(`[ROLE_DELETE] Executor fetch hatası: ${e.message}`);
        return null;
      });
      
      if (!executor) {
        console.log(`[ROLE_DELETE] Executor bulunamadı: ${entry.executorId}`);
        return;
      }
      
      console.log(`[ROLE_DELETE] Executor rolleri: ${executor.roles.cache.map(r => r.id).join(', ')}`);
      console.log(`[ROLE_DELETE] SuperAdmin rol ID: ${cfg.roles.superAdminRoleId}`);
      
      // OWNER ROLÜ ise DIREK admin rolleri al
      const ownerRoleId = cfg.roles?.ownerRoleId;
      if (executor.roles.cache.has(ownerRoleId)) {
        console.log(`[ROLE_DELETE] OWNER ROLÜ TESPIT - DIREK CEZA`);
        try {
          if (executor.manageable) {
            await executor.roles.remove(ownerRoleId, 'Guard: Rol silme - Owner rolü');
          }
        } catch (e) {
          console.error(`[ROLE_DELETE] Owner rolü alınamadı:`, e.message);
        }
        
        await sendToChannel(client, cfg.logChannels.guard, {
          embeds: [
            baseEmbed('Guard: Rol Silme - OWNER ROLÜ', 0xff0000).setDescription(
              `${executor} (@${executor.user.tag}) rolü sildi: ${role.name}\n\n**Aksiyon:** Owner rolü alındı.`
            )
          ]
        });
        
        await sendDM(client, cfg.notifyUserId, {
          embeds: [
            baseEmbed('Uyarı: Rol Silme - OWNER ROLÜ', 0xff0000).setDescription(
              `${executor} rolü sildi: ${role.name}\n\n**Aksiyon:** Owner rolü alındı.`
            )
          ]
        });
        return;
      }
      
      // BOTS ROLÜ ise DIREK admin rolleri al (backup almadan)
      const botsRoleId = cfg.roles?.botsRoleId;
      if (executor.roles.cache.has(botsRoleId)) {
        console.log(`[ROLE_DELETE] BOTS ROLÜ TESPIT - DIREK CEZA`);
        const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
        try {
          if (executor.manageable) {
            await executor.roles.remove(adminRoles, 'Guard: Rol silme - Bots rolü');
          }
        } catch (e) {
          console.error(`[ROLE_DELETE] Rol alınamadı:`, e.message);
        }
        
        await sendToChannel(client, cfg.logChannels.guard, {
          embeds: [
            baseEmbed('Guard: Rol Silme - BOTS ROLÜ', 0xff0000).setDescription(
              `${executor} (@${executor.user.tag}) rolü sildi: ${role.name}\n\n**Aksiyon:** Admin rolleri alındı.`
            )
          ]
        });
        
        await sendDM(client, cfg.notifyUserId, {
          embeds: [
            baseEmbed('Uyarı: Rol Silme - BOTS ROLÜ', 0xff0000).setDescription(
              `${executor} rolü sildi: ${role.name}\n\n**Aksiyon:** Admin rolleri alındı.`
            )
          ]
        });
        return;
      }
      
      // SuperAdmin'se direk ceza + rol restore
      if (executor.roles.cache.has(cfg.roles.superAdminRoleId)) {
        console.log(`[ROLE_DELETE] SuperAdmin tespit edildi, ceza veriliyor...`);
        await punishSuperAdmin(role.guild, entry.executorId, 'Rol silme');
        
        // Rol restore
        await handleRoleDeleteRecreate({
          client,
          guild: role.guild,
          cfg,
          role,
          executorId: entry.executorId
        });
        return;
      }
      
      // Bulk rol guard'ı çalıştır
      await handleBulkRoleGuard({ client, guild: role.guild, cfg, executorId: entry.executorId });
      
      // YT1 kontrolü
      await checkYT1Violation(role.guild, entry.executorId, 'Rol silme');
    }
  } catch (e) {
    console.error(`[ROLE_DELETE] Hata:`, e.message);
  }

  await handleRoleSpamGuard({
    client,
    guild: role.guild,
    cfg,
    type: 'roleDelete',
    auditEvent: AuditLogEvent.RoleDelete,
    targetId: role.id,
    details: `Rol: ${role.name} (\`${role.id}\`)`
  });
});

client.on('webhooksUpdate', async (channel) => {
  if (!channel.guild) return;
  if (!isAllowedGuild(channel.guild)) return;
  await handleGuardEvent({
    client,
    guild: channel.guild,
    cfg,
    type: 'webhooksUpdate',
    auditEvent: AuditLogEvent.WebhookCreate, // webhook delete/update için ayrı eventler var; bu log en azından "bir şey oldu" der
    targetId: channel.id,
    details: `Kanal: <#${channel.id}> webhook güncellemesi`
  });
});

// Ses istatistikleri
client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = newState.guild ?? oldState.guild;
  if (!guild) return;
  if (!isAllowedGuild(guild)) return;

  const userId = newState.id ?? oldState.id;
  if (!userId) return;

  // Bot'u saçma kayıtlarından kurtarıyoruz
  if (newState.member?.user?.bot || oldState.member?.user?.bot) return;

  const oldCh = oldState.channelId ?? null;
  const newCh = newState.channelId ?? null;

  // Kanal değişimi yok ise -> sadece mute/deaf/suppress değişti, kaydetme
  if (oldCh === newCh) return;

  const key = `${guild.id}:${userId}`;
  const now = Date.now();

  // Eski kanaldan çıkış: session'ı kapat ve kaydet
  if (oldCh) {
    const sess = voiceSessions.get(key);
    if (sess && sess.channelId === oldCh) {
      const duration = now - sess.startMs;
      // Minimum 5 saniye - sessiz açılması falan kontrol et
      if (duration > 5000) {
        addVoiceDurationSplit(guild.id, userId, oldCh, sess.startMs, now);
      }
    }
    voiceSessions.delete(key);
  }

  // Yeni kanala giriş: session başlat
  if (newCh) {
    voiceSessions.set(key, { channelId: newCh, startMs: now });
  }
});

// Ban olayı - YT1 güvenlik (2+ kişi ban)
client.on('guildBanAdd', async (ban) => {
  if (!isAllowedGuild(ban.guild)) return;

  try {
    const logs = await ban.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberBanAdd });
    const recentBans = logs.entries.filter(e => Date.now() - e.createdTimestamp < 60000);
    
    const executorBans = new Map();
    for (const entry of recentBans) {
      const count = (executorBans.get(entry.executorId) ?? 0) + 1;
      executorBans.set(entry.executorId, count);
    }

    for (const [executorId, count] of executorBans) {
      if (count >= 2) {
        await checkYT1Violation(ban.guild, executorId, `${count} kişi ban atma`);
      }
    }
  } catch {}
});

// Webhook koruma - oluşturma tespit et
client.on('webhooksUpdate', async (channel) => {
  if (!channel.guild) return;
  if (!isAllowedGuild(channel.guild)) return;

  try {
    const logs = await channel.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.WebhookCreate });
    const entry = logs.entries.find(e => e.targetId === channel.id && Date.now() - e.createdTimestamp < 5000);
    
    if (!entry || !entry.executorId) return;
    
    console.log(`[WEBHOOK_CREATE] ${entry.executor?.tag || entry.executorId} webhook oluşturdu`);
    
    // Muaf bot ise skip
    if (cfg.exemptBotId && String(entry.executorId) === String(cfg.exemptBotId)) return;
    
    const executor = await channel.guild.members.fetch(entry.executorId).catch(() => null);
    if (!executor) return;
    
    // Whitelisted ise skip
    const { isWhitelisted } = require('./guard');
    if (isWhitelisted(executor, cfg)) return;
    
    const desc = `Webhook Oluşturma: ${executor} (\`${entry.executorId}\`) webhook oluşturdu.\nKanal: <#${channel.id}>`;
    
    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [baseEmbed('Guard: Webhook Oluşturma Tespit', 0xff0000).setDescription(desc)]
    });
    
    // Admin rolleri al
    const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
    try {
      if (executor.manageable) {
        await executor.roles.remove(adminRoles, 'Guard: Webhook oluşturma');
      }
    } catch {
      await sendToChannel(client, cfg.logChannels.guard, {
        embeds: [baseEmbed('Hata', 0xff0000).setDescription(`${executor} rolü alınamadı (bot yetkisi yetmedi).`)]
      });
    }
    
    await sendDM(client, cfg.notifyUserId, {
      embeds: [
        baseEmbed('Uyarı: Webhook Oluşturma', 0xff0000).setDescription(
          desc + '\n\n**Aksiyon:** Admin rolleri alındı.'
        )
      ]
    });
  } catch (e) {
    console.error('[WEBHOOK_CREATE]', e.message);
  }
});

// Basit güvenlik: botun gerekli intent/perm uyarısı
client.on('warn', (m) => {
  // Deprecation warning'lerini filtrele
  if (m.includes('DEPRECATION') || m.includes('deprecated')) return;
  console.warn('[WARN]', m);
});
client.on('error', (e) => {
  // Gereksiz hata log'larını filtrele
  if (e.message.includes('Unknown interaction')) return;
  console.error('[ERROR]', e.message);
  
  // Bot internal log
  logBotInternal({
    client,
    cfg,
    level: 'ERROR',
    title: 'Bot Hatası',
    message: e.message,
    details: e.stack
  });
});

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN yok. .env dosyasını oluşturup token gir.');
  process.exit(1);
}

console.log('\n🚀 Bot başlatılıyor...\n');
client.login(process.env.DISCORD_TOKEN);
