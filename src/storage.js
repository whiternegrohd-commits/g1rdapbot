const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WARNS_PATH = path.join(DATA_DIR, 'warns.json');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const ACTIVITY_PATH = path.join(DATA_DIR, 'activity.json');
const JAILS_PATH = path.join(DATA_DIR, 'jails.json');
const VIP_PATH = path.join(DATA_DIR, 'vip.json');
const SLEEP_MODE_PATH = path.join(DATA_DIR, 'sleepMode.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(WARNS_PATH)) fs.writeFileSync(WARNS_PATH, JSON.stringify({}), 'utf8');
  if (!fs.existsSync(STATS_PATH)) fs.writeFileSync(STATS_PATH, JSON.stringify({}), 'utf8');
  if (!fs.existsSync(ACTIVITY_PATH)) fs.writeFileSync(ACTIVITY_PATH, JSON.stringify({}), 'utf8');
  if (!fs.existsSync(JAILS_PATH)) fs.writeFileSync(JAILS_PATH, JSON.stringify({}), 'utf8');
  if (!fs.existsSync(VIP_PATH)) fs.writeFileSync(VIP_PATH, JSON.stringify({}), 'utf8');
  if (!fs.existsSync(SLEEP_MODE_PATH)) fs.writeFileSync(SLEEP_MODE_PATH, JSON.stringify({}), 'utf8');
}

