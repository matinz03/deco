# Deco — VPS Setup Guide

## Prerequisites on your Ubuntu 24 VPS

```bash
# Install Docker + Docker Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Nginx + Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# Install Node.js 22 + pnpm (for local dev / CI)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
corepack enable && corepack prepare pnpm@latest --activate

# Install Go 1.23
wget https://go.dev/dl/go1.23.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.23.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
source ~/.bashrc
```

## 1. Clone and configure

```bash
git clone <your-repo> deco && cd deco
cp .env.example .env
cp infra/compose/.env.example infra/compose/.env

# Edit both .env files with your real values
nano .env
nano infra/compose/.env
```

## 2. Point your domain to the VPS

In Cloudflare DNS:
- Add an `A` record: `yourdomain.com` → `<your VPS IP>`
- Add an `A` record: `media.yourdomain.com` → `<your VPS IP>`
- Enable Cloudflare proxy (orange cloud) for DDoS protection + CDN
- Set SSL/TLS mode to **Full (strict)** in Cloudflare dashboard

## 3. Get SSL certificate

```bash
# Make sure port 80 is open and Nginx is running
sudo nginx

# Obtain certificate
sudo certbot --nginx -d yourdomain.com -d media.yourdomain.com

# Update infra/nginx/nginx.conf — replace 'yourdomain.com' with your actual domain
sed -i 's/yourdomain.com/your-actual-domain.com/g' infra/nginx/nginx.conf
```

## 4. Configure Nginx

```bash
sudo cp infra/nginx/nginx.conf /etc/nginx/sites-available/deco
sudo ln -s /etc/nginx/sites-available/deco /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Configure backups and deploy

Fill every `BACKUP_S3_*` value in `infra/compose/.env`. The destination must be
off this VPS. Values containing shell-special characters must be quoted because
the backup and restore scripts read this file as shell environment syntax.
Also set the Clerk issuer, publishable key, and secret key. Production Compose
enables Clerk by default and refuses to build or start when these are absent.
Set `STORAGE_PUBLIC_BASE_URL` to the media origin plus the public bucket path,
for example `https://media.yourdomain.com/deco-public`.

On the first deployment there is no data to back up:

```bash
./deploy.sh
```

Run and inspect the first backup before accepting users:

```bash
./backup.sh
```

Install the daily user timer (the unit assumes the checkout is `~/deco`):

```bash
mkdir -p ~/.config/systemd/user
cp infra/systemd/deco-backup.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now deco-backup.timer
sudo loginctl enable-linger "$USER"
systemctl --user list-timers deco-backup.timer
```

`./watch-deploy.sh` is optional. It polls `origin/master` every 30 seconds. Every
update takes an off-host backup first, waits for API and web healthchecks, and
rebuilds the previous commit if the new deployment fails.
Automatic deployment refuses to run while the one-time legacy group-key
migration flag is enabled, because an old-binary rollback would not be safe.

## 6. Verify

- `https://yourdomain.com` → Next.js web app
- `https://yourdomain.com/health` → `{"status":"ok"}`
- `https://media.yourdomain.com/minio/health/live` → MinIO health response
- `wss://yourdomain.com/ws` → WebSocket endpoint

## Deploying updates

```bash
./deploy.sh
```

### One-time legacy group-key migration

Skip this for a fresh database. If an existing deployment has `group_keys`
rows, automatic deploy intentionally refuses the migration flag. Take a backup,
drain the old API, then boot exactly one new API with the gate enabled:

```bash
./backup.sh
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml stop api
git fetch origin master
git checkout --detach origin/master
# Set DECO_ALLOW_LEGACY_GROUP_KEY_MIGRATION=1 in infra/compose/.env
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml build
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml up -d --wait --wait-timeout 180
```

After the API becomes healthy, return the flag to `0` and recreate the API so
future deploys cannot repeat the migration. If the gated boot fails, do not
start an old API against the migrated schema; inspect logs and use `restore.sh`
with the pre-cutover snapshot if rollback is required.

## Useful commands

```bash
# View logs
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml logs api -f
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml logs web -f

# Connect to Postgres
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml exec postgres psql -U deco

# Connect to Redis
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml exec redis redis-cli -a "$REDIS_PASSWORD"
```
