const { PermissionsBitField, AuditLogEvent } = require('discord.js');
const { safeTruncate, baseEmbed, sendToChannel, sendDM, formatMessage } = require('./logger');
const {
  getWarns,
  addWarn,
  removeWarn,
  clearWarns,
  incStat,
  getUserSummary,
  getUserDailyStats,
  getGuildLeaderboard,
  setJail,
  getJails,
  setVipGrant,
  removeVipGrant,
  setSleepMode,
  getSleepMode,
  removeSleepMode
} = require('./storage');
const { releaseMemberFromJail } = require('./jail');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

// DISS CÜMLELERİ - IQ'lu ve Kapsamlı
const dissLines = [
  // Zeka/Mantık Disseri
  "Beynin bi depo gibi boş, raf raf düşün yok",
  "Söylediğin şeyler logic'in yok, kod yazıyor gibi hata dolusu",
  "IQ testin mi yok yoksa kasten mi aptal oynuyorsun?",
  "Düşün dedim, hemen 404 error verdin miydi beyin?",
  "Konuşma her açtığın ağız bir bug açıyor sistemde",
  "Akıl sırasında neredesin? Kaçıncı sırada gittin?",
  "Bilgi saklıyor musun yoksa hiç yok mu?",
  
  // Teknik/Ses Disseri
  "Sesinde okunuyor: bitrate düşük, kode yüksek",
  "Konuştukça sanki kompresyon algoritması çöküyor",
  "Mic'ın AI'a feedback veriyor: 'daha kötüsü yok' diye",
  "Voice'un kalitesi dial-up modem sesine benziyor",
  "Ses frekansın ultrasonic, insanlar duymayacak diye Tanrı yaptı",
  "Decibel ölçeğinde sende negatif değer var",
  
  // Oyun/Skill Disseri
  "Gameplay'in tutorial mod'da bile fail yiyor",
  "Rank'ı account yaşından düşük, daha yeni başladı mı?",
  "Bot'a karşı oynuyorsun ama kaybediyorsun, ne yapıyorsun?",
  "Skill tree'de her punto zeka'ya koymamışsın boşu boşuna",
  "Frags'in negatif sayıda, kendine atıyor musun?",
  "K/D rationu Fibonacci serisinden daha karışık",
  
  // Sosyal Disseri
  "Sosyal becerin offline mode'da çalışmıyor",
  "Arkadaş listesi maintenance modunda permanent",
  "Gruptan kicklenmedin mi? Sorun belki sende midir?",
  "Network'te sen bir corrupted file gibi duruyor",
  "Connection'un herkes tarafından blocked",
  
  // Görünüş Disseri
  "Avatar'ın filter uygulanmış, gerçeğin kötü olmalı",
  "Yüz'ün emoji olmalı, hep aynı expresyon",
  "Banner'ın siyah mı, ruh halinin mi?",
  "Pfp'ni ne zaman değiştireceksin ya?",
  "Fotoğraf arşivinde hiç iyi foto var mı?",
  
  // Kişilik Disseri
  "Pozitif olun dediler, sen negatif oldum",
  "Karakter geliştirmen -100 yolundaydı, başarılı oldun",
  "Kişilik'in debug'a alınması lazım ciddi",
  "Vibe'ın kilogram başına negatif",
  "Enerjin draining, etrafındakileri siyah deliğe çekiyor",
  "Humor'un dark mode'da bile gözükmüyor",
  
  // İnternet/Tech Disseri
  "Internet hızın morse code seviyesinde",
  "Ping'in time machine'e gidiyor kadar yüksek",
  "Download'ında kaç saat bekliyorsun?",
  "WiFi sinyal'inde negatif dB yok mu?",
  "Router'ı kıbleye döndürsem daha iyi sinyal alır",
  "Connection'un dial-up tüpü gibi çıkıyor",
  
  // Genel Saplamalar
  "Hayatin bugged out, developer'a bug report et",
  "Update'in gerekli ama açılmıyorsun",
  "Config'in resetlenmesi gerekiyor ciddi",
  "Optimize et kendini, boşu boşuna CPU harcıyorsun",
  "RAM'in yetmiyor, process'i kapat",
  "System restart gerekli, kapıyı çal kal",
  "Antivirus seni tehdit algıladı",
  "Firewall arkasında gizlen, daha iyi olur",
  "Şifreni değiştir, biri seni crack edebilir",
  "Seni hacklemek değil, diz çöktürmek lazım",
  "Seninle sohbet etmek DDoS attack gibi hissettiriyor",
  "Egona virus bulaştı demek ki",
  "Bios'una reset atsan belki düzelebilir",
  "Driver'ın outdated, güncelleyemez misin?",
  "Keyboard'unda sticky key mi var neyi yazıyorsun?",
  "Touchpad'inde cursor gibi zıplamıyor mu?"
];


// Hiyerarşi seviyesi al
function getHierarchyLevel(member, cfg) {
  if (!member) return 0;
  
  const superAdminRoleId = cfg.roles.superAdminRoleId;
  const botsRoleId = cfg.roles.botsRoleId;
  const ownerRoleId = cfg.roles.ownerRoleId;
  const devRoleId = cfg.roles.devRoleId;
  const modRoleId = cfg.roles.modRoleId;
  
  if (superAdminRoleId && member.roles.cache.has(superAdminRoleId)) return 5;
  if (member.roles.cache.has(botsRoleId)) return 4;
  if (member.roles.cache.has(ownerRoleId)) return 3;
  if (member.roles.cache.has(devRoleId)) return 2;
  if (member.roles.cache.has(modRoleId)) return 1;
  
  return 0;
}

// Target'a işlem yapabilir mi
function canActionTarget(executor, target, cfg) {
  if (!executor || !target) return false;
  
  const executorLevel = getHierarchyLevel(executor, cfg);
  const targetLevel = getHierarchyLevel(target, cfg);
  
  // Aynı seviyedeyse yapamaz
  if (executorLevel <= targetLevel) return false;
  
  return true;
}

function isAdmin(member, cfg) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  
  const level = getHierarchyLevel(member, cfg);
  return level >= 2;
}

function canUseNickSelf(member, cfg) {
  if (!member) return false;
  if (isAdmin(member, cfg)) return true;
  const nickRoleId = cfg.nickRoleId || '1509996059915718736';
  return (
    member.roles.cache.has(nickRoleId) ||
    member.permissions.has(PermissionsBitField.Flags.ChangeNickname) ||
    member.permissions.has(PermissionsBitField.Flags.ManageNicknames)
  );
}

function canUseNickOther(member, cfg) {
  if (!member) return false;
  if (isAdmin(member, cfg)) return true;
  const nickRoleId = cfg.nickRoleId || '1509996059915718736';
  return member.roles.cache.has(nickRoleId);
}

function canUseAdminCommand(member, cfg) {
  if (!member) return false;
  return getHierarchyLevel(member, cfg) >= 2;
}

function canUseBanCommand(member, cfg) {
  if (!member) return false;
  return getHierarchyLevel(member, cfg) >= 3;
  
  return false;
}

function isSuperUser(member) {
  if (!member) return false;
  const ownerId = '588050048882049035';
  return member.id === ownerId;
}


function parseUserFromMessage(message, args) {
  const mention = message.mentions.users.first();
  if (mention) return mention;
  const id = args[0]?.replace(/[<@!>]/g, '');
  if (id && /^\d{16,20}$/.test(id)) return { id };
  return null;
}

function parseDurationMs(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  const m = s.match(/^(\d+)\s*([smhd])$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * mult;
}

function fmtMs(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}g`);
  if (h) parts.push(`${h}s`);
  if (m) parts.push(`${m}d`);
  return parts.length ? parts.join(' ') : `${sec}s`;
}

async function fetchMember(guild, userLike) {
  if (!userLike?.id) return null;
  return guild.members.fetch(userLike.id).catch(() => null);
}

function fmtMs(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}g`);
  if (h) parts.push(`${h}s`);
  if (m) parts.push(`${m}d`);
  return parts.length ? parts.join(' ') : `${sec}s`;
}

function getQuickChartUrl(labels, voiceData, msgData) {
  const chartConfig = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Ses (saat)',
          data: voiceData,
          borderColor: '#5865F2',
          backgroundColor: 'rgba(88, 101, 242, 0.1)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: '#5865F2'
        },
        {
          label: 'Mesaj',
          data: msgData,
          borderColor: '#57F287',
          backgroundColor: 'rgba(87, 242, 135, 0.1)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: '#57F287'
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true, position: 'top' }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  };
  
  const encoded = Buffer.from(JSON.stringify(chartConfig)).toString('base64');
  return `https://quickchart.io/chart?bkg=white&c=${encoded}`;
}

function getTimeAgo(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} gün önce`;
  if (hours > 0) return `${hours} saat önce`;
  if (minutes > 0) return `${minutes} dakika önce`;
  return `${seconds} saniye önce`;
}

function helpText(prefix) {
  return (
    `**Komutlar**\n` +
    `\`${prefix}help\`\n` +
    `\`${prefix}developer\` / \`${prefix}dev\` (bot hakkında)\n` +
    `\`${prefix}snipe\` (silinen mesajı göster)\n` +
    `\`${prefix}b <nick>\` (nick)\n` +
    `\`${prefix}isim @uye <nick>\` (nick)\n` +
    `\`${prefix}say\`\n` +
    `\`${prefix}stat\` / \`${prefix}stat @uye\`\n` +
    `\`${prefix}top\` / \`${prefix}leaderboard\`\n` +
    `\`${prefix}url\`\n` +
    `\`${prefix}diss @uye\` (random diss at)\n` +
    `\`${prefix}fal\` / \`${prefix}günün-sözü\` (tavsiye)\n` +
    `\`${prefix}ship @kişi1 @kişi2\` (ship calculator)\n` +
    `\`${prefix}rollog @uye\` (rol geçmişi)\n` +
    `\`${prefix}jail\` / \`${prefix}j\` (admin)\n` +
    `\`${prefix}unjail\` / \`${prefix}uj\` (admin)\n` +
    `\`${prefix}vip\` (admin)\n` +
    `\`${prefix}unvip\` (admin)\n` +
    `\`${prefix}foto\` (admin)\n` +
    `\`${prefix}emektar\` (admin)\n` +
    `\`${prefix}yt1\` (admin)\n` +
    `\`${prefix}yt2\` (admin)\n` +
    `\`${prefix}fullyt\` (sunucu sahibi / full admin)\n` +
    `\`${prefix}lock\` (admin - kanalı kilitle)\n` +
    `\`${prefix}unlock\` (admin - kanalı aç)\n` +
    `\`${prefix}purge <1-100>\` (Owner rolü: her yerde, diğerleri: commands channel)\n` +
    `\`${prefix}ban @uye [sebep]\`\n` +
    `\`${prefix}forceban <userId> [sebep]\` (sunucudan ayrılmışları da banla)\n` +
    `\`${prefix}unban <userId> [sebep]\` (ban'ı kaldır)\n` +
    `\`${prefix}kick @uye [sebep]\`\n` +
    `\`${prefix}timeout @uye <dakika> [sebep]\`\n` +
    `\`${prefix}untimeout @uye [sebep]\`\n` +
    `\`${prefix}warn @uye [sebep]\`\n` +
    `\`${prefix}warnings @uye\`\n` +
    `\`${prefix}unwarn @uye <warnId>\`\n` +
    `\`${prefix}clearwarns @uye\`\n` +
    `\`${prefix}uykumoduac\` (admin - uyku modu aç)\n` +
    `\`${prefix}uykumodukapat\` (admin - uyku modu kapat)\n` +
    `\`${prefix}topludm\` (sunucu sahibi - toplu DM)\n`
  );
}