function readJson(filePath) {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeJson(filePath, data) {
  ensureDataFile();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getWarns(guildId, userId) {
  const db = readJson(WARNS_PATH);
  return db[guildId]?.[userId] ?? [];
}

function addWarn(guildId, userId, warn) {
  const db = readJson(WARNS_PATH);
  if (!db[guildId]) db[guildId] = {};
  if (!db[guildId][userId]) db[guildId][userId] = [];
  db[guildId][userId].push(warn);
  writeJson(WARNS_PATH, db);
}

function removeWarn(guildId, userId, warnId) {
  const db = readJson(WARNS_PATH);
  const list = db[guildId]?.[userId] ?? [];
  const before = list.length;
  const afterList = list.filter((w) => String(w.id) !== String(warnId));
  if (!db[guildId]) db[guildId] = {};
  db[guildId][userId] = afterList;
  writeJson(WARNS_PATH, db);
  return before !== afterList.length;
}

function clearWarns(guildId, userId) {
  const db = readJson(WARNS_PATH);
  if (!db[guildId]) db[guildId] = {};
  db[guildId][userId] = [];
  writeJson(WARNS_PATH, db);
}

function dayKeyLocal(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function ensureUserDay(db, guildId, userId, dayKey) {
  if (!db[guildId]) db[guildId] = {};
  if (!db[guildId][userId]) db[guildId][userId] = {};
  if (!db[guildId][userId][dayKey]) db[guildId][userId][dayKey] = { voice: {}, messages: {} };
  if (!db[guildId][userId][dayKey].voice) db[guildId][userId][dayKey].voice = {};
  if (!db[guildId][userId][dayKey].messages) db[guildId][userId][dayKey].messages = {};
  return db[guildId][userId][dayKey];
}

function addMessageCount(guildId, userId, channelId, at = new Date()) {
  const db = readJson(ACTIVITY_PATH);
  const day = dayKeyLocal(at);
  const bucket = ensureUserDay(db, guildId, userId, day);
  bucket.messages[channelId] = Number(bucket.messages[channelId] ?? 0) + 1;
  writeJson(ACTIVITY_PATH, db);
}

function addVoiceSecondsDirect(guildId, userId, channelId, dayKey, seconds) {
  if (!seconds || seconds < 1) return;
  try {
    const db = readJson(ACTIVITY_PATH);
    const bucket = ensureUserDay(db, guildId, userId, dayKey);
    const current = Number(bucket.voice[channelId] ?? 0);
    bucket.voice[channelId] = current + Number(seconds);
    writeJson(ACTIVITY_PATH, db);
  } catch (e) {
    console.error(`[VOICE] Yazma hatası ${guildId}/${userId}:`, e.message);
  }
}

function addVoiceDurationSplit(guildId, userId, channelId, startMs, endMs) {
  if (!startMs || !endMs || endMs <= startMs) return;
  
  const totalSeconds = Math.floor((endMs - startMs) / 1000);
  if (totalSeconds < 1) return;
  
  const start = new Date(startMs);
  const end = new Date(endMs);

  let cur = new Date(start);
  cur.setHours(0, 0, 0, 0); // Günün başına ayarla
  
  while (cur < end) {
    const nextDay = new Date(cur);
    nextDay.setDate(nextDay.getDate() + 1); // Sonraki günün başına
    
    const sliceStart = cur > start ? cur : start;
    const sliceEnd = nextDay < end ? nextDay : end;
    
    const seconds = Math.max(0, Math.floor((sliceEnd.getTime() - sliceStart.getTime()) / 1000));
    if (seconds > 1) {
      addVoiceSecondsDirect(guildId, userId, channelId, dayKeyLocal(sliceStart), seconds);
    }
    cur = nextDay;
  }
}

function listLastDays(days = 5) {
  const out = [];
  const now = new Date();
  // Eski günden yeni güne sıralı (geri dönüş için)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(dayKeyLocal(d));
  }
  return out;
}

function getUserSummary(guildId, userId, days = 5) {
  const db = readJson(ACTIVITY_PATH);
  const daysList = listLastDays(days);
  const userDb = db[guildId]?.[userId] ?? {};

  const voice = {};
  const messages = {};

  for (const day of daysList) {
    const bucket = userDb[day];
    if (!bucket) continue;
    for (const [ch, sec] of Object.entries(bucket.voice ?? {})) {
      voice[ch] = Number(voice[ch] ?? 0) + Number(sec ?? 0);
    }
    for (const [ch, c] of Object.entries(bucket.messages ?? {})) {
      messages[ch] = Number(messages[ch] ?? 0) + Number(c ?? 0);
    }
  }

  return { daysList, voice, messages };
}

function getUserDailyStats(guildId, userId, days = 7) {
  const db = readJson(ACTIVITY_PATH);
  const daysList = listLastDays(days);
  const userDb = db[guildId]?.[userId] ?? {};

  const dailyVoice = [];
  const dailyMessages = [];

  for (const day of daysList) {
    const bucket = userDb[day];
    const voiceTotal = bucket ? Object.values(bucket.voice ?? {}).reduce((a, b) => a + Number(b ?? 0), 0) : 0;
    const msgTotal = bucket ? Object.values(bucket.messages ?? {}).reduce((a, b) => a + Number(b ?? 0), 0) : 0;
    dailyVoice.push(Math.floor(voiceTotal / 3600)); // saat cinsinden
    dailyMessages.push(msgTotal);
  }

  return { daysList: daysList.reverse(), dailyVoice: dailyVoice.reverse(), dailyMessages: dailyMessages.reverse() };
}

function getGuildLeaderboard(guildId, days = 5) {
  const db = readJson(ACTIVITY_PATH);
  const daysList = listLastDays(days);
  const guildDb = db[guildId] ?? {};

  const voiceByUser = {}; // userId -> seconds (toplam)
  const msgByUser = {}; // userId -> count (toplam)

  // Her kullanıcı için
  for (const [userId, userDays] of Object.entries(guildDb)) {
    let totalVoice = 0;
    let totalMsg = 0;

    // Son X günü sor
    for (const day of daysList) {
      const bucket = userDays?.[day];
      if (!bucket) continue;

      // Bu günün tüm kanallarından ses topla
      const voiceTotal = Object.values(bucket.voice ?? {}).reduce((a, b) => a + Number(b ?? 0), 0);
      const msgTotal = Object.values(bucket.messages ?? {}).reduce((a, b) => a + Number(b ?? 0), 0);

      totalVoice += voiceTotal;
      totalMsg += msgTotal;
    }

    if (totalVoice > 0) voiceByUser[userId] = totalVoice;
    if (totalMsg > 0) msgByUser[userId] = totalMsg;
  }

  return { daysList, voiceByUser, msgByUser };
}

function setJail(guildId, userId, jailData) {
  const db = readJson(JAILS_PATH);
  if (!db[guildId]) db[guildId] = {};
  db[guildId][userId] = jailData;
  writeJson(JAILS_PATH, db);
}

function getJails(guildId) {
  const db = readJson(JAILS_PATH);
  return db[guildId] ?? {};
}

function removeJail(guildId, userId) {
  const db = readJson(JAILS_PATH);
  if (!db[guildId]) return;
  delete db[guildId][userId];
  writeJson(JAILS_PATH, db);
}

function setVipGrant(guildId, userId, byUserId) {
  const db = readJson(VIP_PATH);
  if (!db[guildId]) db[guildId] = {};
  db[guildId][userId] = { at: Date.now(), by: byUserId ?? null };
  writeJson(VIP_PATH, db);
}

function isVipGranted(guildId, userId) {
  const db = readJson(VIP_PATH);
  return Boolean(db[guildId]?.[userId]);
}

function removeVipGrant(guildId, userId) {
  const db = readJson(VIP_PATH);
  if (!db[guildId]) return;
  delete db[guildId][userId];
  writeJson(VIP_PATH, db);
}

module.exports = {
  getWarns,
  addWarn,
  removeWarn,
  clearWarns,
  dayKeyLocal,
  addMessageCount,
  addVoiceDurationSplit,
  getUserSummary,
  getUserDailyStats,
  getGuildLeaderboard,
  setJail,
  getJails,
  removeJail,
  setVipGrant,
  isVipGranted,
  removeVipGrant,
  setSleepMode(guildId, rolePermissions) {
    const db = readJson(SLEEP_MODE_PATH);
    if (!db[guildId]) db[guildId] = {};
    db[guildId].active = true;
    db[guildId].roles = rolePermissions;
    db[guildId].at = Date.now();
    writeJson(SLEEP_MODE_PATH, db);
  },
  getSleepMode(guildId) {
    const db = readJson(SLEEP_MODE_PATH);
    return db[guildId] ?? null;
  },
  removeSleepMode(guildId) {
    const db = readJson(SLEEP_MODE_PATH);
    if (db[guildId]) delete db[guildId];
    writeJson(SLEEP_MODE_PATH, db);
  },
  getStat(key) {
    const db = readJson(STATS_PATH);
    return Number(db[key] ?? 0);
  },
  incStat(key, delta = 1) {
    const db = readJson(STATS_PATH);
    const next = Number(db[key] ?? 0) + Number(delta ?? 1);
    db[key] = next;
    writeJson(STATS_PATH, db);
    return next;
  }
};
