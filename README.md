# Discord Bot (Prefix: .)

## Kurulum
1) Discord Developer Portal > Bot:
   - **MESSAGE CONTENT INTENT** aç (prefix komutlar için şart).
   - Bot yetkileri: en azından `View Channels`, `Send Messages`, `Read Message History`,
     moderasyon için `Kick Members`, `Ban Members`, `Moderate Members`, `Manage Messages`,
     log/guard için `View Audit Log` önerilir.

2) Klasörde terminal aç:
```bash
npm install
```

3) `.env.example` dosyasını **`.env`** yap ve token’ı yaz.

4) Çalıştır:
```bash
npm start
```
veya `start.bat`

## Komutlar
- `.help`
- `.say`
- `.ban @uye [sebep]`
- `.kick @uye [sebep]`
- `.timeout @uye <dakika> [sebep]`
- `.untimeout @uye [sebep]`
- `.purge <1-100>`
- `.warn @uye [sebep]`
- `.warnings @uye`
- `.unwarn @uye <warnId>`
- `.clearwarns @uye`

## Yetki
`config.json` içindeki roller komut kullanma yetkisini belirler:
- `superAdminRoleId`
- `adminRoleId`

## Log Kanalları
`config.json > logChannels` içinde verdiğin kanal ID’leri kullanılır.

## Guard
`config.json > guard`:
- `enabled`: açık/kapalı
- `maxActions` / `windowMs`: kısa sürede çok işlem olursa guard-log’a yazar
- `punish`: `true` yaparsan (bot yetkisi yetiyorsa) şüpheli kişiyi “rol kırpma” denemesi yapar
