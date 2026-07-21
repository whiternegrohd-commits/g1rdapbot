const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'girdap.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize tables
function initializeDatabase() {
  // Users activity table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      total_messages INTEGER DEFAULT 0,
      total_voice_seconds INTEGER DEFAULT 0,
      total_camera_seconds INTEGER DEFAULT 0,
      total_stream_seconds INTEGER DEFAULT 0,
      UNIQUE(guild_id, user_id, date)
    );
    
    CREATE INDEX IF NOT EXISTS idx_user_activity_guild_user ON user_activity(guild_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_user_activity_date ON user_activity(date);
  `);

  // Voice sessions tracking (for bot restart protection)
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      session_start INTEGER NOT NULL,
      session_type TEXT NOT NULL,
      UNIQUE(guild_id, user_id, session_type)
    );
    
    CREATE INDEX IF NOT EXISTS idx_voice_sessions_user ON voice_sessions(guild_id, user_id);
  `);

  // AFK channels configuration
  db.exec(`
    CREATE TABLE IF NOT EXISTS afk_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      UNIQUE(guild_id, channel_id)
    );
  `);
}

// Helper functions
function getTodayDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getOrCreateUserDay(guildId, userId, date = getTodayDate()) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO user_activity (guild_id, user_id, date)
    VALUES (?, ?, ?)
  `);
  stmt.run(guildId, userId, date);
  
  return db.prepare(`
    SELECT * FROM user_activity 
    WHERE guild_id = ? AND user_id = ? AND date = ?
  `).get(guildId, userId, date);
}

function addMessageCount(guildId, userId, count = 1) {
  const userDay = getOrCreateUserDay(guildId, userId);
  const newCount = (userDay.total_messages || 0) + count;
  
  db.prepare(`
    UPDATE user_activity 
    SET total_messages = ?
    WHERE guild_id = ? AND user_id = ? AND date = ?
  `).run(newCount, guildId, userId, getTodayDate());
}

function addVoiceSeconds(guildId, userId, seconds) {
  if (!seconds || seconds < 1) return;
  
  const userDay = getOrCreateUserDay(guildId, userId);
  const newTotal = (userDay.total_voice_seconds || 0) + Math.floor(seconds);
  
  db.prepare(`
    UPDATE user_activity 
    SET total_voice_seconds = ?
    WHERE guild_id = ? AND user_id = ? AND date = ?
  `).run(newTotal, guildId, userId, getTodayDate());
}

function addCameraSeconds(guildId, userId, seconds) {
  if (!seconds || seconds < 1) return;
  
  const userDay = getOrCreateUserDay(guildId, userId);
  const newTotal = (userDay.total_camera_seconds || 0) + Math.floor(seconds);
  
  db.prepare(`
    UPDATE user_activity 
    SET total_camera_seconds = ?
    WHERE guild_id = ? AND user_id = ? AND date = ?
  `).run(newTotal, guildId, userId, getTodayDate());
}

function addStreamSeconds(guildId, userId, seconds) {
  if (!seconds || seconds < 1) return;
  
  const userDay = getOrCreateUserDay(guildId, userId);
  const newTotal = (userDay.total_stream_seconds || 0) + Math.floor(seconds);
  
  db.prepare(`
    UPDATE user_activity 
    SET total_stream_seconds = ?
    WHERE guild_id = ? AND user_id = ? AND date = ?
  `).run(newTotal, guildId, userId, getTodayDate());
}

function startVoiceSession(guildId, userId, channelId, sessionType = 'voice') {
  const now = Date.now();
  
  db.prepare(`
    INSERT OR REPLACE INTO voice_sessions (guild_id, user_id, channel_id, session_start, session_type)
    VALUES (?, ?, ?, ?, ?)
  `).run(guildId, userId, channelId, now, sessionType);
}

function endVoiceSession(guildId, userId, sessionType = 'voice') {
  const session = db.prepare(`
    SELECT * FROM voice_sessions 
    WHERE guild_id = ? AND user_id = ? AND session_type = ?
  `).get(guildId, userId, sessionType);
  
  if (!session) return 0;
  
  const duration = Math.floor((Date.now() - session.session_start) / 1000);
  
  db.prepare(`
    DELETE FROM voice_sessions 
    WHERE guild_id = ? AND user_id = ? AND session_type = ?
  `).run(guildId, userId, sessionType);
  
  return duration;
}

function getUserStats(guildId, userId, days = 30) {
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  
  const rows = db.prepare(`
    SELECT * FROM user_activity 
    WHERE guild_id = ? AND user_id = ? AND date IN (${dates.map(() => '?').join(',')})
  `).all(guildId, userId, ...dates);
  
  let totalMessages = 0;
  let totalVoice = 0;
  let totalCamera = 0;
  let totalStream = 0;
  
  rows.forEach(row => {
    totalMessages += row.total_messages || 0;
    totalVoice += row.total_voice_seconds || 0;
    totalCamera += row.total_camera_seconds || 0;
    totalStream += row.total_stream_seconds || 0;
  });
  
  return { totalMessages, totalVoice, totalCamera, totalStream };
}

function getLeaderboard(guildId, category = 'genel', days = 30) {
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  
  let query, orderField;
  
  switch (category) {
    case 'mesaj':
      orderField = 'SUM(total_messages)';
      break;
    case 'ses':
      orderField = 'SUM(total_voice_seconds)';
      break;
    case 'kamera':
      orderField = 'SUM(total_camera_seconds)';
      break;
    case 'yayın':
      orderField = 'SUM(total_stream_seconds)';
      break;
    case 'genel':
    default:
      orderField = 'SUM(total_messages) + SUM(total_voice_seconds) + SUM(total_camera_seconds) + SUM(total_stream_seconds)';
      break;
  }
  
  const rows = db.prepare(`
    SELECT user_id, 
           SUM(total_messages) as messages,
           SUM(total_voice_seconds) as voice,
           SUM(total_camera_seconds) as camera,
           SUM(total_stream_seconds) as stream
    FROM user_activity
    WHERE guild_id = ? AND date IN (${dates.map(() => '?').join(',')})
    GROUP BY user_id
    ORDER BY ${orderField} DESC
    LIMIT 10
  `).all(guildId, ...dates);
  
  return rows;
}

function isAFKChannel(guildId, channelId) {
  const result = db.prepare(`
    SELECT * FROM afk_channels 
    WHERE guild_id = ? AND channel_id = ?
  `).get(guildId, channelId);
  
  return !!result;
}

function setAFKChannel(guildId, channelId) {
  db.prepare(`
    INSERT OR IGNORE INTO afk_channels (guild_id, channel_id)
    VALUES (?, ?)
  `).run(guildId, channelId);
}

function removeAFKChannel(guildId, channelId) {
  db.prepare(`
    DELETE FROM afk_channels 
    WHERE guild_id = ? AND channel_id = ?
  `).run(guildId, channelId);
}

function cleanupSessions() {
  // Clear sessions older than 24 hours (bot crashed)
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  db.prepare(`
    DELETE FROM voice_sessions 
    WHERE session_start < ?
  `).run(oneDayAgo);
}

// Initialize on load
initializeDatabase();

module.exports = {
  db,
  getTodayDate,
  getOrCreateUserDay,
  addMessageCount,
  addVoiceSeconds,
  addCameraSeconds,
  addStreamSeconds,
  startVoiceSession,
  endVoiceSession,
  getUserStats,
  getLeaderboard,
  isAFKChannel,
  setAFKChannel,
  removeAFKChannel,
  cleanupSessions
};
