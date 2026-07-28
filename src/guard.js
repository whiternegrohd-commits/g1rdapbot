const { AuditLogEvent } = require('discord.js');
const { baseEmbed, sendToChannel, sendDM } = require('./logger');

// executorId -> [{ at, type }]
const actionHistory = new Map();
const roleActionHistory = new Map();
const bulkRoleHistory = new Map();
const bulkChannelHistory = new Map();

// Context menu tracking: executorId -> { bans, timeouts, nickChanges }
const contextMenuTracking = new Map();

// Silinen rolleri track et: roleId -> { name, color, permissions, position, members }
const deletedRolesBackup = new Map();

function trackBulkAction(executorId, type, windowMs = 5000) {
  const now = Date.now();
  const map = type === 'role' ? bulkRoleHistory : bulkChannelHistory;
  
  const list = map.get(executorId) ?? [];
  const cleaned = list.filter((x) => now - x.at <= windowMs);
  cleaned.push({ at: now });
  map.set(executorId, cleaned);
  return cleaned.length;
}

async function tryPunishStripRoles(member, reason) {
  try {
    if (!member.manageable) return false;
    // @everyone hariç tüm roller kaldırmayı dener.
    const keep = member.roles.cache.filter((r) => r.id === member.guild.id);
    await member.roles.set([...keep.keys()], reason);
    return true;
  } catch {
    return false;
  }
}

/**
 * BOTS rolüne sahip birinin bir aksiyon yaptığında direk ceza ver
 */
async function punishBotsRoleUser(member, cfg, action, details = '') {
  try {
    if (!member.manageable) return false;
    
    // Booster rolünü koru - SADECE BUNU TÜTUUU
    const boosterRoleId = '1484308603711262872';
    const toKeep = [];
    
    // Eğer booster rolü varsa tut
    if (member.roles.cache.has(boosterRoleId)) {
      toKeep.push(boosterRoleId);
    }
    
    // @everyone role'ünü tut (her zaman vardır)
    // toKeep dizisinde yoksa ekle - member.guild.id @everyone'dır
    // Discord otomatik olarak @everyone tutar, açıkça set etmeye gerek yok
    
    // Tüm diğer rolleri AL
    await member.roles.set(toKeep, `Guard: BOTS role action - ${action}`);
    console.log(`[GUARD-PUNISH] ${member.user.tag} cezalandırıldı (${action}) - Kalan roller: ${toKeep.join(', ')}`);
    return true;
  } catch (e) {
    console.error(`[GUARD-PUNISH] Hata:`, e.message);
    return false;
  }
}

function isWhitelisted(member, cfg) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  
  // ====== SUPERADMIN COMPLETE EXEMPTION ======
  // SuperAdmin role'ü mutlak muaf - hiç bir guard çalışmaz
  const superAdminRoleId = cfg.roles?.superAdminRoleId || '1524180623852441610';
  if (member.roles.cache.has(superAdminRoleId)) {
    console.log(`[GUARD-EXEMPT] ${member.user.tag} SuperAdmin → tüm guardlardan muaf`);
    return true;
  }
  
  // Whitelisted user IDs
  if (cfg.whitelistedUserIds?.includes(member.id)) return true;
  
  // Muaf roller - botun asla karışamayacağı
  const exemptRoles = cfg.exemptRoleIds || [];
  if (exemptRoles.some(roleId => member.roles.cache.has(roleId))) return true;
  
  return false;
}

// BOTS rolüne sahip mi kontrol et
function isBotsRole(member, cfg) {
  if (!member) return false;
  const botsRoleId = cfg.roles?.botsRoleId;
  return botsRoleId && member.roles.cache.has(botsRoleId);
}

// Tüm rollerinin izinlerini kontrol et
function hasDangerousPermissions(member) {
  if (!member) return false;
  
  // Direkt izinler
  const dangerousPerms = [
    'Administrator',
    'ManageGuild',
    'ManageRoles',
    'ManageChannels',
    'KickMembers',
    'BanMembers',
    'ManageWebhooks',
    'ManageMessages',
    'ModerateMembers'
  ];
  
  // Member'ın izinlerini kontrol et
  for (const perm of dangerousPerms) {
    if (member.permissions.has(perm)) return true;
  }
  
  // Tüm rollerinin izinlerini kontrol et
  for (const [roleId, role] of member.roles.cache) {
    for (const perm of dangerousPerms) {
      if (role.permissions.has(perm)) return true;
    }
  }
  
  return false;
}

