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

function isWhitelisted(member, cfg) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  
  // Whitelisted user IDs
  if (cfg.whitelistedUserIds?.includes(member.id)) return true;
  
  // Muaf roller - botun asla karışamayacağı
  const exemptRoles = cfg.exemptRoleIds || [];
  if (exemptRoles.some(roleId => member.roles.cache.has(roleId))) return true;
  
  // Hiyerarşi sistemi: Bots (level 4) muaftır
  const botsRoleId = cfg.roles?.botsRoleId;
  if (botsRoleId && member.roles.cache.has(botsRoleId)) return true;
  
  // Guard muafiyeti: üst rollerden muaf
  return member.roles.cache.has(cfg.roles.superAdminRoleId ?? cfg.roles.ownerRoleId);
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
  if (isWhitelisted(member, cfg)) return;

  // Silinen rolün bilgisini backup'tan al
  const backup = deletedRolesBackup.get(role.id);
  if (!backup) {
    console.log(`[ROLE_RESTORE] Backup bulunamadı: ${role.id}`);
    return;
  }

  const desc = `Rol Silme: ${member} (\`${executorId}\`) @${role.name} rolünü sildi.`;

  await sendToChannel(client, cfg.logChannels.guard, {
    embeds: [baseEmbed('Guard: Rol Silme Tespit', 0xff0000).setDescription(desc + '\n\nRol yeniden oluşturuluyor...')]
  });

  // Bots rolü ise admin rolleri al
  const botsRoleId = cfg.roles?.botsRoleId;
  if (member.roles.cache.has(botsRoleId)) {
    const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
    try {
      if (member.manageable) {
        await member.roles.remove(adminRoles, 'Guard: Rol silme girişimi');
      }
    } catch (e) {
      console.error(`[ROLE_DELETE_GUARD] Admin rol alınamadı:`, e.message);
    }

    await sendDM(client, cfg.notifyUserId, {
      embeds: [baseEmbed('Uyarı: Rol Silme Girişimi', 0xff0000).setDescription(
        desc + '\n\n**Aksiyon:** Bots rolü yetkisi alındı.'
      )]
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

async function handleChannelDeleteRecreate({ client, guild, cfg, channel, executorId }) {
  if (!executorId || !cfg.guard?.enabled) return;

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return;
  if (isWhitelisted(member, cfg)) return;

  const botsRoleId = cfg.roles?.botsRoleId;
  if (!member.roles.cache.has(botsRoleId)) return;

  // Tüm rollerin izinlerini kontrol et
  if (hasDangerousPermissions(member)) {
    const desc = `Kanal Silme: ${member} (\`${executorId}\`) #${channel.name} kanalını sildi.`;

    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [baseEmbed('Guard: Kanal Silme - Güvenlik Riski', 0xff0000).setDescription(desc)]
    });

    const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
    try {
      if (member.manageable) {
        await member.roles.remove(adminRoles, 'Guard: Kanal silme - Güvenlik riski');
      }
    } catch {
      await sendToChannel(client, cfg.logChannels.guard, {
        embeds: [baseEmbed('Hata', 0xff0000).setDescription(`${member} rolü alınamadı (bot yetkisi yetmedi).`)]
      });
    }

    await sendDM(client, cfg.notifyUserId, {
      embeds: [baseEmbed('Uyarı: Kanal Silme - Güvenlik Riski', 0xff0000).setDescription(
        desc + '\n\n**Aksiyon:** Üyenin rollerinde tehlikeli izinler tespit edildi, admin rolleri alındı.'
      )]
    });
    return;
  }

  const desc = `Kanal Silme: ${member} (\`${executorId}\`) #${channel.name} kanalını sildi.`;

  await sendToChannel(client, cfg.logChannels.guard, {
    embeds: [baseEmbed('Guard: Kanal Silme (Bots)', 0xff0000).setDescription(desc)]
  });

  const adminRoles = [cfg.roles.superAdminRoleId, cfg.roles.adminRoleId].filter(Boolean);
  try {
    if (member.manageable) {
      await member.roles.remove(adminRoles, 'Guard: Kanal silme girişimi');
    }
  } catch {
    await sendToChannel(client, cfg.logChannels.guard, {
      embeds: [baseEmbed('Hata', 0xff0000).setDescription(`${member} rolü alınamadı (bot yetkisi yetmedi).`)]
    });
  }

  await sendDM(client, cfg.notifyUserId, {
    embeds: [baseEmbed('Uyarı: Kanal Silme Girişimi', 0xff0000).setDescription(
      desc + '\n\n**Aksiyon:** Bots rolü yetkisi alındı.'
    )]
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
  AuditLogEvent
};
