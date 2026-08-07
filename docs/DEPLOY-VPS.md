# Moving L'Casaoui to a VPS

This is the checklist to move off Hostinger shared hosting (which hits the "Max Processes"
cap) onto a small VPS where Node + Prisma run without a thread cap. Plan: **the morning of the
move, export the live data, copy it to the VPS, import it, then switch DNS.**

The app was built for this — only config/DB change, no code changes.

---

## 0. Provision the VPS
- Any small VPS (e.g. Hostinger KVM 1, or a €5/mo Ubuntu 22.04/24.04 box).
- Note its public IP. SSH in as root (or a sudo user).

## 1. Install the runtime
```bash
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# MySQL (keep the same DB engine as now — simplest move)
apt-get install -y mysql-server
mysql_secure_installation
```
Create the database and a user:
```sql
CREATE DATABASE lcasaoui CHARACTER SET utf8mb4;
CREATE USER 'lcasaoui'@'localhost' IDENTIFIED BY 'a-strong-password';
GRANT ALL PRIVILEGES ON lcasaoui.* TO 'lcasaoui'@'localhost';
FLUSH PRIVILEGES;
```

## 2. Get the code + build
```bash
cd /var/www           # or wherever you keep apps
git clone https://github.com/saadbouchal55-commits/Lcasaoui-stock.git
cd Lcasaoui-stock
npm install
npm run build:frontend          # builds frontend/dist (served by Express)
npx prisma generate
```

## 3. Configure `.env`
```bash
cp .env.example .env
nano .env
```
Set:
- `DATABASE_URL="mysql://lcasaoui:a-strong-password@localhost:3306/lcasaoui"`
  (on a VPS you can drop `?connection_limit=3` — it was a shared-hosting workaround)
- `SESSION_SECRET=` a long random string
- `NODE_ENV=production`
- `PORT=3000`
- `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` (only used if you start fresh)
- You can remove `UV_THREADPOOL_SIZE` (not needed on a VPS)

## 4. Create the schema
```bash
npx prisma db push
```

## 5. Bring the data over  (the morning-of move)

**On Hostinger** (SSH into the current app dir), export everything to one JSON file:
```bash
npm run export:data
# -> backups/backup-YYYY-MM-DDTHH-MM-SS.json
```
Copy that file to the VPS (run from your PC, or use Hostinger's file manager):
```bash
scp backups/backup-*.json root@VPS_IP:/var/www/Lcasaoui-stock/backups/
```
**On the VPS**, load it (this wipes the fresh DB and restores the live data, ids preserved):
```bash
npm run import:data backups/backup-YYYY-MM-DDTHH-MM-SS.json
```

> Alternative (exact MySQL copy): on Hostinger `mysqldump -u USER -p DBNAME > dump.sql`,
> copy it over, then on the VPS `mysql -u lcasaoui -p lcasaoui < dump.sql` (skip `db push` and
> the JSON import in that case — the dump already has schema + data).

> **Fresh start instead of migrating?** Skip the export/import and run `npm run seed` on the VPS.

> **If you later switch to PostgreSQL:** after `import:data`, reset the id sequences once, e.g.
> for each table: `SELECT setval(pg_get_serial_sequence('"Item"','id'), (SELECT MAX(id) FROM "Item"));`
> (MySQL needs no such step.)

## 6. Run it with PM2 (stays up, restarts on reboot)
```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup      # run the command it prints
```
App now listens on `localhost:3000`.

## 7. Put Nginx + HTTPS in front
```bash
apt-get install -y nginx
```
`/etc/nginx/sites-available/lcasaoui`:
```nginx
server {
    server_name lesracinesdor.ma www.lesracinesdor.ma;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
ln -s /etc/nginx/sites-available/lcasaoui /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

> **Critical:** the `proxy_set_header X-Forwarded-Proto $scheme;` line is required. Without it,
> Express (which sets a `secure` session cookie in production, and has `app.set('trust proxy', 1)`)
> can't tell the request is HTTPS, so the login cookie is never stored — login returns 200 but every
> later API call returns **401** and the app looks empty even though the database has data. Also make
> sure the site is actually symlinked into `sites-enabled/`.

```bash
# HTTPS
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d lesracinesdor.ma -d www.lesracinesdor.ma
```

## 8. Nightly auto-order (cron)
```bash
crontab -e
# order at ~01:30 for the next day:
30 1 * * * cd /var/www/Lcasaoui-stock && /usr/bin/node jobs/nightly.js >> /var/log/lcasaoui-nightly.log 2>&1
```

## 9. Cutover
1. Do the export/import (step 5) in the morning when traffic is low.
2. Verify the VPS site works via its IP (or a temp hostname).
3. Point the domain's DNS **A record** to the VPS IP.
4. Once DNS propagates and HTTPS is issued, retire the Hostinger app.

## Updating later
```bash
cd /var/www/Lcasaoui-stock
git pull
npm install
npm run build:frontend
npx prisma generate && npx prisma db push
pm2 restart lcasaoui
```