async function fetchAuditExecutor(guild, event, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ limit: 5, type: event });
    const entry = logs.entries.find((e) => {
      const sameTarget = e.target?.id ? String(e.target.id) === String(targetId) : true;
      const fresh = Date.now() - e.createdTimestamp < 15_000;
      return fresh && sameTarget;
    });
    if (!entry) return null;
    return { executor: entry.executor, executorId: entry.executorId, reason: entry.reason ?? null };
  } catch {
    return null;
  }
}

async function handleGuardEvent({ client, guild, cfg, type, auditEvent, targetId, details }) {
  if (!cfg.guard?.enabled) return;

  const audit = await fetchAuditExecutor(guild, auditEvent, targetId);
  const executorId = audit?.executorId ?? null;

  // Bulamadıysak sadece loglayalım
  const desc = [
    `Tip: **${type}**`,
    executorId ? `Yapan: <@${executorId}> (\`${executorId}\`)` : 'Yapan: (audit log bulunamadı)',
    details ? `Detay: ${details}` : null
  ]
    .filter(Boolean)
    .join('\n');

  await sendToChannel(client, cfg.logChannels.guard, {
    embeds: [baseEmbed('Guard: Şüpheli işlem', 0xffa500).setDescription(desc)]
  });

  if (!executorId) return;
  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return;
  if (isWhitelisted(member, cfg)) return;

  const count = addHistory(executorId, type, cfg.guard.windowMs ?? 15000);
  const max = cfg.guard.maxActions ?? 3;

  if (count >= max) {
    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [
        baseEmbed('Guard: Limit aşıldı', 0xff0000).setDescription(
          `Kullanıcı: ${member} (\`${executorId}\`)\n` +
            `Son ${cfg.guard.windowMs ?? 15000}ms içinde **${count}** işlem.`
        )
      ]
    });

    if (cfg.guard.punish) {
      await tryPunishStripRoles(member, `Guard limit aşıldı: ${type}`);
    }
  }
}

async function notifyChannelChangeDM({ client, guild, cfg, type, auditEvent, targetId, details }) {
  const audit = await fetchAuditExecutor(guild, auditEvent, targetId);
  const executorId = audit?.executorId ?? null;

  const desc = [
    `Tip: **${type}**`,
    executorId ? `Yapan: <@${executorId}> (\`${executorId}\`)` : 'Yapan: (audit log bulunamadı)',
    details ? `Detay: ${details}` : null
  ]
    .filter(Boolean)
    .join('\n');

  await sendDM(client, cfg.notifyUserId, {
    embeds: [baseEmbed('Bildirim: Kanal işlemi', 0x00b0f4).setDescription(desc)]
  });
}

async function handleRoleSpamGuard({ client, guild, cfg, type, auditEvent, targetId, details }) {
  if (!cfg.guard?.enabled) return;

  const audit = await fetchAuditExecutor(guild, auditEvent, targetId);
  const executorId = audit?.executorId ?? null;
  if (!executorId) return;

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return;
  if (isWhitelisted(member, cfg)) return;

  const count = (() => {
    const now = Date.now();
    const list = roleActionHistory.get(executorId) ?? [];
    const cleaned = list.filter((x) => now - x.at <= (cfg.guard.windowMs ?? 15000));
    cleaned.push({ at: now, type });
    roleActionHistory.set(executorId, cleaned);
    return cleaned.length;
  })();

  const max = cfg.guard.maxActions ?? 3;
  if (count <= max) return;

  roleActionHistory.delete(executorId);

  const desc = [
    `Tip: **${type}**`,
    `Yapan: ${member} (\`${executorId}\`)`,
    details ? `Detay: ${details}` : null,
    `Son ${cfg.guard.windowMs ?? 15000}ms içinde **${count}** rol işlemi.`
  ]
    .filter(Boolean)
    .join('\n');

  await sendToChannel(client, cfg.logChannels.guard, {
    embeds: [baseEmbed('Guard: Rol spam limiti', 0xff0000).setDescription(desc)]
  });

  let punished = false;
  if (cfg.guard.punish) {
    punished = await tryPunishStripRoles(member, `Role spam guard: ${count} işlem`);
  }

  await sendDM(client, cfg.notifyUserId, {
    embeds: [
      baseEmbed('Bildirim: Rol spam tespit', cfg.guard.punish ? 0xff0000 : 0xffa500).setDescription(
        desc + (cfg.guard.punish ? `\nAksiyon: ${punished ? 'Üstteki roller alındı' : 'Rol alınamadı (bot yetkisi yetmedi olabilir)'}` : '\nAksiyon: Sadece log (ceza kapalı)')
      )
    ]
  });
}

// Context Menu Guards

function getContextMenuTracker(executorId) {
  if (!contextMenuTracking.has(executorId)) {
    contextMenuTracking.set(executorId, {
      bans: [],
      timeouts: [],
      nickChanges: []
    });
  }
  return contextMenuTracking.get(executorId);
}

