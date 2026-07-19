const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// Basit şifreleme (XOR)
function encryptData(data, key = 'girdap2024') {
  const buffer = Buffer.from(data);
  const keyBuffer = Buffer.from(key);
  
  let encrypted = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    encrypted[i] = buffer[i] ^ keyBuffer[i % keyBuffer.length];
  }
  
  return encrypted.toString('base64');
}

function decryptData(encrypted, key = 'girdap2024') {
  const buffer = Buffer.from(encrypted, 'base64');
  const keyBuffer = Buffer.from(key);
  
  let decrypted = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    decrypted[i] = buffer[i] ^ keyBuffer[i % keyBuffer.length];
  }
  
  return decrypted.toString('utf8');
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

async function createBackup(client, guildId) {
  ensureBackupDir();
  
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.error('[BACKUP] Sunucu bulunamadı:', guildId);
      return false;
    }

    // Veri dosyalarını oku
    const dataFiles = ['stats.json', 'warns.json', 'jails.json', 'vip.json', 'activity.json', 'sleepMode.json'];
    const backupData = {
      timestamp: new Date().toISOString(),
      guildId: guildId,
      guildName: guild.name,
      files: {}
    };

    for (const file of dataFiles) {
      const filePath = path.join(DATA_DIR, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        backupData.files[file] = JSON.parse(content);
      }
    }

    // Sunucu şablonu (channels, roles, permissions)
    backupData.template = {
      channels: [],
      roles: []
    };

    // Kanalları kaydet
    for (const [, channel] of guild.channels.cache) {
      backupData.template.channels.push({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        position: channel.position,
        parentId: channel.parentId,
        topic: channel.topic || null,
        permissionOverwrites: channel.permissionOverwrites.cache.map(p => ({
          id: p.id,
          type: p.type,
          allow: p.allow.bitfield.toString(),
          deny: p.deny.bitfield.toString()
        }))
      });
    }

    // Rolleri kaydet
    for (const [, role] of guild.roles.cache) {
      if (role.id === guild.id) continue; // @everyone atla
      backupData.template.roles.push({
        id: role.id,
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        position: role.position,
        permissions: role.permissions.bitfield.toString(),
        mentionable: role.mentionable
      });
    }

    // Şifrele ve kaydet
    const encryptedData = encryptData(JSON.stringify(backupData));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + new Date().getHours() + '-' + new Date().getMinutes();
    const backupFile = path.join(BACKUP_DIR, `backup_${timestamp}.enc`);
    
    fs.writeFileSync(backupFile, encryptedData, 'utf8');
    
    console.log(`[BACKUP] ✅ Backup başarıyla oluşturuldu: ${backupFile}`);
    
    // Eski backup'ları sil (30 günden eski)
    cleanOldBackups();
    
    return true;
  } catch (e) {
    console.error('[BACKUP] Hata:', e.message);
    return false;
  }
}

function cleanOldBackups() {
  try {
    ensureBackupDir();
    
    const files = fs.readdirSync(BACKUP_DIR);
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    
    for (const file of files) {
      if (!file.startsWith('backup_') || !file.endsWith('.enc')) continue;
      
      const filePath = path.join(BACKUP_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtimeMs > thirtyDaysMs) {
        fs.unlinkSync(filePath);
        console.log(`[BACKUP] 🗑️  Eski backup silindi: ${file}`);
      }
    }
  } catch (e) {
    console.error('[BACKUP] Temizleme hatası:', e.message);
  }
}

function listBackups() {
  ensureBackupDir();
  
  const files = fs.readdirSync(BACKUP_DIR);
  return files
    .filter(f => f.startsWith('backup_') && f.endsWith('.enc'))
    .map(f => ({
      name: f,
      path: path.join(BACKUP_DIR, f),
      created: fs.statSync(path.join(BACKUP_DIR, f)).mtime
    }))
    .sort((a, b) => b.created - a.created);
}

module.exports = {
  createBackup,
  cleanOldBackups,
  listBackups,
  encryptData,
  decryptData
};
