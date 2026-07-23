/**
 * Production-Grade Middleware Layer
 * - Error Handling
 * - Rate Limiting
 * - Memory Management
 * - Request Deduplication
 */

const fs = require('fs');
const path = require('path');

class RateLimiter {
  constructor(maxRequests = 10, windowMs = 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map();
  }

  isLimited(key) {
    const now = Date.now();
    const userRequests = this.requests.get(key) || [];
    
    // Eski requests'i filter et
    const recentRequests = userRequests.filter(time => now - time < this.windowMs);
    
    if (recentRequests.length >= this.maxRequests) {
      return true;
    }
    
    recentRequests.push(now);
    this.requests.set(key, recentRequests);
    
    // Memory cleanup: 5 dakikadan eski entries sil
    if (Math.random() < 0.1) {
      for (const [k, v] of this.requests.entries()) {
        const filtered = v.filter(t => now - t < 300000);
        if (filtered.length === 0) {
          this.requests.delete(k);
        } else {
          this.requests.set(k, filtered);
        }
      }
    }
    
    return false;
  }

  reset() {
    this.requests.clear();
  }

  getStats() {
    return {
      trackedUsers: this.requests.size,
      totalEntries: Array.from(this.requests.values()).reduce((a, b) => a + b.length, 0)
    };
  }
}

class MemoryManager {
  constructor(maxMapSize = 10000) {
    this.maxMapSize = maxMapSize;
    this.cleanupInterval = 5 * 60 * 1000; // 5 min
    this.maps = [];
  }

  registerMap(map, name) {
    this.maps.push({ map, name });
  }

  startCleanup() {
    setInterval(() => {
      for (const { map, name } of this.maps) {
        if (map.size > this.maxMapSize) {
          console.warn(`[MEMORY] ${name} Map büyüyor (${map.size}/${this.maxMapSize})`);
          
          // FIFO: eski entries'i sil
          let deleted = 0;
          for (const key of map.keys()) {
            if (deleted >= Math.floor(this.maxMapSize * 0.2)) break;
            map.delete(key);
            deleted++;
          }
          
          console.log(`[MEMORY] ${name} temizlendi: ${deleted} entry silindi`);
        }
      }
      
      // Process memory usage
      const used = process.memoryUsage();
      const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
      
      if (heapUsedMB > heapTotalMB * 0.9) {
        console.error(`[MEMORY] ⚠️ Yüksek bellek kullanımı: ${heapUsedMB}MB/${heapTotalMB}MB`);
        if (global.gc) {
          global.gc();
          console.log('[MEMORY] Garbage collection tetiklendi');
        }
      }
    }, this.cleanupInterval);
  }

  getStats() {
    const used = process.memoryUsage();
    return {
      heapUsedMB: Math.round(used.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(used.heapTotal / 1024 / 1024),
      externalMB: Math.round(used.external / 1024 / 1024),
      uptime: Math.round(process.uptime() / 60)
    };
  }
}

class ErrorHandler {
  constructor(logChannel = null) {
    this.logChannel = logChannel;
    this.errorLog = [];
    this.maxErrors = 100;
  }

  async handle(error, context = {}) {
    const timestamp = new Date().toISOString();
    const errorEntry = {
      timestamp,
      message: error.message,
      stack: error.stack,
      context,
      code: error.code
    };

    this.errorLog.push(errorEntry);
    if (this.errorLog.length > this.maxErrors) {
      this.errorLog.shift();
    }

    console.error(`[ERROR] ${timestamp}`, {
      message: error.message,
      context,
      code: error.code
    });

    // Discord kanalına error log gönder (opsiyonel)
    if (this.logChannel && context.client) {
      try {
        const channel = await context.client.channels.fetch(this.logChannel);
        if (channel && channel.isTextBased()) {
          const msg = `\`\`\`\n[${timestamp}]\n${error.message}\nContext: ${JSON.stringify(context)}\n\`\`\``;
          if (msg.length < 2000) {
            await channel.send(msg).catch(() => {});
          }
        }
      } catch (e) {
        // Discord'a log gönderemezse sessiz kalır
      }
    }

    return errorEntry;
  }

  getErrors(limit = 10) {
    return this.errorLog.slice(-limit);
  }

  clear() {
    this.errorLog = [];
  }
}

class RequestDeduplicator {
  constructor(ttl = 5000) {
    this.ttl = ttl;
    this.requests = new Map();
  }

  isDuplicate(key) {
    if (this.requests.has(key)) {
      return true;
    }
    
    this.requests.set(key, Date.now());
    
    // TTL sonunda kaldır
    setTimeout(() => {
      this.requests.delete(key);
    }, this.ttl);
    
    return false;
  }

  reset() {
    this.requests.clear();
  }
}

class HealthCheck {
  constructor() {
    this.metrics = {
      messagesProcessed: 0,
      eventsProcessed: 0,
      errorsOccurred: 0,
      startTime: Date.now(),
      lastHeartbeat: Date.now()
    };
  }

  recordMessage() {
    this.metrics.messagesProcessed++;
  }

  recordEvent() {
    this.metrics.eventsProcessed++;
  }

  recordError() {
    this.metrics.errorsOccurred++;
  }

  updateHeartbeat() {
    this.metrics.lastHeartbeat = Date.now();
  }

  getHealth() {
    const uptime = Date.now() - this.metrics.startTime;
    const heartbeatAge = Date.now() - this.metrics.lastHeartbeat;
    const isHealthy = heartbeatAge < 30000; // 30 sn'den eski heartbeat = sorun

    return {
      healthy: isHealthy,
      uptime: Math.round(uptime / 1000),
      messagesProcessed: this.metrics.messagesProcessed,
      eventsProcessed: this.metrics.eventsProcessed,
      errorsOccurred: this.metrics.errorsOccurred,
      heartbeatAge: heartbeatAge,
      avgResponseTime: uptime / (this.metrics.eventsProcessed || 1)
    };
  }

  reset() {
    this.metrics = {
      messagesProcessed: 0,
      eventsProcessed: 0,
      errorsOccurred: 0,
      startTime: Date.now(),
      lastHeartbeat: Date.now()
    };
  }
}

module.exports = {
  RateLimiter,
  MemoryManager,
  ErrorHandler,
  RequestDeduplicator,
  HealthCheck
};