function trackContextMenuAction(executorId, actionType, windowMs = 60000) {
  const now = Date.now();
  const tracker = getContextMenuTracker(executorId);
  const list = tracker[actionType] ?? [];
  const cleaned = list.filter((x) => now - x.at <= windowMs);
  cleaned.push({ at: now });
  tracker[actionType] = cleaned;
  return cleaned.length;
}

async function handleContextMenuBan({ client, guild, cfg, executorId, targetId }) {
  if (!executorId || !cfg.guard?.enabled) return;

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return;
  if (isWhitelisted(member, cfg)) return;

  const count = trackContextMenuAction(executorId, 'bans', 60000);

  const desc = `Sağ Tık Ban: ${member} (\`${executorId}\`) tarafından <@${targetId}> banlandı.\nSon 1 dakikada **${count}** ban işlemi.`;

  await sendToChannel(client, cfg.logChannels.guard, {
    embeds: [baseEmbed('Guard: Sağ Tık Ban', 0xff6b6b).setDescription(desc)]
  });

  // 3+ ban -> tüm admin rolleri al
  if (count >= 3) {
    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [
        baseEmbed('Guard: Sağ Tık Ban Limiti', 0xff0000).setDescription(
          `${member} sağ tıkla 3 kişi banlama yaptı. Admin rolleri alınıyor...`
        )
      ]
    });

    const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
    try {
      if (member.manageable) {
        await member.roles.remove(adminRoles, 'Guard: Sağ tık 3+ ban');
      }
    } catch {
      await sendToChannel(client, cfg.logChannels.guard, {
        embeds: [baseEmbed('Hata', 0xff0000).setDescription(`${member} rolü alınamadı (bot yetkisi yetmedi).`)]
      });
    }

    await sendDM(client, cfg.notifyUserId, {
      embeds: [baseEmbed('Uyarı: Sağ Tık Ban Limiti', 0xff0000).setDescription(desc + '\n\n**Aksiyon:** Admin rolleri alındı.')]
    });
  }
}

async function handleContextMenuTimeout({ client, guild, cfg, executorId, targetId }) {
  if (!executorId || !cfg.guard?.enabled) return;

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return;
  if (isWhitelisted(member, cfg)) return;

  const count = trackContextMenuAction(executorId, 'timeouts', 60000);

  const desc = `Sağ Tık Timeout: ${member} (\`${executorId}\`) tarafından <@${targetId}> timeout atıldı.\nSon 1 dakikada **${count}** timeout işlemi.`;

  await sendToChannel(client, cfg.logChannels.guard, {
    embeds: [baseEmbed('Guard: Sağ Tık Timeout', 0xffa500).setDescription(desc)]
  });

  // 2+ timeout -> tüm admin rolleri al
  if (count >= 2) {
    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [
        baseEmbed('Guard: Sağ Tık Timeout Limiti', 0xff0000).setDescription(
          `${member} sağ tıkla 2+ kişiye timeout attı. Admin rolleri alınıyor...`
        )
      ]
    });

    const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
    try {
      if (member.manageable) {
        await member.roles.remove(adminRoles, 'Guard: Sağ tık 2+ timeout');
      }
    } catch {
      await sendToChannel(client, cfg.logChannels.guard, {
        embeds: [baseEmbed('Hata', 0xff0000).setDescription(`${member} rolü alınamadı (bot yetkisi yetmedi).`)]
      });
    }

    await sendDM(client, cfg.notifyUserId, {
      embeds: [baseEmbed('Uyarı: Sağ Tık Timeout Limiti', 0xff0000).setDescription(desc + '\n\n**Aksiyon:** Admin rolleri alındı.')]
    });
  }
}

async function handleContextMenuNickChange({ client, guild, cfg, executorId }) {
  if (!executorId || !cfg.guard?.enabled) return;

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return;
  if (isWhitelisted(member, cfg)) return;

  const count = trackContextMenuAction(executorId, 'nickChanges', 60000);

  const desc = `Sağ Tık Nick Değişimi: ${member} (\`${executorId}\`) tarafından yapıldı.\nSon 1 dakikada **${count}** nick değişimi.`;

  // 5+ nick change -> sadece uyarı, ceza yok
  if (count >= 5) {
    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [baseEmbed('Guard: Sağ Tık Nick Değişimi Limiti', 0xffa500).setDescription(desc)]
    });

    await sendDM(client, cfg.notifyUserId, {
      embeds: [baseEmbed('Uyarı: Sağ Tık Nick Limiti', 0xffa500).setDescription(desc + '\n\n**Aksiyon:** Uyarı (ceza yok)')]
    });
  }
}

