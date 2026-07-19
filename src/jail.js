const { getJails, removeJail } = require('./storage');

async function releaseMemberFromJail(guild, member, cfg, auditReason = 'Jail kaldırıldı') {
  const jailRoleId = cfg.jailRoleId;
  const data = getJails(guild.id)[member.id];
  const roles = data?.roles ?? [];

  let jailRemoved = false;
  if (jailRoleId && member.roles.cache.has(jailRoleId)) {
    jailRemoved = await member.roles.remove(jailRoleId, auditReason).then(() => true).catch(() => false);
  }

  const restore = roles.filter(
    (rid) => rid !== jailRoleId && rid !== guild.id && guild.roles.cache.has(rid)
  );
  let rolesRestored = 0;
  if (restore.length) {
    rolesRestored = await member.roles.add(restore, auditReason).then(() => restore.length).catch(() => 0);
  }

  removeJail(guild.id, member.id);
  return { ok: jailRemoved || rolesRestored > 0, restoredRoles: rolesRestored };
}

module.exports = { releaseMemberFromJail };