async function handleCommand({ client, message, cfg }) {
  if (!message.guild) return;
  if (cfg.guildId && String(message.guild.id) !== String(cfg.guildId)) return;
  if (message.author.bot) return;

  const prefix = cfg.prefix ?? '.';
  if (!message.content.startsWith(prefix)) return;

  const raw = message.content.slice(prefix.length).trim();
  if (!raw) return;

  const parts = raw.split(/\s+/);
  const cmd = (parts.shift() ?? '').toLowerCase();
  const args = parts;
  
  // client'i scope'a al (warn komutu için)
  const _client = client;

  // Tüm kanalda izin verilen komutlar
  const allowedEverywhereCommands = ['snipe', 'say', 'diss'];
  const isAllowedEverywhere = allowedEverywhereCommands.includes(cmd);
  
  // Admin komutları listesi
  const adminCommands = ['warn', 'uyar', 'unwarn', 'uyarikaldir', 'clearwarns', 'uyarisil', 
                         'jail', 'j', 'unjail', 'uj', 'ban', 'forceban', 'unban', 
                         'kick', 'timeout', 'untimeout', 'vip', 'unvip', 'foto', 
                         'emektar', 'yt1', 'yt2', 'yt', 'ytaç', 'lock', 'unlock',
                         'purge', 'temizle', 'uykumoduac', 'uykumodukapat', 'topludm'];
  
  const isAdminCommand = adminCommands.includes(cmd);

  // Kanal kontrolü
  if (cfg.commandsChannelId && message.channelId !== cfg.commandsChannelId && !isAllowedEverywhere) {
    // Commands kanalı dışında ve izin verilen komutlardan değilse
    if (isAdminCommand || !isAllowedEverywhere) {
      // Rolleri kontrol et - sadece belirtilen rollerde diğer komutlar çalışabilir
      const allowedRoles = cfg.commandsAllowedRoles || [];
      const hasRole = allowedRoles.some(roleId => message.member.roles.cache.has(roleId));
      
      if (!hasRole) {
        await message.reply(`❌ Bu komutu sadece <#${cfg.commandsChannelId}> kanalında kullanabilirsin.`);
        return;
      }
    }
  }

  // Herkese açık komutlar
  if (cmd === 'snipe') {
    // Commands.js'den erişim sağlamak için index.js'de tanımlı deletedMessages kullan
    // Basit çözüm: kanal için son silinen mesaj
    const key = `${message.guildId}:${message.channelId}`;
    
    if (!global.deletedMessages) {
      const reply = await message.reply('Bu kanalda silinen mesaj yok.');
      if (cfg.emojis?.error) await reply.react(cfg.emojis.error).catch(() => {});
      return;
    }
    
    const deleted = global.deletedMessages.get(key);
    
    if (!deleted) {
      const reply = await message.reply('Bu kanalda silinen mesaj yok.');
      if (cfg.emojis?.error) await reply.react(cfg.emojis.error).catch(() => {});
      return;
    }

    const timeAgo = Math.floor((Date.now() - deleted.at) / 1000);
    const snipeMsg = formatMessage('🎣', 'Snipe', `${deleted.author.tag}\n${safeTruncate(deleted.content, 500)}\n${timeAgo} saniye önce silindi`);
    const reply = await message.reply(snipeMsg);
    if (cfg.emojis?.success) await reply.react(cfg.emojis.success).catch(() => {});
    return;
  }

  // Herkese açık komutlar
  if (cmd === 'help' || cmd === 'yardim' || cmd === 'y') {
    const fullAdminRoleId = '1510665683275616427';
    const ownerId = '588050048882049035';

    // Sadece sunucu sahibi veya Full Admin görebilir
    if (message.author.id !== ownerId && !message.member.roles.cache.has(fullAdminRoleId)) {
      await message.reply('❌ Bu komutu kullanmak için yetkin yok.');
      return;
    }

    await message.reply({ content: helpText(prefix) });
    if (cfg.emojis?.success) await message.react(cfg.emojis.success).catch(() => {});
    return;
  }
  if (cmd === 'b') {
    if (!canUseNickSelf(message.member, cfg)) {
      await message.reply('Bu komutu kullanmak için nick yetkin yok.');
      return;
    }
    const newNickRaw = args.join(' ').trim();
    if (!newNickRaw) {
      await message.reply('Kullanım: `.b yeniNick` (silmek için: `.b reset`)');
      return;
    }
    const newNick = ['reset', 'sıfır', 'sifir', 'sil'].includes(newNickRaw.toLowerCase()) ? null : safeTruncate(newNickRaw, 32);
    await message.member
      .setNickname(newNick, `Nick değişti: ${message.author.tag}`)
      .then(async () => {
        await message.reply({
          embeds: [
            baseEmbed('✅ NİCK GÜNCELLENDI', 0x00ff00)
              .setThumbnail(message.author.displayAvatarURL({ size: 256 }))
              .setDescription(
                `👤 **Üye:** ${message.author}\n` +
                `📝 **Yeni Nick:** ${newNick || '(Sıfırlandı)'}\n` +
                `⏱️ **Zaman:** ${new Date().toLocaleTimeString('tr-TR')}`
              )
              .setColor(0x00ff00)
          ]
        });
      })
      .catch((e) => message.reply(`❌ Nick değişmedi: ${e.message}`));
    return;
  }
  if (cmd === 'isim' || cmd === 'nick') {
    if (!canUseNickOther(message.member, cfg)) {
      await message.reply('Bu komutu sadece nick rolü olanlar kullanabilir.');
      return;
    }
    const user = parseUserFromMessage(message, args);
    if (!user) {
      await message.reply('Kullanım: `.isim @uye yeniNick`');
      return;
    }
    const newNickRaw = args.slice(1).join(' ').trim();
    if (!newNickRaw) {
      await message.reply('Kullanım: `.isim @uye yeniNick` (silmek için: `reset`)');
      return;
    }
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');
    if (member.roles.cache.has(cfg.roles.superAdminRoleId)) return message.reply('Bu kullanıcı muaf (üst rol).');

    const newNick = ['reset', 'sıfır', 'sifir', 'sil'].includes(newNickRaw.toLowerCase()) ? null : safeTruncate(newNickRaw, 32);
    await member
      .setNickname(newNick, `Nick değişti: ${message.author.tag}`)
      .then(() => {
        message.reply({
          embeds: [
            baseEmbed('✅ NİCK GÜNCELLENDI', 0x00ff00)
              .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
              .setDescription(
                `👤 **Üye:** ${member}\n` +
                `📝 **Yeni Nick:** ${newNick || '(Sıfırlandı)'}\n` +
                `👮 **Yetkili:** ${message.author}`
              )
              .setColor(0x00ff00)
              .setFooter({ text: `${new Date().toLocaleTimeString('tr-TR')}` })
          ]
        });
      })
      .catch((e) => message.reply(`❌ Nick değişmedi: ${e.message}`));
    return;
  }
  if (cmd === 'url') {
    const total = incStat('url', 1);
    
    let inviteLink = '';
    try {
      // Vanity URL'yi getir
      if (message.guild.vanityURLCode) {
        inviteLink = `https://discord.gg/${message.guild.vanityURLCode}`;
      } else {
        // Vanity URL yoksa ilk text kanalın linkini oluştur
        const firstChannel = message.guild.channels.cache
          .filter(ch => ch.isTextBased() && ch.permissionsFor(message.guild.members.me).has('CreateInstantInvite'))
          .first();
        
        if (firstChannel) {
          const invite = await firstChannel.createInvite({ maxAge: 0, maxUses: 0 }).catch(() => null);
          if (invite) inviteLink = invite.url;
        }
      }
    } catch (e) {
      console.error('[URL_CMD] Hata:', e.message);
    }
    
    const urlText = inviteLink ? `Link: ${inviteLink}` : 'Link oluşturulamadı (bot yetkisi yetmedi)';
    const description = `${urlText}\n\n📊 **Toplam Kullanım:** ${total} defa\n👥 **Sunucu:** ${message.guild.memberCount} üye`;
    const urlMsg = formatMessage('🔗', 'Sunucu Linki', description);
    const reply = await message.reply(urlMsg);
    if (cfg.emojis?.success) await reply.react(cfg.emojis.success).catch(() => {});
    return;
  }
  if (cmd === 'stat') {
    const days = 30;
    const parsed = parseUserFromMessage(message, args);
    let targetUser = message.author;
    let mentionLine = `${message.author} (\`${message.author.id}\`)`;
    let thumbUrl = message.author.displayAvatarURL({ size: 256 });
    let titleName = message.author.username;

    if (parsed) {
      const member = await fetchMember(message.guild, parsed);
      if (!member) {
        await message.reply('Üye bulunamadı.');
        return;
      }
      targetUser = member.user;
      mentionLine = `${member} (\`${member.id}\`)`;
      thumbUrl = member.displayAvatarURL({ size: 256 });
      titleName = member.user.username;
    }

    const { voice, messages } = getUserSummary(message.guild.id, targetUser.id, days);
    const { daysList, dailyVoice, dailyMessages } = getUserDailyStats(message.guild.id, targetUser.id, 7);

    const topVoice = Object.entries(voice)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    const topMsg = Object.entries(messages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const fmtDur = (sec) => {
      const s = Number(sec ?? 0);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = Math.floor(s % 60);
      const parts = [];
      if (h) parts.push(`${h}s`);
      if (m) parts.push(`${m}d`);
      parts.push(`${ss}s`);
      return parts.join(' ');
    };

    const totalVoice = topVoice.reduce((acc, [, sec]) => acc + Number(sec ?? 0), 0);
    const totalMsg = topMsg.reduce((acc, [, c]) => acc + Number(c ?? 0), 0);

    const voiceLines = topVoice.length
      ? topVoice.map(([ch, sec]) => `• <#${ch}> : **${fmtDur(sec)}**`).join('\n')
      : 'Veri bulunamadı.';
    const msgLines = topMsg.length
      ? topMsg.map(([ch, c]) => `• <#${ch}> : **${c}** mesaj`).join('\n')
      : 'Veri bulunamadı.';

    await message.reply({
      embeds: [
        baseEmbed(`📊 ${titleName} adlı kullanıcının ${days} günlük istatistikleri`, 0x5865f2)
          .setThumbnail(thumbUrl)
          .setDescription(
            `👤 Kullanıcı: ${mentionLine}\n` +
            `📅 Tarih: ${new Date().toLocaleDateString('tr-TR')}\n` +
            `⏱️ Süre: Son ${days} gün`
          )
          .addFields(
            {
              name: `🎧 Ses Kanal Sıralaması (${fmtDur(totalVoice)})`,
              value: safeTruncate(voiceLines, 1024),
              inline: false
            },
            {
              name: `💬 Mesaj Kanal Sıralaması (${totalMsg} mesaj)`,
              value: safeTruncate(msgLines, 1024),
              inline: false
            }
          )
      ]
    });
    return;
  }
  if (cmd === 'top' || cmd === 'leaderboard' || cmd === 'lb') {
    try {
      // Select menu ile time frame seçimi
      const timeSelectMenu = new StringSelectMenuBuilder()
        .setCustomId('leaderboard_time_select')
        .setPlaceholder('⏱️ Dönem seçin')
        .addOptions(
          { label: 'Son 7 Gün', value: '7', emoji: '📅' },
          { label: 'Son 30 Gün', value: '30', emoji: '📊' },
          { label: 'Son 90 Gün', value: '90', emoji: '📈' }
        );

      const timeRow = new ActionRowBuilder().addComponents(timeSelectMenu);

      // İlk olarak 30 günlük göster
      const days = 30;
      const { voiceByUser, msgByUser } = getGuildLeaderboard(message.guild.id, days);

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

      const reply = await message.reply({
        embeds: [
          baseEmbed(`🏆 GIRDAP LEADERBOARD - Son ${days} Gün`, 0x00b0f4)
            .setDescription(
              `🏢 **Sunucu:** ${message.guild.name}\n` +
              `👥 **Aktif Üyeler:** ${Object.keys({...voiceByUser, ...msgByUser}).length}\n\n` +
              `📊 **İstatistikler:**\n` +
              `🎧 Toplam Ses: **${totalVoiceHours}s** (${(totalVoiceSum / 60).toFixed(0)}d)\n` +
              `💬 Toplam Mesaj: **${totalMsgSum}** mesaj`
            )
            .setImage(voiceChartUrl)
            .addFields(
              { 
                name: '🎧 En Çok Ses Süresi (Top 10)', 
                value: safeTruncate(voiceLines, 1024) || '📭 Veri yok', 
                inline: false 
              }
            )
            .setColor(0x00b0f4)
            .setFooter({ text: `✨ Güncelleme: ${new Date().toLocaleDateString('tr-TR')} ${new Date().toLocaleTimeString('tr-TR')}` })
        ],
        components: [timeRow]
      });

      // İkinci embed mesaj süresi grafiği ile
      await message.channel.send({
        embeds: [
          baseEmbed(`💬 MESAJ SIRALAMASI`, 0x57f287)
            .setImage(msgChartUrl)
            .addFields(
              { 
                name: '💬 En Çok Mesaj (Top 10)', 
                value: safeTruncate(msgLines, 1024) || '📭 Veri yok', 
                inline: false 
              }
            )
            .setColor(0x57f287)
        ]
      });
      
      if (cfg.emojis?.success) await reply.react(cfg.emojis.success).catch(() => {});
    } catch (e) {
      console.error('[LEADERBOARD] Hata:', e.message, e.stack);
      const reply = await message.reply({ content: `❌ Leaderboard hesaplanırken hata oldu: ${e.message}` });
      if (cfg.emojis?.error) await reply.react(cfg.emojis.error).catch(() => {});
    }
    return;
  }
  if (cmd === 'say' || cmd === 'ses') {
    const guild = message.guild;
    const voiceChannels = guild.channels.cache.filter((c) => c && c.isVoiceBased());

    // Toplam üye
    const allMembers = await guild.members.fetch().catch(() => null);
    const totalMembers = allMembers?.size ?? 0;

    // Ses kanallarında aktif
    const voiceMembers = new Map();
    for (const [, ch] of voiceChannels) {
      for (const [, m] of ch.members) {
        voiceMembers.set(m.id, m);
      }
    }
    const voiceActive = voiceMembers.size;

    // AFK (mute veya deaf)
    let afkCount = 0;
    voiceMembers.forEach((m) => {
      if (m.voice?.selfMute || m.voice?.selfDeaf) {
        afkCount++;
      }
    });

    // Aktif konuşan
    const activeCount = voiceActive - afkCount;

    // Kanallar bazında detay
    const channelDetails = [];
    for (const [, channel] of voiceChannels) {
      const members = channel.members.size;
      if (members > 0) {
        channelDetails.push(`🎧 <#${channel.id}> — **${members}** kişi`);
      }
    }

    // Embed oluştur
    const embed = baseEmbed('🎤 SUNUCU SES DURUMU', 0x5865f2)
      .setDescription(
        `**Sunucu:** ${guild.name}\n` +
        `**Tarih:** ${new Date().toLocaleDateString('tr-TR')} • ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`
      )
      .addFields(
        {
          name: '👥 ÜYELER',
          value: `\`\`\`\n⭐ Toplam: ${totalMembers}\n🎧 Ses Aktif: ${voiceActive}\n💬 Konuşan: ${activeCount}\n\`\`\``,
          inline: true
        },
        {
          name: '🔇 DURUMLAR',
          value: `\`\`\`\n🔇 Muted: ${voiceMembers.size > 0 ? [...voiceMembers.values()].filter(m => m.voice?.selfMute).length : 0}\n🤐 Deafened: ${voiceMembers.size > 0 ? [...voiceMembers.values()].filter(m => m.voice?.selfDeaf).length : 0}\n📴 Streaming: ${voiceMembers.size > 0 ? [...voiceMembers.values()].filter(m => m.voice?.streaming).length : 0}\n\`\`\``,
          inline: true
        }
      )
      .setColor(0x5865f2)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .setFooter({ text: `✨ Anlık Görünüm • ${new Date().toLocaleTimeString('tr-TR')}`, iconURL: message.author.displayAvatarURL({ size: 64 }) });

    // Kanal detayları ekle
    if (channelDetails.length > 0) {
      embed.addFields({
        name: '📢 KANAL DAĞILIMI',
        value: channelDetails.slice(0, 10).join('\n') || 'Boş',
        inline: false
      });
    }

    await message.reply({ embeds: [embed] });
    return;
  }

  if (cmd === 'ship') {
    const user1 = parseUserFromMessage(message, args);
    if (!user1 || !args[1]) {
      await message.reply('Kullanım: `.ship @kişi1 @kişi2` veya `.ship <id1> <id2>`');
      return;
    }

    const user2Str = args[1];
    const user2Id = user2Str.replace(/[<@!>]/g, '');
    if (!/^\d{16,20}$/.test(user2Id)) {
      await message.reply('İkinci kişiyi etiketle veya ID yaz.');
      return;
    }

    const member1 = await fetchMember(message.guild, user1);
    const member2 = await fetchMember(message.guild, { id: user2Id });

    if (!member1 || !member2) {
      await message.reply('Bir veya her iki üye bulunamadı.');
      return;
    }

    // 0-100 arası random percentage
    const percentage = Math.floor(Math.random() * 101);

    // Kalp bar: 10 tane (ilk percentage/10 kadarı dolu)
    const fullHearts = Math.round((percentage / 100) * 10);
    const hearts = '❤️'.repeat(fullHearts) + '💔'.repeat(10 - fullHearts);

    // Emoji seçimi percentage'e göre
    let emoji = '💞';
    if (percentage < 20) emoji = '💔';
    else if (percentage < 40) emoji = '💛';
    else if (percentage < 60) emoji = '🧡';
    else if (percentage < 80) emoji = '💜';
    else emoji = '💞';

    const shipMsg = `${member1} ${emoji} ${member2}\n${hearts} (%${percentage})`;
    await message.reply(shipMsg);
    return;
  }

  if (cmd === 'fal' || cmd === 'günün-sözü' || cmd === 'tavsiye') {
    const fortunes = [
      "Gelecek planı yapıp bugünü zehir etme kanka, akışına bırak.",
      "Para vardır ya da yok, huzur en önemli para kanka.",
      "Başarısızlık değil, denememek başarısızlıktır.",
      "Kendin ol, başkaları zaten yapıyor.",
      "Çok stresli olma kanka, hepsi bitti çünkü. Şaka şaka, yeni başlangıçlar var.",
      "Hayat seni yıkar ama sen yeniden inşa et, daha güçlü ol.",
      "Birini seviyorsan söyle kanka, dünyanın sonu olacak mı?",
      "Yanılmaktan korku sen, yanılmaktan öğren.",
      "Bugün yaptığın en küçük şey, yarın büyük etki yapabilir.",
      "Mutsuzluğun sırrı başkalarının hayatını yaşamak kanka.",
      "Her sabah yeni bir şans, kaçırma bunu.",
      "Sessiz kalmak da bir karar, seçimini yap.",
      "Ölene kadar öğrenecek çok şey var, merak et.",
      "Kırmak kolay, ama onarmak güzel hissi veriyor.",
      "Korku, gerçekleşmeden bitmek istediğin şeydir.",
      "Hıçkırarak da gül, ama gül yani.",
      "Yalnızlık kötü değil, yanlış insanlar kötü.",
      "Bugün kötü, yarın iyiye benzese bile, sonrası daha iyi.",
      "Hayal kur ama ayaklarını yere basma.",
      "Evet demek de hayır demek de cesaret istiyor kanka.",
      "Seni sevenler sanat, sevenmeyanlar kız.",
      "Ufak adımlar da adım, koşma ama düşme.",
      "Sabah kalkmak için bir sebep bul, o sebep kendine yeterli.",
      "Geçmiş kapandı, bugün açılı, geleceğe hazırlan.",
      "Gülüş bulaşıcıdır, dağıt etrafına.",
      "En iyi plan, başlamak kanka.",
      "İnsanlar sana hatırlattığın şeyle hatırlanır, iyi seç.",
      "Affetme çünkü iyi insan değiller, affet çünkü sen iyisin.",
      "Hayatın anlamı, anlam verdiğin şeydir.",
      "Beklemek de yaşamak değil, yaşamak için hareket et.",
      "Sessizlik bazen en güçlü cevaptır kanka.",
      "Hata yapmak insan, hata öğrenmekse akıllı olmak.",
      "Bugün ne yapıyorsan, gelecek sana teşekkür edecek.",
      "Kendine söyle, 'ben yapabilirim' ve başla.",
      "Çünkü hayat şimdi, sonra değil.",
      "En büyük zafer, kendi üzerindekileri fethetmektir.",
      "Kaygın düşün ama bu seni paraliz etmesin.",
      "Yalnız hissetme, milyon kişi seninle ruh eşinin aradı.",
      "Başarı, şans değil, çalışma ve sabırlılıktır.",
      "Birileri seni umursamamıyor, ama umursayan var.",
      "Bugün zorluksa, yarın hikaye olacak.",
      "Kendini hiç küçültme, kimse senin boyutunu belirlemez.",
      "Gülmek tedavi eder, kahkaha yapabiliyorsan yapıl.",
      "Asıl cesaret, korkmuş olduğunu bilemiyerek ilerlemektir.",
      "Hayat hikayedir, sen yazarısın.",
      "Uyur iken rüya görürsün, uyanıkken rüya yaşarsın.",
      "Hiçbir şey kalıcı değil, bu da kötü günleri kurtarır.",
      "Sevgi en ucuz ama en pahalı şey kanka.",
      "Bugün zorluksa, sen daha zor işleri de yapabilirsin.",
      "Var olmak bile bir başarıdır kanka, devam et.",
      "Bilen konuşmaz, konuşan bilmez. Sessiz kal bazen.",
      "İnsanlar unutur ama aşk hatırlanır.",
      "Yolunda yürü, geri bakmadan, düşüp kalkmakla ilerliyorsun.",
      "Çünkü sen değerlisin, sana şüphe ettirecek kimse bulmayacaksın.",
      "Güzel şeyler zamanı gelince gelir, acele etme.",
      "Kalbini dinle, beyni çok konuşuyor zaten."
    ];

    const randomFortune = fortunes[Math.floor(Math.random() * fortunes.length)];

    const embed = baseEmbed('🔮 GÜNÜN TAVSİYESİ', 0x9c27b0)
      .setDescription(
        `> "${randomFortune}"\n\n` +
        `✨ *Bugünün kaderiymiş*`
      )
      .setColor(0x9c27b0)
      .setThumbnail(message.author.displayAvatarURL({ size: 256 }))
      .setFooter({ text: `${message.author.username} için • ${new Date().toLocaleTimeString('tr-TR')}` });

    await message.reply({ embeds: [embed] });
    return;
  }

  // Admin gerektiren komutlar
  if (!isAdmin(message.member, cfg) && !isSuperUser(message.member)) {
    await message.reply('Bu komutu kullanmak için yetkin yok.');
    return;
  }

  if (cmd === 'foto') {
    const user = parseUserFromMessage(message, args);
    if (!user) {
      await message.reply('Kullanım: `.foto @uye` veya `.foto <id>`');
      return;
    }
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    const roleId = '1509753644722163742';
    const role = await message.guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      await message.reply('Foto rolü bulunamadı (rol ID yanlış olabilir).');
      return;
    }
    
    const alreadyHas = member.roles.cache.has(roleId);
    if (alreadyHas) {
      await message.reply({ embeds: [baseEmbed('⚠️ BİLGİ', 0xffa500).setDescription(`${member} zaten bu rolü taşıyor.`)] });
      return;
    }
    
    await member.roles.add(roleId, `Foto rolü verildi: ${message.author.tag}`).catch((e) => {
      message.reply(`❌ Rol verilemedi: ${e.message}`);
    });
    
    await message.reply({
      embeds: [
        baseEmbed('✅ FOTO ROLÜ VERİLDİ', 0x00ff00)
          .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
          .setDescription(
            `👤 **Üye:** ${member}\n` +
            `🎭 **Rol:** <@&${roleId}>\n` +
            `👮 **Yetkili:** ${message.author}`
          )
          .setColor(0x00ff00)
          .setFooter({ text: `${new Date().toLocaleTimeString('tr-TR')}` })
      ]
    });
    return;
  }

  if (cmd === 'emektar') {
    const user = parseUserFromMessage(message, args);
    if (!user) {
      await message.reply('Kullanım: `.emektar @uye` veya `.emektar <id>`');
      return;
    }
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    const roleId = '1509939098473857297';
    const role = await message.guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      await message.reply('Emektar rolü bulunamadı (rol ID yanlış olabilir).');
      return;
    }
    
    const alreadyHas = member.roles.cache.has(roleId);
    if (alreadyHas) {
      await message.reply({ embeds: [baseEmbed('⚠️ BİLGİ', 0xffa500).setDescription(`${member} zaten bu rolü taşıyor.`)] });
      return;
    }
    
    await member.roles.add(roleId, `Emektar rolü verildi: ${message.author.tag}`).catch((e) => {
      message.reply(`❌ Rol verilemedi: ${e.message}`);
    });
    
    await message.reply({
      embeds: [
        baseEmbed('✅ EMEKTAR ROLÜ VERİLDİ', 0x00ff00)
          .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
          .setDescription(
            `👤 **Üye:** ${member}\n` +
            `🏆 **Rol:** <@&${roleId}>\n` +
            `👮 **Yetkili:** ${message.author}`
          )
          .setColor(0x00ff00)
          .setFooter({ text: `${new Date().toLocaleTimeString('tr-TR')}` })
      ]
    });
    return;
  }

  if (cmd === 'yt1') {
    const user = parseUserFromMessage(message, args);
    if (!user) {
      await message.reply('Kullanım: `.yt1 @uye` veya `.yt1 <id>`');
      return;
    }
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    const roleId = '1509941362600972329';
    const role = await message.guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      await message.reply('YT1 rolü bulunamadı (rol ID yanlış olabilir).');
      return;
    }
    
    const alreadyHas = member.roles.cache.has(roleId);
    if (alreadyHas) {
      await message.reply({ embeds: [baseEmbed('⚠️ BİLGİ', 0xffa500).setDescription(`${member} zaten bu rolü taşıyor.`)] });
      return;
    }
    
    await member.roles.add(roleId, `YT1 rolü verildi: ${message.author.tag}`).catch((e) => {
      message.reply(`❌ Rol verilemedi: ${e.message}`);
    });
    
    await message.reply({
      embeds: [
        baseEmbed('✅ YT1 ROLÜ VERİLDİ', 0x5865f2)
          .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
          .setDescription(
            `👤 **Üye:** ${member}\n` +
            `🎬 **Rol:** <@&${roleId}>\n` +
            `👮 **Yetkili:** ${message.author}`
          )
          .setColor(0x5865f2)
          .setFooter({ text: `${new Date().toLocaleTimeString('tr-TR')}` })
      ]
    });
    return;
  }

  if (cmd === 'yt2') {
    const user = parseUserFromMessage(message, args);
    if (!user) {
      await message.reply('Kullanım: `.yt2 @uye` veya `.yt2 <id>`');
      return;
    }
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    const roleId = '1509904444853325914';
    const role = await message.guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      await message.reply('YT2 rolü bulunamadı (rol ID yanlış olabilir).');
      return;
    }
    
    const alreadyHas = member.roles.cache.has(roleId);
    if (alreadyHas) {
      await message.reply({ embeds: [baseEmbed('⚠️ BİLGİ', 0xffa500).setDescription(`${member} zaten bu rolü taşıyor.`)] });
      return;
    }
    
    await member.roles.add(roleId, `YT2 rolü verildi: ${message.author.tag}`).catch((e) => {
      message.reply(`❌ Rol verilemedi: ${e.message}`);
    });
    
    await message.reply({
      embeds: [
        baseEmbed('✅ YT2 ROLÜ VERİLDİ', 0x57f287)
          .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
          .setDescription(
            `👤 **Üye:** ${member}\n` +
            `🎥 **Rol:** <@&${roleId}>\n` +
            `👮 **Yetkili:** ${message.author}`
          )
          .setColor(0x57f287)
          .setFooter({ text: `${new Date().toLocaleTimeString('tr-TR')}` })
      ]
    });
    return;
  }

  if (cmd === 'fullyt') {
    const fullAdminRoleId = '1510665683275616427';
    const ownerId = '588050048882049035';

    // Sadece sunucu sahibi veya Full Admin kullanabilir
    if (message.author.id !== ownerId && !message.member.roles.cache.has(fullAdminRoleId)) {
      await message.reply('❌ Bu komutu kullanmak için yetkin yok.');
      return;
    }

    const user = parseUserFromMessage(message, args);
    if (!user) {
      await message.reply('Kullanım: `.fullyt @uye` veya `.fullyt <id>`');
      return;
    }
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    const roleId = '1509707234408398898'; // Owner rolü
    const role = await message.guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      await message.reply('Owner rolü bulunamadı (rol ID yanlış olabilir).');
      return;
    }
    await member.roles.add(roleId, `Owner rolü verildi: ${message.author.tag}`).catch((e) => {
      message.reply(`Rol verilemedi: ${e.message}`);
    });
    await message.reply(`${member} owner rolü verildi.`);
    return;
  }

  if (cmd === 'rollog') {
    const user = parseUserFromMessage(message, args);
    if (!user) {
      await message.reply('Kullanım: `.rollog @uye` veya `.rollog <id>`');
      return;
    }

    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    try {
      // Son 50 role update log'u al
      const logs = await message.guild.fetchAuditLogs({ limit: 50, type: AuditLogEvent.MemberRoleUpdate }).catch(() => null);
      
      if (!logs) {
        return message.reply('Audit log erişilemedi.');
      }

      // Bu üyeye ait rol güncellemelerini filtrele
      const memberLogs = logs.entries.filter(e => e.targetId === member.id);

      // Role change'leri topla (max 5)
      const roleChanges = [];
      for (const entry of memberLogs.slice(0, 20)) {
        if (roleChanges.length >= 5) break;
        
        const changes = entry.changes || [];
        for (const change of changes) {
          if (change.key === '$add' || change.key === '$remove') {
            const roles = change.new || change.old || [];
            for (const roleObj of roles) {
              roleChanges.push({
                roleId: roleObj.id,
                roleName: roleObj.name,
                executor: entry.executor,
                createdAt: entry.createdTimestamp,
                action: change.key === '$add' ? 'add' : 'remove'
              });
              if (roleChanges.length >= 5) break;
            }
          }
          if (roleChanges.length >= 5) break;
        }
      }

      // Şu anki rolleri kontrol et
      const roleLines = roleChanges.map((change, index) => {
        const hasRole = member.roles.cache.has(change.roleId);
        const emoji = hasRole ? '✅' : '❌';
        const timeAgo = getTimeAgo(Date.now() - change.createdAt);
        const executorName = change.executor?.username || 'Bilinmeyen';
        
        return `${emoji} Rol: <@&${change.roleId}> Yetkili: <@${change.executor?.id || '0'}>\n   Tarih: ${timeAgo}`;
      }).join('\n\n');

      const totalRoles = member.roles.cache.size;
      const description = `👤 **${member.user.tag}** kişisinin rol bilgisi (${totalRoles} rol)\n\n${roleLines || 'Rol geçmişi bulunamadı.'}`;

      await message.reply({
        embeds: [
          baseEmbed('📋 ROL LOG', 0x5865f2)
            .setDescription(description)
            .setThumbnail(member.displayAvatarURL({ size: 256 }))
            .setColor(0x5865f2)
            .setFooter({ text: `Sorgulandı: ${new Date().toLocaleString('tr-TR')}` })
        ]
      });
    } catch (e) {
      console.error('[ROLLOG] Hata:', e.message);
      await message.reply(`❌ Rol log getirilirken hata: ${e.message}`);
    }
    return;
  }

  if (cmd === 'vip') {
    const user = parseUserFromMessage(message, args);
    if (!user) {
      await message.reply('Kullanım: `.vip @uye` veya `.vip <id>`');
      return;
    }
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    const roleId = cfg.vipRoleId;
    if (!roleId) {
      await message.reply('VIP rolü ayarlı değil (config.json > vipRoleId).');
      return;
    }
    const role = await message.guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      await message.reply('VIP rolü bulunamadı (rol ID yanlış olabilir).');
      return;
    }

    const alreadyHas = member.roles.cache.has(roleId);
    if (alreadyHas) {
      await message.reply({ embeds: [baseEmbed('⚠️ BİLGİ', 0xffa500).setDescription(`${member} zaten VIP.`)] });
      return;
    }

    try {
      await member.roles.add(roleId, `VIP verildi: ${message.author.tag}`);
      setVipGrant(message.guild.id, member.id, message.author.id);
      
      await message.reply({
        embeds: [
          baseEmbed('✅ VIP ROLÜ VERİLDİ', 0xffd700)
            .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
            .setDescription(
              `👤 **Üye:** ${member}\n` +
              `👑 **Rol:** <@&${roleId}>\n` +
              `👮 **Yetkili:** ${message.author}`
            )
            .setColor(0xffd700)
            .setFooter({ text: `${new Date().toLocaleTimeString('tr-TR')}` })
        ]
      });
    } catch (e) {
      await message.reply(`❌ VIP verilemedi: ${e.message}`);
    }
    return;
  }

  if (cmd === 'unvip') {
    const user = parseUserFromMessage(message, args);
    if (!user) {
      await message.reply('Kullanım: `.unvip @uye` veya `.unvip <id>`');
      return;
    }
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    const roleId = cfg.vipRoleId;
    if (!roleId) {
      await message.reply('VIP rolü ayarlı değil (config.json > vipRoleId).');
      return;
    }

    const hasRole = member.roles.cache.has(roleId);
    if (!hasRole) {
      await message.reply({ embeds: [baseEmbed('⚠️ BİLGİ', 0xffa500).setDescription(`${member} VIP değil.`)] });
      return;
    }

    removeVipGrant(message.guild.id, member.id);
    await member.roles.remove(roleId, `VIP alındı: ${message.author.tag}`).catch((e) => {
      message.reply(`❌ VIP rolü alınamadı: ${e.message}`);
    });
    
    await message.reply({
      embeds: [
        baseEmbed('✅ VIP ROLÜ ALINDI', 0xff0000)
          .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
          .setDescription(
            `👤 **Üye:** ${member}\n` +
            `👮 **Yetkili:** ${message.author}`
          )
          .setColor(0xff0000)
          .setFooter({ text: `${new Date().toLocaleTimeString('tr-TR')}` })
      ]
    });
    return;
  }

  if (cmd === 'jail' || cmd === 'j') {
    if (!canUseAdminCommand(message.member, cfg)) {
      await message.reply('Bu komutu kullanmak için yetkin yok.');
      return;
    }

    const user = parseUserFromMessage(message, args);
    const durStr = args[1];
    if (!user || !durStr) {
      await message.reply('Kullanım: `.jail @uye 5d sebep` (d/h/m/s)');
      return;
    }
    const ms = parseDurationMs(durStr);
    if (!ms) {
      await message.reply('Süre formatı yanlış. Örn: `5d`, `12h`, `30m`');
      return;
    }

    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    // Hiyerarşi kontrolü
    if (!canActionTarget(message.member, member, cfg)) {
      return message.reply('❌ Bu üyeye işlem yapamıyorsun (rütbe sınırı).');
    }

    const jailRoleId = cfg.jailRoleId;
    if (!jailRoleId) {
      await message.reply('Jail rolü ayarlı değil (config.json > jailRoleId).');
      return;
    }

    const reason = safeTruncate(args.slice(2).join(' ') || 'Sebep yok');

    // rollerini kaydet (@everyone hariç)
    const roleIds = member.roles.cache
      .filter((r) => r.id !== member.guild.id)
      .map((r) => r.id);

    // rollerini al + jail rolünü ver
    const until = Date.now() + ms;
    try {
      await member.roles.set([], `Jail: ${reason}`);
    } catch {
      try {
        const keepEveryone = member.roles.cache.filter((r) => r.id === member.guild.id);
        await member.roles.set([...keepEveryone.keys()], `Jail: ${reason}`);
      } catch {}
    }
    await member.roles.add(jailRoleId, `Jail: ${reason}`).catch(() => {});

    setJail(message.guild.id, member.id, {
      until,
      by: message.author.id,
      reason,
      roles: roleIds
    });

    await message.reply(
      `${member} cezalıya atıldı. Süre: **${durStr}** (${fmtMs(ms)}).`
    );
    return;
  }

  if (cmd === 'unjail' || cmd === 'uj') {
    if (!canUseAdminCommand(message.member, cfg)) {
      await message.reply('Bu komutu kullanmak için yetkin yok.');
      return;
    }

    const user = parseUserFromMessage(message, args);
    if (!user) {
      await message.reply('Kullanım: `.unjail @uye [sebep]`');
      return;
    }
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    // Hiyerarşi kontrolü
    if (!canActionTarget(message.member, member, cfg)) {
      return message.reply('❌ Bu üyeye işlem yapamıyorsun (rütbe sınırı).');
    }

    const jails = getJails(message.guild.id);
    const inDb = Boolean(jails[member.id]);
    const hasJailRole = cfg.jailRoleId && member.roles.cache.has(cfg.jailRoleId);
    if (!inDb && !hasJailRole) {
      await message.reply('Bu kullanıcı cezalıda değil.');
      return;
    }

    const reason = safeTruncate(args.slice(1).join(' ') || 'Manuel unjail');
    const { restoredRoles } = await releaseMemberFromJail(
      message.guild,
      member,
      cfg,
      `Unjail: ${reason} (${message.author.tag})`
    );

    const extra = restoredRoles ? ` ${restoredRoles} rol geri verildi.` : '';
    await message.reply(`${member} cezalıdan çıkarıldı.${extra}`);
    return;
  }

  if (cmd === 'purge' || cmd === 'temizle') {
    const n = Number(args[0]);
    const max = cfg.limits?.purgeMax ?? 100;
    if (!Number.isFinite(n) || n < 1 || n > max) {
      await message.reply(`Sayı 1-${max} arasında olmalı.`);
      return;
    }
    const deleted = await message.channel.bulkDelete(n, true).catch(() => null);
    await message.reply(`Silindi: ${deleted?.size ?? 0}`).then((m) => setTimeout(() => m.delete().catch(() => {}), 3000));
    return;
  }

  if (cmd === 'lock') {
    if (!isAdmin(message.member, cfg)) {
      await message.reply('Bu komutu kullanmak için yetkin yok.');
      return;
    }

    const channel = message.channel;
    if (!channel.isTextBased()) {
      await message.reply('Bu komut sadece yazı kanallarında çalışır.');
      return;
    }

    try {
      await channel.permissionOverwrites.edit(message.guild.id, {
        SendMessages: false
      }, `Kanal kilitlendi: ${message.author.tag}`);
      await message.reply('🔒 Kanal kilitlendi.');
    } catch (e) {
      await message.reply(`Kanal kilitlenemedi: ${e.message}`);
    }
    return;
  }

  if (cmd === 'unlock') {
    if (!isAdmin(message.member, cfg)) {
      await message.reply('Bu komutu kullanmak için yetkin yok.');
      return;
    }

    const channel = message.channel;
    if (!channel.isTextBased()) {
      await message.reply('Bu komut sadece yazı kanallarında çalışır.');
      return;
    }

    try {
      await channel.permissionOverwrites.edit(message.guild.id, {
        SendMessages: null
      }, `Kanal açıldı: ${message.author.tag}`);
      await message.reply('🔓 Kanal açıldı.');
    } catch (e) {
      await message.reply(`Kanal açılamadı: ${e.message}`);
    }
    return;
  }

  if (cmd === 'ban') {
    if (!canUseBanCommand(message.member, cfg)) {
      await message.reply('Bu komutu kullanmak için yetkin yok.');
      return;
    }

    const user = parseUserFromMessage(message, args);
    if (!user) return message.reply('Kullanıcı etiketle veya ID yaz.');
    
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    // Hiyerarşi kontrolü
    if (!canActionTarget(message.member, member, cfg)) {
      return message.reply('❌ Bu üyeye işlem yapamıyorsun (rütbe sınırı).');
    }

    const reason = safeTruncate(args.slice(1).join(' ') || 'Sebep yok');

    // Onay modal'ı
    const confirmBtn = new ButtonBuilder()
      .setCustomId(`ban_confirm_${member.id}_${message.author.id}_${Date.now()}`)
      .setLabel('✅ Onayla')
      .setStyle(ButtonStyle.Success);

    const cancelBtn = new ButtonBuilder()
      .setCustomId(`ban_cancel_${Date.now()}`)
      .setLabel('❌ İptal')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

    const confirmEmbed = baseEmbed('⚠️ Ban Onayı', 0xff0000)
      .setDescription(
        `**Üye:** ${member} (\`${member.id}\`)\n` +
        `**Sebep:** ${reason}\n\n` +
        `Devam etmek istediğinize emin misiniz?`
      );

    await message.reply({
      embeds: [confirmEmbed],
      components: [row]
    });
    return;
  }

  if (cmd === 'forceban') {
    if (!canUseBanCommand(message.member, cfg)) {
      await message.reply('Bu komutu kullanmak için yetkin yok.');
      return;
    }

    const userId = args[0]?.replace(/[<@!>]/g, '');
    if (!userId || !/^\d{16,20}$/.test(userId)) {
      await message.reply('Kullanım: `.forceban <userId> [sebep]`\nÖrnek: `.forceban 123456789 spam`');
      return;
    }

    const reason = safeTruncate(args.slice(1).join(' ') || 'Forceban');

    try {
      // ID'yi doğrudan banla
      await message.guild.bans.create(userId, { reason: `Forceban: ${reason}` });

      const modInfo = `${message.author.tag} (\`${message.author.id}\`)`;

      // Başarılı mesaj
      const reply = await message.reply({
        embeds: [
          baseEmbed('🚫 Forceban Başarılı', 0xff0000)
            .setDescription(
              `**Hedef:** \`${userId}\`\n` +
              `**Mod:** ${modInfo}\n` +
              `**Sebep:** ${reason}\n` +
              `**Zamanı:** ${new Date().toLocaleString('tr-TR')}`
            )
        ]
      });

      // Log'a yaz
      await sendToChannel(_client, cfg.logChannels.general, {
        embeds: [
          baseEmbed('🚫 Forceban Uygulandı', 0xff0000)
            .setDescription(
              `**Hedef ID:** \`${userId}\`\n` +
              `**Mod:** ${modInfo}\n` +
              `**Sebep:** ${reason}\n` +
              `**Zamanı:** ${new Date().toLocaleString('tr-TR')}`
            )
        ]
      });
    } catch (e) {
      await message.reply(`❌ Forceban başarısız: ${e.message}`);
    }
    return;
  }

  if (cmd === 'unban') {
    if (!canUseBanCommand(message.member)) {
      await message.reply('Bu komutu kullanmak için yetkin yok.');
      return;
    }

    const userId = args[0]?.replace(/[<@!>]/g, '');
    if (!userId || !/^\d{16,20}$/.test(userId)) {
      await message.reply('Kullanım: `.unban <userId> [sebep]`\nÖrnek: `.unban 123456789 insaf`');
      return;
    }

    const reason = safeTruncate(args.slice(1).join(' ') || 'Unban');

    try {
      // Ban'ı kaldır
      await message.guild.bans.remove(userId, `Unban: ${reason}`);

      const modInfo = `${message.author.tag} (\`${message.author.id}\`)`;

      // Başarılı mesaj
      const reply = await message.reply({
        embeds: [
          baseEmbed('✅ Unban Başarılı', 0x00ff00)
            .setDescription(
              `**Hedef:** \`${userId}\`\n` +
              `**Mod:** ${modInfo}\n` +
              `**Sebep:** ${reason}\n` +
              `**Zamanı:** ${new Date().toLocaleString('tr-TR')}`
            )
        ]
      });

      // Log'a yaz
      await sendToChannel(_client, cfg.logChannels.general, {
        embeds: [
          baseEmbed('✅ Unban Uygulandı', 0x00ff00)
            .setDescription(
              `**Hedef ID:** \`${userId}\`\n` +
              `**Mod:** ${modInfo}\n` +
              `**Sebep:** ${reason}\n` +
              `**Zamanı:** ${new Date().toLocaleString('tr-TR')}`
            )
        ]
      });
    } catch (e) {
      await message.reply(`❌ Unban başarısız: ${e.message}`);
    }
    return;
  }

  if (cmd === 'kick') {
    if (!canUseAdminCommand(message.member, cfg)) {
      await message.reply('Bu komutu kullanmak için yetkin yok.');
      return;
    }

    const user = parseUserFromMessage(message, args);
    if (!user) return message.reply('Kullanıcı etiketle veya ID yaz.');
    
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    // Hiyerarşi kontrolü
    if (!canActionTarget(message.member, member, cfg)) {
      return message.reply('❌ Bu üyeye işlem yapamıyorsun (rütbe sınırı).');
    }

    const reason = safeTruncate(args.slice(1).join(' ') || 'Sebep yok');

    // Onay modal'ı
    const confirmBtn = new ButtonBuilder()
      .setCustomId(`kick_confirm_${member.id}_${message.author.id}_${Date.now()}`)
      .setLabel('✅ Onayla')
      .setStyle(ButtonStyle.Success);

    const cancelBtn = new ButtonBuilder()
      .setCustomId(`kick_cancel_${Date.now()}`)
      .setLabel('❌ İptal')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

    const confirmEmbed = baseEmbed('⚠️ Kick Onayı', 0xff9900)
      .setDescription(
        `**Üye:** ${member} (\`${member.id}\`)\n` +
        `**Sebep:** ${reason}\n\n` +
        `Devam etmek istediğinize emin misiniz?`
      );

    await message.reply({
      embeds: [confirmEmbed],
      components: [row]
    });
    return;
  }

  if (cmd === 'timeout') {
    if (!canUseAdminCommand(message.member, cfg)) {
      await message.reply('Bu komutu kullanmak için yetkin yok.');
      return;
    }

    const user = parseUserFromMessage(message, args);
    if (!user) return message.reply('Kullanıcı etiketle veya ID yaz.');
    const mins = Number(args[1]);
    if (!Number.isFinite(mins) || mins <= 0) return message.reply('Dakika sayısını doğru gir: `.timeout @uye 10 spam`');
    const reason = safeTruncate(args.slice(2).join(' ') || 'Sebep yok');
    
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    // Hiyerarşi kontrolü
    if (!canActionTarget(message.member, member, cfg)) {
      return message.reply('❌ Bu üyeye işlem yapamıyorsun (rütbe sınırı).');
    }

    // Onay modal'ı
    const confirmBtn = new ButtonBuilder()
      .setCustomId(`timeout_confirm_${member.id}_${mins}_${message.author.id}_${Date.now()}`)
      .setLabel('✅ Onayla')
      .setStyle(ButtonStyle.Success);

    const cancelBtn = new ButtonBuilder()
      .setCustomId(`timeout_cancel_${Date.now()}`)
      .setLabel('❌ İptal')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

    const confirmEmbed = baseEmbed('⚠️ Timeout Onayı', 0xff9900)
      .setDescription(
        `**Üye:** ${member} (\`${member.id}\`)\n` +
        `**Sebep:** ${reason}\n` +
        `**Süre:** ${mins} dakika\n\n` +
        `Devam etmek istediğinize emin misiniz?`
      );

    await message.reply({
      embeds: [confirmEmbed],
      components: [row]
    });
    return;
  }

  if (cmd === 'untimeout') {
    if (!canUseAdminCommand(message.member, cfg)) {
      await message.reply('Bu komutu kullanmak için yetkin yok.');
      return;
    }

    const user = parseUserFromMessage(message, args);
    if (!user) return message.reply('Kullanıcı etiketle veya ID yaz.');
    
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    // Hiyerarşi kontrolü
    if (!canActionTarget(message.member, member, cfg)) {
      return message.reply('❌ Bu üyeye işlem yapamıyorsun (rütbe sınırı).');
    }

    const reason = safeTruncate(args.slice(1).join(' ') || 'Sebep yok');
    await member.timeout(null, reason).catch((e) => message.reply(`Timeout kaldırma başarısız: ${e.message}`));
    await message.reply(`${member.user.tag} timeout kaldırıldı. Sebep: ${reason}`);
    return;
  }

  if (cmd === 'warn' || cmd === 'uyar') {
    if (!isAdmin(message.member, cfg)) {
      return message.reply('Bu komutu sadece admin yetkili kullanabilir.');
    }

    const user = parseUserFromMessage(message, args);
    if (!user) return message.reply('Kullanıcı etiketle veya ID yaz.');
    
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    // Hiyerarşi kontrolü
    if (!canActionTarget(message.member, member, cfg)) {
      return message.reply('Bu üyeye işlem yapamıyorsun (rütbe sınırı).');
    }

    const reason = safeTruncate(args.slice(1).join(' ') || 'Sebep yok');
    
    const warn = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      at: Date.now(),
      by: message.author.id,
      reason
    };
    addWarn(message.guild.id, member.id, warn);

    await message.reply(`${member.user.tag} uyarıldı. ID: \`${warn.id}\` Sebep: ${reason}`);

    // Genel log'a da yaz
    const warnMsg = formatMessage('⚠️', 'Uyarı (warn)', `Üye: ${member}\nYetkili: ${message.author}\nID: \`${warn.id}\`\nSebep: ${reason}`);
    await sendToChannel(_client, cfg.logChannels.general, warnMsg);
    return;
  }

  if (cmd === 'warnings' || cmd === 'uyarilar') {
    const user = parseUserFromMessage(message, args);
    if (!user) return message.reply('Kullanıcı etiketle veya ID yaz.');
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');
    const warns = getWarns(message.guild.id, member.id);
    if (!warns.length) return message.reply(`${member.user.tag} için uyarı yok.`);

    const lines = warns
      .slice(-15)
      .map((w) => `• \`${w.id}\` - <@${w.by}> - ${new Date(w.at).toLocaleString('tr-TR')}\n  Sebep: ${w.reason}`);
    await message.reply({ content: `**${member.user.tag} uyarıları**\n${safeTruncate(lines.join('\n'), 1800)}` });
    return;
  }

  if (cmd === 'unwarn' || cmd === 'uyarikaldir') {
    if (!isAdmin(message.member, cfg)) {
      return message.reply('Bu komutu sadece admin yetkili kullanabilir.');
    }

    const user = parseUserFromMessage(message, args);
    const warnId = args[1];
    if (!user || !warnId) return message.reply('Kullanım: `.unwarn @uye <warnId>`');
    
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    // Hiyerarşi kontrolü
    if (!canActionTarget(message.member, member, cfg)) {
      return message.reply('Bu üyeye işlem yapamıyorsun (rütbe sınırı).');
    }

    const ok = removeWarn(message.guild.id, member.id, warnId);
    await message.reply(ok ? 'Uyarı kaldırıldı.' : 'Bu warnId bulunamadı.');
    return;
  }

  if (cmd === 'clearwarns' || cmd === 'uyarisil') {
    if (!isAdmin(message.member, cfg)) {
      return message.reply('Bu komutu sadece admin yetkili kullanabilir.');
    }

    const user = parseUserFromMessage(message, args);
    if (!user) return message.reply('Kullanım: `.clearwarns @uye`');
    
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    // Hiyerarşi kontrolü
    if (!canActionTarget(message.member, member, cfg)) {
      return message.reply('Bu üyeye işlem yapamıyorsun (rütbe sınırı).');
    }

    clearWarns(message.guild.id, member.id);
    await message.reply('Tüm uyarılar temizlendi.');
    return;
  }

  if (cmd === 'girdapwlc') {
    // Kullanıcı izin kontrolü
    const allowedRoles = cfg.girdapwlcAllowedRoles || [];
    const hasPermission = allowedRoles.some(roleId => message.member.roles.cache.has(roleId));
    
    if (!hasPermission) {
      return message.reply('Bu komutu sadece yetkili roller kullanabilir.');
    }

    const user = parseUserFromMessage(message, args);
    if (!user) return message.reply('Kullanım: `.girdapwlc @uye` veya `.girdapwlc <userId>`');
    
    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    const wlcRoles = cfg.girdapwlcRoles || [];
    if (wlcRoles.length === 0) {
      return message.reply('Whitelist rolleri ayarlı değil.');
    }

    const alreadyHasAll = wlcRoles.every(roleId => member.roles.cache.has(roleId));
    if (alreadyHasAll) {
      await message.reply({ embeds: [baseEmbed('⚠️ BİLGİ', 0xffa500).setDescription(`${member} zaten tüm whitelist rollerine sahip.`)] });
      return;
    }

    try {
      await member.roles.add(wlcRoles, `Girdap WLC tarafından yapıldı`);
      const roleList = wlcRoles.map(id => `<@&${id}>`).join(', ');
      
      await message.reply({
        embeds: [
          baseEmbed('✅ WHİTELİST ROLLERI VERİLDİ', 0x00ff00)
            .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
            .setDescription(
              `👤 **Üye:** ${member}\n` +
              `📋 **Roller:**\n${wlcRoles.map(id => `• <@&${id}>`).join('\n')}\n` +
              `👮 **Yetkili:** ${message.author}`
            )
            .setColor(0x00ff00)
            .setFooter({ text: `${new Date().toLocaleTimeString('tr-TR')}` })
        ]
      });
      
      // Log
      const logMsg = formatMessage('✅', 'Whitelist Rolleri Verildi', `Üye: ${member}\nYetkili: ${message.author}\nRoller: ${roleList}`);
      await sendToChannel(_client, cfg.logChannels.general, logMsg);
    } catch (e) {
      await message.reply(`❌ Roller verilemedi: ${e.message}`);
    }
    return;
  }

  if (cmd === 'uykumoduac') {
    const fullAdminRoleId = '1510665683275616427';
    const ownerId = '588050048882049035';
    
    if (message.author.id !== ownerId && !message.member.roles.cache.has(fullAdminRoleId)) {
      await message.reply('Bu komutu sadece Full Admin rolü veya sunucu sahibi kullanabilir.');
      return;
    }

    const yt1RoleId = '1509941362600972329';
    const yt2RoleId = '1509904444853325914';
    const logChannelId = '1509674804175966351';

    try {
      const guild = message.guild;
      const ownerRole = await guild.roles.fetch('1509707234408398898').catch(() => null);
      const yt1Role = await guild.roles.fetch(yt1RoleId).catch(() => null);
      const yt2Role = await guild.roles.fetch(yt2RoleId).catch(() => null);

      if (!ownerRole || !yt1Role || !yt2Role) {
        await message.reply('Roller bulunamadi. Rol ID\'leri kontrol et.');
        return;
      }

      const rolePermissions = {
        owner: { id: '1509707234408398898', permissions: String(ownerRole.permissions.bitfield) },
        yt1: { id: yt1RoleId, permissions: String(yt1Role.permissions.bitfield) },
        yt2: { id: yt2RoleId, permissions: String(yt2Role.permissions.bitfield) }
      };

      console.log('[SLEEP_MODE] Kaydedilecek izinler:', rolePermissions);

      const result1 = await ownerRole.edit({ permissions: [] }, 'Uyku Modu Baslat.').catch((e) => { console.error('[SLEEP_MODE] Owner izin hatasi:', e.message); return false; });
      const result2 = await yt1Role.edit({ permissions: [] }, 'Uyku Modu Baslat.').catch((e) => { console.error('[SLEEP_MODE] YT1 izin hatasi:', e.message); return false; });
      const result3 = await yt2Role.edit({ permissions: [] }, 'Uyku Modu Baslat.').catch((e) => { console.error('[SLEEP_MODE] YT2 izin hatasi:', e.message); return false; });
      
      console.log(`[SLEEP_MODE] İzin sonuclari: Owner=${result1}, YT1=${result2}, YT2=${result3}`);

      setSleepMode(guild.id, rolePermissions);

      const sleepMsg = formatMessage('🔴', 'Uyku Modu Acildi', `Rollerin yetkileri kapatildi:\n• <@&1509707234408398898> (Owner)\n• <@&${yt1RoleId}> (YT1)\n• <@&${yt2RoleId}> (YT2)\n\nKapatmak icin: \`.uykumodukapat\``);
      await message.reply(sleepMsg);

      const logMsg = formatMessage('🔴', 'Uyku Modu Kullanildi', `Kisi: ${message.author}\nSaati: ${new Date().toLocaleString('tr-TR')}\nKanal: <#${message.channelId}>\nIslem: Uyku Modu Acildi\nEtkilenen Roller: Owner, YT1, YT2`);
      await sendToChannel(_client, logChannelId, logMsg);
    } catch (e) {
      console.error('[SLEEP_MODE] Hata:', e.message);
      await message.reply(`Hata: ${e.message}`);
    }
    return;
  }

  if (cmd === 'uykumodukapat') {
    const fullAdminRoleId = '1510665683275616427';
    const ownerId = '588050048882049035';
    
    if (message.author.id !== ownerId && !message.member.roles.cache.has(fullAdminRoleId)) {
      await message.reply('Bu komutu sadece Full Admin rolü veya sunucu sahibi kullanabilir.');
      return;
    }

    const guild = message.guild;
    const logChannelId = '1509674804175966351';

    try {
      const sleepData = getSleepMode(guild.id);
      if (!sleepData || !sleepData.active) {
        await message.reply('Uyku Modu aktif degil.');
        return;
      }

      const { roles } = sleepData;

      const ownerRole = await guild.roles.fetch(roles.owner.id).catch(() => null);
      const yt1Role = await guild.roles.fetch(roles.yt1.id).catch(() => null);
      const yt2Role = await guild.roles.fetch(roles.yt2.id).catch(() => null);

      if (ownerRole) await ownerRole.edit({ permissions: BigInt(roles.owner.permissions) }, 'Uyku Modu Kapatildi').catch(() => {});
      if (yt1Role) await yt1Role.edit({ permissions: BigInt(roles.yt1.permissions) }, 'Uyku Modu Kapatildi').catch(() => {});
      if (yt2Role) await yt2Role.edit({ permissions: BigInt(roles.yt2.permissions) }, 'Uyku Modu Kapatildi').catch(() => {});

      removeSleepMode(guild.id);

      const sleepMsg = formatMessage('🟢', 'Uyku Modu Kapatildi', `Rollerin yetkileri geri verildi:\n• <@&${roles.owner.id}> (Owner)\n• <@&${roles.yt1.id}> (YT1)\n• <@&${roles.yt2.id}> (YT2)`);
      await message.reply(sleepMsg);

      const logMsg = formatMessage('🟢', 'Uyku Modu Kapatildi', `Kisi: ${message.author}\nSaati: ${new Date().toLocaleString('tr-TR')}\nKanal: <#${message.channelId}>\nIslem: Uyku Modu Kapatildi\nEtkilenen Roller: Owner, YT1, YT2`);
      await sendToChannel(_client, logChannelId, logMsg);
    } catch (e) {
      console.error('[SLEEP_MODE] Hata:', e.message);
      await message.reply(`Hata: ${e.message}`);
    }
    return;
  }

  if (cmd === 'diss') {
    const user = parseUserFromMessage(message, args);
    if (!user) {
      await message.reply('Kullanım: `.diss @uye` veya `.diss <id>`');
      return;
    }

    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    // Random diss seç
    const randomDiss = dissLines[Math.floor(Math.random() * dissLines.length)];
    
    const dissMessage = formatMessage('💀', 'Diss Atıldı', `${member}\n\n${randomDiss}`);
    await message.reply(dissMessage);
    return;
  }

  if (cmd === 'diss') {
    const user = parseUserFromMessage(message, args);
    if (!user) {
      await message.reply('Kullanım: `.diss @uye` veya `.diss <id>`');
      return;
    }

    const member = await fetchMember(message.guild, user);
    if (!member) return message.reply('Üye bulunamadı.');

    // Random diss seç
    const randomDiss = dissLines[Math.floor(Math.random() * dissLines.length)];
    
    await message.reply({
      embeds: [
        baseEmbed('💀 DİSS ATILDI', 0xff6b6b)
          .setDescription(`**${member.user.tag}**\n\n"${randomDiss}"`)
          .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
          .setColor(0xff6b6b)
          .setFooter({ text: `🔥 Kıyamet Koptu | ${new Date().toLocaleTimeString('tr-TR')}` })
      ]
    });
    return;
  }

  if (cmd === 'purge' || cmd === 'temizle') {
    // Sunucu sahibi muaf, Owner rolüne her yerde izin, diğerleri sadece commands channel'da
    const ownerId = '588050048882049035';
    const ownerRoleId = '1509707234408398898';
    
    const isSuperUser = message.author.id === ownerId;
    const hasOwnerRole = message.member.roles.cache.has(ownerRoleId);
    
    if (!isSuperUser && !hasOwnerRole) {
      // Sunucu sahibi değil ve Owner rolü yoksa command channel kontrolü
      if (cfg.commandsChannelId && message.channelId !== cfg.commandsChannelId) {
        await message.reply(`❌ Bu komutu sadece <#${cfg.commandsChannelId}> kanalında kullanabilirsin.`);
        return;
      }
    }

    const n = Number(args[0]);
    const max = cfg.limits?.purgeMax ?? 100;
    if (!Number.isFinite(n) || n < 1 || n > max) {
      await message.reply(`Sayı 1-${max} arasında olmalı.`);
      return;
    }

    try {
      const deleted = await message.channel.bulkDelete(n, true).catch(() => null);
      const successMsg = await message.reply(`✅ **${deleted?.size ?? 0}** mesaj silindi.`);
      
      // 3 saniye sonra sil
      setTimeout(() => successMsg.delete().catch(() => {}), 3000);
    } catch (e) {
      await message.reply(`❌ Purge başarısız: ${e.message}`);
    }
    return;
  }

  if (cmd === 'uykumoduac') {
    const ownerId = '588050048882049035';
    const superAdminRoleId = '1524180623852441610';
    
    // Sadece sunucu sahibi veya SuperAdmin rolü
    if (message.author.id !== ownerId && !message.member.roles.cache.has(superAdminRoleId)) {
      await message.reply('❌ Bu komutu sadece sunucu sahibi veya SuperAdmin rolü kullanabilir.');
      return;
    }

    // 3 rolü tanımla
    const roleIds = {
      'Bots': '1527153925013373098',
      'Owner': '1509707234408398898',
      'YT1': '1509941362600972329'
    };

    // Uyarı mesajı gönder
    const warningEmbed = baseEmbed('⚠️ UYARI: UYKU MODU AÇILACAK', 0xff6b6b)
      .setDescription(
        `**Aşağıdaki 3 rolün TÜM yetkileri ve izinleri kapanacak:**\n\n` +
        `🤖 **Bots** Rolü (<@&1527153925013373098>)\n` +
        `👑 **Owner** Rolü (<@&1509707234408398898>)\n` +
        `🎥 **YT1** Rolü (<@&1509941362600972329>)\n\n` +
        `⏱️ Bu roller 10 dakika boyunca **TAMAMEN** pasif kalacak.\n` +
        `✅ Kapatmak için: \`.uykumodukapat\` komutu\n\n` +
        `**Devam etmek istiyor musunuz?**`
      )
      .setColor(0xff6b6b);

    const confirmBtn = new ButtonBuilder()
      .setCustomId(`sleepmode_confirm_${message.author.id}_${Date.now()}`)
      .setLabel('✅ Evet, Aç')
      .setStyle(ButtonStyle.Danger);

    const cancelBtn = new ButtonBuilder()
      .setCustomId(`sleepmode_cancel_${Date.now()}`)
      .setLabel('❌ İptal')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

    await message.reply({
      embeds: [warningEmbed],
      components: [row]
    });
    return;
  }

  if (cmd === 'uykumodukapat') {
    const ownerId = '588050048882049035';
    const superAdminRoleId = '1524180623852441610';
    
    // Sadece sunucu sahibi veya SuperAdmin rolü
    if (message.author.id !== ownerId && !message.member.roles.cache.has(superAdminRoleId)) {
      await message.reply('❌ Bu komutu sadece sunucu sahibi veya SuperAdmin rolü kullanabilir.');
      return;
    }

    await message.reply('✅ Uyku Modu açılmayı bekleyen varsa kontrol et veya manuelde kapamak için rehber iste.');
    return;
  }

  if (cmd === 'topludm') {
    const ownerId = '588050048882049035';
    
    if (message.author.id !== ownerId) {
      await message.reply('Bu komutu sadece sunucu sahibi kullanabilir.');
      return;
    }

    const targetRoles = ['1509707234408398898', '1509941362600972329', '1485694677700051025'];
    const guild = message.guild;
    
    try {
      const members = await guild.members.fetch().catch(() => null);
      if (!members) {
        await message.reply('Üyeler alınamadı.');
        return;
      }

      const dmMessage = `yo öyle yetkilisin chate sa bile yazmıyorsun girdap ailem kocaman kalp <3\ndiscord.gg/girdap`;
      
      let sentCount = 0;
      for (const [, member] of members) {
        // Bot'a mesaj gönderme
        if (member.user.bot) continue;
        
        // Rol kontrolü - hedef rollerden birine sahip mi?
        const hasRole = targetRoles.some(roleId => member.roles.cache.has(roleId));
        if (!hasRole) continue;

        // DM gönder
        await member.send(dmMessage).then(() => {
          sentCount++;
        }).catch(() => {
          // DM gönderilemedi, sessiz geç
        });

        // Rate limit kaçınması için biraz bekle
        await new Promise(r => setTimeout(r, 100));
      }

      const topludmMsg = formatMessage('✅', 'Toplu DM Gönderildi', `${sentCount} kişiye mesaj gönderildi.`);
      await message.reply(topludmMsg);
    } catch (e) {
      console.error('[TOPLUDM] Hata:', e.message);
      await message.reply(`Hata: ${e.message}`);
    }
    return;
  }

  if (cmd === 'developer' || cmd === 'dev') {
    await message.reply({
      embeds: [
        baseEmbed('👨‍💻 BOT HAKKINDA', 0x5865f2)
          .setDescription(`Bu bot **Toprak Demirsoy** tarafından **Girdap Sunucusu** için geliştirilmiştir.`)
          .setColor(0x5865f2)
      ]
    });
    return;
  }

  if (cmd === 'fal' || cmd === 'günün-sözü' || cmd === 'tavsiye') {
    const advices = [
      'Gelecek planı yapıp bugünü zehir etme kanka, akışına bırak.',
      'Başkasının hayatını kıskanmak yerine kendine bak, sen yetersin.',
      'Hata yapmak insanın doğası, başarı onu kabullemekten sonra gelir.',
      'Seni mutlu etmeyen insanlar için vakit harcama, hayat kısa.',
      'Bugün yapacağın bir şey 10 gün sonra yapcağından daha değerli.',
      'Gözlerine bakarak söylediğine inan, başka kimse inanmasa da.',
      'Yalnız olmaktan daha iyi mi? Evet, çünkü sen yetersin.',
      'Sessiz kal ve gözlemle, çünkü akıllılar çok konuşmaz.',
      'İnsanlar seni nasıl görüyor umurunda değilse, o zaman gerçek özgürsün.',
      'Çok bilenlerin hiçbir şeyi yok, hiçbir şey bilmeyenlerin her şeyi var.',
      'Hayat bekleme oyunu değil, hareket oyunu kanka.',
      'Kötü günler gelecek ama sen daha güçlü çıkacaksın.',
      'İsmini yaşat, parayı değil; çünkü para unutulur ama isim kalır.',
      'Sadece sen bilirsin ne içinde var, başkasına gösterme.',
      'Küçük şeyler önemli, büyük hayaller de ama en önemlisi bugün yaşamak.',
      'Düşündüğün kadar iyi misin? Belki de çok daha iyisin.',
      'Zaman hepimizi eşit yönetiyor, onu akıllı kullan.',
      'Kimse senin hikayeyi yazmayacak, sen yaz.',
      'Mutluluk bir destinasyon değil, yolculuğun kendisidir.',
      'Seni anlayan 10 kişi, anlamayan 1000 kişiden daha değerli.',
      'Özür dileme söylediğin için, bunu yapması gerekeni yaptığın için.',
      'Hayal gör ama uyanıkken, o zaman gerçek olur.',
      'Her başarı bir hayatın hikayesidir, senin hikayeni yaz.',
      'Bilgelik soru sormaktan başlar, cevap vermekten değil.',
      'Stres için zamanın yok, vakit kalmamış hedefleriniz için.',
      'Biri seni hayal kırıklığına uğrattıysa, ona aldırma; seni hayal etmedi ki.',
      'Yolda kayıp olmak, yolu bulunmamak kadar kötü değil.',
      'Bir gün olur da bunu anlatırken gülersin, o zaman sabrın değeri anlaşılır.',
      'Adım adım gelmiyorsa koş, durma!',
      'Geçmiş, geçmiş diye hayatını boşa harcama, gelecek beklemiyor.',
      'Paramız olmasa da onurumuz var, ona sahip çık.',
      'Her insanın bir kırılma noktası var, seninki nereye kadar gidecek?',
      'Sessiz olanlar en çok söylüyor, dinlemeyi öğren.',
      'Başarı bir yolculuk, bir varış noktası değil kanka.',
      'İnsanlar seni yargılayacak, sende kendini yargılama.',
      'Aynada gördüğün yüzü sev, çünkü o seni hiç aldatmaz.',
      'Hayat bir imtihan, sınavı geçmen lazım; geçemedin mi tekrar gir.',
      'Kalbini dinle, beyni yalnız bırakma; ikisi birlikte çalış.',
      'Dünya döndükçe sen de dön, yerlerde kalma.',
      'Seninle yarış yapan kişi seninle yarışmaz, başkasıyla kendini kıyaslar.',
      'Yanlış insanlar seni bulur ama doğru insanlar seni seçer.',
      'Rüya görmek güzel ama rüya yaşamak çok daha güzel.',
      'Bir kapı kapanırsa 100 kapı açılır, çıkış bul.',
      'Sorular sorma, kendin bul cevapları; o zaman taş gibi durur.',
      'Acı çeker misin? Güzel, çünkü hala yaşıyorsun demektir.',
      'İyi bir insanın sözü altından vardır, kulak ver.',
      'Kendine söyle: Bundan da güçlü çıkacağım!',
      'Başkasının yaşadığı hayata özenmek yerine, sende hangisi var bak.',
      'Çok seversen çok kaybedersin, ama yaşamak budur kanka.',
      'Hisset, ağla, gül, salla; çünkü bu hayatın tadı budur.',
      'Seni sevenler para için gelir mi? Gelmiyorsa o zaman gerçek sevgi vardır.',
      'Bugün imkansız görünen şey yarın mümkün olur, sabırla bekle.',
      'Her sabah yeni bir başlangıç, geçmişi arkada bırak.',
      'Sessiz olanlar dinlemek için sessiz, gürültüdekiler ise boş konuşmak için.',
      'Senin hikayenin sonu henüz yazılmadı, endişelenme.'
    ];

    const randomAdvice = advices[Math.floor(Math.random() * advices.length)];
    
    await message.reply({
      embeds: [
        baseEmbed('🔮 GÜNÜN TAVSİYESİ', 0x9c27b0)
          .setThumbnail(message.author.displayAvatarURL({ size: 256 }))
          .setDescription(`"${randomAdvice}"`)
          .setColor(0x9c27b0)
          .setFooter({ text: `💭 ${new Date().toLocaleTimeString('tr-TR')}`, iconURL: message.author.displayAvatarURL({ size: 64 }) })
      ]
    });
    return;
  }

  // Bilinmeyen komut - sessiz geç
  return;
}

module.exports = {
  handleCommand,
  isAdmin,
  getHierarchyLevel,
  canActionTarget
};