async function handleRoleDeleteRecreate({ client, guild, cfg, role, executorId }) {
  if (!executorId || !cfg.guard?.enabled) return;

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return;
  
  // ====== SUPERADMIN COMPLETE EXEMPTION ======
  const superAdminRoleId = cfg.roles?.superAdminRoleId || '1524180623852441610';
  if (member.roles.cache.has(superAdminRoleId)) {
    // Guard log'a detaylı embed
    const exemptEmbed = createGuardEmbed(
      '🛡️ Guard: Rol Silme (Muaf)',
      `${formatMemberWithRoles(member)}\n\n**Rol:** @${role.name} (${role.id})\n**İşlem:** Silindi`,
      0x00ff00,
      [
        {
          name: '🔰 Muafiyet Nedeni',
          value: `SuperAdmin rolü: <@&${superAdminRoleId}>`,
          inline: false
        },
        {
          name: '⚠️ Aksiyon',
          value: '**Bot hiç bir işlem yapamadı** - SuperAdmin kullanıcı guarddan tamamen muaftır',
          inline: false
        },
        {
          name: '📝 Not',
          value: `Zaman: ${new Date().toLocaleString('tr-TR')}\nBot muaf kişilere işlem uygulayamaz.`,
          inline: false
        }
      ]
    );
    
    await sendToChannel(client, cfg.logChannels.guard, { embeds: [exemptEmbed] });
    
    // DM'e bilgi mesajı
    await sendDM(client, cfg.notifyUserId, {
      embeds: [createGuardEmbed(
        '✅ Guard: İşlem Yapılamadı (Muaf)',
        `${formatMemberWithRoles(member)}\n\n**İşlem:** @${role.name} rolünü sildi\n\n⚠️ **Sonuç:** Bot muaf kişiye işlem uygulayamadı`,
        0x00ff00,
        [
          {
            name: '🔰 Muafiyet Sebebi',
            value: `SuperAdmin rolü (${superAdminRoleId})`,
            inline: false
          },
          {
            name: '📌 Bilgi',
            value: 'SuperAdmin rolüne sahip kişiler tüm guard sistemlerinden muaftırlar. Bot hiç bir işlem uygulayamaz.',
            inline: false
          }
        ]
      )]
    });
    
    console.log(`[GUARD-EXEMPT] ${member.user.tag} SuperAdmin → rol silme muaf`);
    return;
  }
  
  if (isWhitelisted(member, cfg)) return;

  // Silinen rolün bilgisini backup'tan al
  const backup = deletedRolesBackup.get(role.id);
  if (!backup) {
    console.log(`[ROLE_RESTORE] Backup bulunamadı: ${role.id}`);
    return;
  }

  const detectEmbed = createGuardEmbed(
    '🔍 Guard: Rol Silme Tespit Edildi',
    `${formatMemberWithRoles(member)}\n\n**Rol:** @${role.name}\n**İşlem:** Silmeye çalıştı`,
    0xff0000,
    [
      {
        name: '🔄 Aksiyon',
        value: '✓ Rol otomatik olarak yeniden oluşturuluyor...',
        inline: false
      },
      {
        name: '📋 Detaylar',
        value: `Sunucu: ${guild.name}\nZaman: ${new Date().toLocaleString('tr-TR')}`,
        inline: false
      }
    ]
  );

  await sendToChannel(client, cfg.logChannels.guard, { embeds: [detectEmbed] });

  // Bots rolü ise admin rolleri al
  const botsRoleId = cfg.roles?.botsRoleId;
  if (member.roles.cache.has(botsRoleId)) {
    const botsPunishEmbed = createGuardEmbed(
      '⚠️ Guard: Rol Silme - Bots Cezası',
      `${formatMemberWithRoles(member)}\n\n**Rol:** @${role.name}\n**İşlem:** Silmeye çalıştı`,
      0xff0000,
      [
        {
          name: '🔨 Aksiyon Alındı',
          value: '✓ Bots rolü kaldırıldı',
          inline: false
        },
        {
          name: '📋 Detaylar',
          value: `Sunucu: ${guild.name}\nZaman: ${new Date().toLocaleString('tr-TR')}`,
          inline: false
        }
      ]
    );

    const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
    try {
      if (member.manageable) {
        await member.roles.remove(adminRoles, 'Guard: Rol silme girişimi');
      }
    } catch (e) {
      console.error(`[ROLE_DELETE_GUARD] Admin rol alınamadı:`, e.message);
    }

    await sendDM(client, cfg.notifyUserId, {
      embeds: [botsPunishEmbed]
    });
    return;
  }

  // Tüm rollerin izinlerini kontrol et
  if (hasDangerousPermissions(member)) {
    const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
    try {
      if (member.manageable) {
        await member.roles.remove(adminRoles, 'Guard: Güvenlik riski - Rol silme');
      }
    } catch (e) {
      console.error(`[ROLE_DELETE_GUARD] Rol alınamadı:`, e.message);
    }

    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [
        baseEmbed('Guard: Rol Silme - Güvenlik Riski', 0xff0000).setDescription(
          desc + '\n\n**Aksiyon:** Tehlikeli izne sahip olduğu için admin rolleri alındı.'
        )
      ]
    });

    await sendDM(client, cfg.notifyUserId, {
      embeds: [baseEmbed('Uyarı: Rol Silme - Güvenlik Riski', 0xff0000).setDescription(
        desc + '\n\n**Aksiyon:** Üyenin rollerinde tehlikeli izinler tespit edildi, admin rolleri alındı.'
      )]
    });
    return;
  }

  // Diğer kullanıcılar için standart guard
  const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
  try {
    if (member.manageable) {
      await member.roles.remove(adminRoles, 'Guard: Rol silme');
    }
  } catch (e) {
    console.error(`[ROLE_RESTORE] Admin rol alınamadı:`, e.message);
  }

  // Rolü yeniden oluştur
  try {
    const newRole = await guild.roles.create({
      name: backup.name,
      color: backup.color,
      permissions: backup.permissions,
      position: backup.position,
      hoist: backup.hoist,
      mentionable: backup.mentionable
    });

    // Tüm üyelere rolü geri ver
    const members = backup.members || [];
    let successCount = 0;
    let failCount = 0;

    for (const memberId of members) {
      try {
        const memberToUpdate = await guild.members.fetch(memberId).catch(() => null);
        if (memberToUpdate && memberToUpdate.manageable) {
          await memberToUpdate.roles.add(newRole, 'Guard: Rol restore');
          successCount++;
        }
      } catch {
        failCount++;
      }
    }

    deletedRolesBackup.delete(role.id);

    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [
        baseEmbed('Guard: Rol Yeniden Oluşturuldu', 0x00ff00).setDescription(
          `Rol: <@&${newRole.id}> (@${newRole.name})\n` +
            `Renk: ${backup.color ? `#${backup.color.toString(16).toUpperCase().padStart(6, '0')}` : 'Varsayılan'}\n` +
            `Üyelere geri verilen: **${successCount}** (başarısız: ${failCount})\n` +
            `Silme yapan: ${member} | Admin rolleri alındı.`
        )
      ]
    });

    await sendDM(client, cfg.notifyUserId, {
      embeds: [
        baseEmbed('Bildirim: Rol Silme & Restore', 0xff0000).setDescription(
          desc +
            `\n\n**Aksiyon:**\n` +
            `- Rol yeniden oluşturuldu: <@&${newRole.id}>\n` +
            `- Tüm önceki üyelere geri verildi (${successCount}/${successCount + failCount})\n` +
            `- ${member} admin rolleri alındı.`
        )
      ]
    });
  } catch (e) {
    console.error(`[ROLE_RESTORE] Hata:`, e.message);
    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [baseEmbed('Hata: Rol Yeniden Oluşturulamadı', 0xff0000).setDescription(e.message)]
    });
  }
}

async function backupRoleBeforeDelete(role) {
  try {
    const members = [];
    for (const [memberId, member] of role.guild.members.cache) {
      if (member.roles.cache.has(role.id)) {
        members.push(memberId);
      }
    }

    deletedRolesBackup.set(role.id, {
      name: role.name,
      color: role.color,
      permissions: role.permissions.bitfield,
      position: role.position,
      hoist: role.hoist,
      mentionable: role.mentionable,
      members
    });

    console.log(`[ROLE_BACKUP] Backup alındı: ${role.name} (${members.length} üye)`);
  } catch (e) {
    console.error(`[ROLE_BACKUP] Hata:`, e.message);
  }
}

function formatMemberWithRoles(member) {
  if (!member) return '(Bilinmiyor)';
  
  const roles = member.roles.cache
    .filter(r => r.id !== member.guild.id) // @everyone hariç
    .sort((a, b) => b.position - a.position) // Position'a göre sırala
    .slice(0, 5) // İlk 5 rol
    .map(r => `<@&${r.id}>`)
    .join(' ');
  
  const roleStr = roles ? roles : '(Rol yok)';
  
  return `${member} (${member.user.tag})\n**Rolleri:** ${roleStr}`;
}

function createGuardEmbed(title, description, color = 0xff0000, fields = []) {
  const embed = baseEmbed(title, color)
    .setDescription(description)
    .setTimestamp(Date.now());
  
  if (fields.length > 0) {
    embed.addFields(...fields);
  }
  
  return embed;
}

async function handleChannelDeleteRecreate({ client, guild, cfg, channel, executorId }) {
  if (!executorId || !cfg.guard?.enabled) return;

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return;
  
  // ====== SUPERADMIN COMPLETE EXEMPTION ======
  const superAdminRoleId = cfg.roles?.superAdminRoleId || '1524180623852441610';
  if (member.roles.cache.has(superAdminRoleId)) {
    // Guard log'a detaylı embed
    const exemptEmbed = createGuardEmbed(
      '🛡️ Guard: Kanal Silme (Muaf)',
      `${formatMemberWithRoles(member)}\n\n**Kanal:** #${channel.name} (${channel.id})\n**İşlem:** Silindi`,
      0x00ff00,
      [
        {
          name: '🔰 Muafiyet Nedeni',
          value: `SuperAdmin rolü: <@&${superAdminRoleId}>`,
          inline: false
        },
        {
          name: '⚠️ Aksiyon',
          value: '**Bot hiç bir işlem yapamadı** - SuperAdmin kullanıcı guarddan tamamen muaftır',
          inline: false
        },
        {
          name: '📝 Not',
          value: `Zaman: ${new Date().toLocaleString('tr-TR')}\nBot muaf kişilere işlem uygulayamaz.`,
          inline: false
        }
      ]
    );
    
    await sendToChannel(client, cfg.logChannels.guard, { embeds: [exemptEmbed] });
    
    // DM'e bilgi mesajı
    await sendDM(client, cfg.notifyUserId, {
      embeds: [createGuardEmbed(
        '✅ Guard: İşlem Yapılamadı (Muaf)',
        `${formatMemberWithRoles(member)}\n\n**İşlem:** #${channel.name} kanalını sildi\n\n⚠️ **Sonuç:** Bot muaf kişiye işlem uygulayamadı`,
        0x00ff00,
        [
          {
            name: '🔰 Muafiyet Sebebi',
            value: `SuperAdmin rolü (${superAdminRoleId})`,
            inline: false
          },
          {
            name: '📌 Bilgi',
            value: 'SuperAdmin rolüne sahip kişiler tüm guard sistemlerinden muaftırlar. Bot hiç bir işlem uygulayamaz.',
            inline: false
          }
        ]
      )]
    });
    
    console.log(`[GUARD-EXEMPT] ${member.user.tag} SuperAdmin → kanal silme muaf`);
    return;
  }
  
  if (isWhitelisted(member, cfg)) return;

  const botsRoleId = cfg.roles?.botsRoleId;
  if (!member.roles.cache.has(botsRoleId)) return;

  // Tüm rollerin izinlerini kontrol et
  if (hasDangerousPermissions(member)) {
    const punishEmbed = createGuardEmbed(
      '🚨 Guard: Kanal Silme - Güvenlik Riski',
      `${formatMemberWithRoles(member)}\n\n**Kanal:** #${channel.name}\n**İşlem:** Silmeye çalıştı`,
      0xff0000,
      [
        {
          name: '⚠️ Risk Tespit Edildi',
          value: '✗ Tehlikeli izinler: ManageGuild, ManageRoles, ManageChannels',
          inline: false
        },
        {
          name: '🔨 Aksiyon Alındı',
          value: '✓ Tüm admin rolleri kaldırıldı',
          inline: false
        },
        {
          name: '📋 Detaylar',
          value: `Sunucu: ${guild.name}\nZaman: ${new Date().toLocaleString('tr-TR')}`,
          inline: false
        }
      ]
    );

    await sendToChannel(client, cfg.logChannels.guard, { embeds: [punishEmbed] });

    const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
    try {
      if (member.manageable) {
        await member.roles.remove(adminRoles, 'Guard: Kanal silme - Güvenlik riski');
      }
    } catch {
      await sendToChannel(client, cfg.logChannels.guard, {
        embeds: [createGuardEmbed('❌ Hata', `${member} rolü alınamadı (bot yetkisi yetmedi).`, 0xff0000)]
      });
    }

    await sendDM(client, cfg.notifyUserId, {
      embeds: [punishEmbed]
    });
    return;
  }

  const warnEmbed = createGuardEmbed(
    '⚠️ Guard: Kanal Silme Tespit',
    `${formatMemberWithRoles(member)}\n\n**Kanal:** #${channel.name}\n**İşlem:** Silmeye çalıştı`,
    0xff0000,
    [
      {
        name: '🔍 Tespit',
        value: '✗ Bots rolü kullanarak kanal silmeye çalışıldı',
        inline: false
      },
      {
        name: '🔨 Aksiyon Alındı',
        value: '✓ Bots rolü kaldırıldı',
        inline: false
      },
      {
        name: '📋 Detaylar',
        value: `Sunucu: ${guild.name}\nZaman: ${new Date().toLocaleString('tr-TR')}`,
        inline: false
      }
    ]
  );

  await sendToChannel(client, cfg.logChannels.guard, { embeds: [warnEmbed] });

  const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
  try {
    if (member.manageable) {
      await member.roles.remove(adminRoles, 'Guard: Kanal silme girişimi');
    }
  } catch {
    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [createGuardEmbed('❌ Hata', `${member} rolü alınamadı (bot yetkisi yetmedi).`, 0xff0000)]
    });
  }

  await sendDM(client, cfg.notifyUserId, {
    embeds: [warnEmbed]
  });
}

async function handleRoleCreate({ client, guild, cfg, executorId }) {
  if (!executorId || !cfg.guard?.enabled) return;

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return;
  if (isWhitelisted(member, cfg)) return;

  const botsRoleId = cfg.roles?.botsRoleId;
  if (!member.roles.cache.has(botsRoleId)) return;

  // Tüm rollerin izinlerini kontrol et
  if (hasDangerousPermissions(member)) {
    const desc = `Rol Oluşturma: ${member} (\`${executorId}\`) yeni bir rol oluşturdu.`;

    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [baseEmbed('Guard: Rol Oluşturma - Güvenlik Riski', 0xff0000).setDescription(desc)]
    });

    const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
    try {
      if (member.manageable) {
        await member.roles.remove(adminRoles, 'Guard: Rol oluşturma - Güvenlik riski');
      }
    } catch {
      await sendToChannel(client, cfg.logChannels.guard, {
        embeds: [baseEmbed('Hata', 0xff0000).setDescription(`${member} rolü alınamadı (bot yetkisi yetmedi).`)]
      });
    }

    await sendDM(client, cfg.notifyUserId, {
      embeds: [baseEmbed('Uyarı: Rol Oluşturma - Güvenlik Riski', 0xff0000).setDescription(
        desc + '\n\n**Aksiyon:** Üyenin rollerinde tehlikeli izinler tespit edildi, admin rolleri alındı.'
      )]
    });
    return;
  }

  const desc = `Rol Oluşturma: ${member} (\`${executorId}\`) yeni bir rol oluşturdu.`;

  await sendToChannel(client, cfg.logChannels.guard, {
    embeds: [baseEmbed('Guard: Rol Oluşturma (Bots)', 0xff0000).setDescription(desc)]
  });

  const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
  try {
    if (member.manageable) {
      await member.roles.remove(adminRoles, 'Guard: Rol oluşturma girişimi');
    }
  } catch {
    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [baseEmbed('Hata', 0xff0000).setDescription(`${member} rolü alınamadı (bot yetkisi yetmedi).`)]
    });
  }

  await sendDM(client, cfg.notifyUserId, {
    embeds: [baseEmbed('Uyarı: Rol Oluşturma Girişimi', 0xff0000).setDescription(
      desc + '\n\n**Aksiyon:** Bots rolü yetkisi alındı.'
    )]
  });
}

async function handleGuildUpdate({ client, guild, cfg, oldGuild, executorId }) {
  if (!executorId || !cfg.guard?.enabled) return;

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return;
  if (isWhitelisted(member, cfg)) return;

  const botsRoleId = cfg.roles?.botsRoleId;
  if (!member.roles.cache.has(botsRoleId)) return;

  // Sunucu ayarlarında değişiklik tespit et
  const changes = [];
  if (oldGuild?.name !== guild.name) changes.push(`İsim: ${oldGuild?.name} → ${guild.name}`);
  if (oldGuild?.icon !== guild.icon) changes.push(`İcon değiştirildi`);
  if (oldGuild?.owner?.id !== guild.owner?.id) changes.push(`Sahip değiştirildi`);
  if (oldGuild?.systemChannelId !== guild.systemChannelId) changes.push(`Sistem kanalı değiştirildi`);

  if (changes.length === 0) return;

  // Tüm rollerin izinlerini kontrol et
  if (hasDangerousPermissions(member)) {
    const desc = `Sunucu Ayarları Değiştirildi: ${member} (\`${executorId}\`) tarafından.\n\nDeğişiklikler:\n${changes.map(c => `- ${c}`).join('\n')}`;

    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [baseEmbed('Guard: Sunucu Ayarları - Güvenlik Riski', 0xff0000).setDescription(desc)]
    });

    const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
    try {
      if (member.manageable) {
        await member.roles.remove(adminRoles, 'Guard: Sunucu ayarları değişikliği - Güvenlik riski');
      }
    } catch {
      await sendToChannel(client, cfg.logChannels.guard, {
        embeds: [baseEmbed('Hata', 0xff0000).setDescription(`${member} rolü alınamadı (bot yetkisi yetmedi).`)]
      });
    }

    await sendDM(client, cfg.notifyUserId, {
      embeds: [baseEmbed('Uyarı: Sunucu Ayarları - Güvenlik Riski', 0xff0000).setDescription(
        desc + '\n\n**Aksiyon:** Üyenin rollerinde tehlikeli izinler tespit edildi, admin rolleri alındı.'
      )]
    });
    return;
  }

  const desc = `Sunucu Ayarları Değiştirildi: ${member} (\`${executorId}\`) tarafından.\n\nDeğişiklikler:\n${changes.map(c => `- ${c}`).join('\n')}`;

  await sendToChannel(client, cfg.logChannels.guard, {
    embeds: [baseEmbed('Guard: Sunucu Ayarları Değişikliği (Bots)', 0xff0000).setDescription(desc)]
  });

  const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
  try {
    if (member.manageable) {
      await member.roles.remove(adminRoles, 'Guard: Sunucu ayarları değişikliği');
    }
  } catch {
    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [baseEmbed('Hata', 0xff0000).setDescription(`${member} rolü alınamadı (bot yetkisi yetmedi).`)]
    });
  }

  await sendDM(client, cfg.notifyUserId, {
    embeds: [baseEmbed('Uyarı: Sunucu Ayarları Değişikliği', 0xff0000).setDescription(
      desc + '\n\n**Aksiyon:** Bots rolü yetkisi alındı.'
    )]
  });
}

async function handleBulkRoleGuard({ client, guild, cfg, executorId }) {
  if (!executorId || !cfg.guard?.enabled) return;

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return;
  if (isWhitelisted(member, cfg)) return;

  const count = trackBulkAction(executorId, 'role', 5000);
  
  if (count < 3) return;

  const desc = `Bulk Rol İşlemi: ${member} (\`${executorId}\`) 5 saniyede **${count}** rol işlemi yaptı.`;

  await sendToChannel(client, cfg.logChannels.guard, {
    embeds: [baseEmbed('Guard: Bulk Rol İşlemi Tespit', 0xff0000).setDescription(desc)]
  });

  const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
  try {
    if (member.manageable) {
      await member.roles.remove(adminRoles, 'Guard: Bulk rol işlemi');
    }
  } catch {
    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [baseEmbed('Hata', 0xff0000).setDescription(`${member} rolü alınamadı.`)]
    });
  }

  await sendDM(client, cfg.notifyUserId, {
    embeds: [baseEmbed('Uyarı: Bulk Rol İşlemi', 0xff0000).setDescription(
      desc + '\n\n**Aksiyon:** Admin rolleri alındı.'
    )]
  });

  bulkRoleHistory.delete(executorId);
}

async function handleBulkChannelGuard({ client, guild, cfg, executorId }) {
  if (!executorId || !cfg.guard?.enabled) return;

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return;
  if (isWhitelisted(member, cfg)) return;

  const count = trackBulkAction(executorId, 'channel', 5000);
  
  if (count < 3) return;

  const desc = `Bulk Kanal İşlemi: ${member} (\`${executorId}\`) 5 saniyede **${count}** kanal işlemi yaptı.`;

  await sendToChannel(client, cfg.logChannels.guard, {
    embeds: [baseEmbed('Guard: Bulk Kanal İşlemi Tespit', 0xff0000).setDescription(desc)]
  });

  const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
  try {
    if (member.manageable) {
      await member.roles.remove(adminRoles, 'Guard: Bulk kanal işlemi');
    }
  } catch {
    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [baseEmbed('Hata', 0xff0000).setDescription(`${member} rolü alınamadı.`)]
    });
  }

  await sendDM(client, cfg.notifyUserId, {
    embeds: [baseEmbed('Uyarı: Bulk Kanal İşlemi', 0xff0000).setDescription(
      desc + '\n\n**Aksiyon:** Admin rolleri alındı.'
    )]
  });

  bulkChannelHistory.delete(executorId);
}
module.exports = {
  handleGuardEvent,
  notifyChannelChangeDM,
  handleRoleSpamGuard,
  handleContextMenuBan,
  handleContextMenuTimeout,
  handleContextMenuNickChange,
  handleRoleDeleteRecreate,
  backupRoleBeforeDelete,
  trackContextMenuAction,
  handleRoleCreate,
  handleGuildUpdate,
  handleBulkRoleGuard,
  handleBulkChannelGuard,
  trackBulkAction,
  hasDangerousPermissions,
  handleChannelDeleteRecreate,
  isWhitelisted,
  isBotsRole,
  punishBotsRoleUser,
  AuditLogEvent
};



// Export'a isBotsRole ve punishBotsRoleUser ekle