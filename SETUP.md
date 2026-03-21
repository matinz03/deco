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
- Enable Cloudflare proxy (orange cloud) for DDoS protection + CDN
- Set SSL/TLS mode to **Full (strict)** in Cloudflare dashboard

## 3. Get SSL certificate

```bash
# Make sure port 80 is open and Nginx is running
sudo nginx

# Obtain certificate
sudo certbot --nginx -d yourdomain.com

# Update infra/nginx/nginx.conf — replace 'yourdomain.com' with your actual domain
sed -i 's/yourdomain.com/your-actual-domain.com/g' infra/nginx/nginx.conf
```

## 4. Configure Nginx

```bash
sudo cp infra/nginx/nginx.conf /etc/nginx/sites-available/deco
sudo ln -s /etc/nginx/sites-available/deco /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Start everything

```bash
cd infra/compose
docker compose up -d

# Check all services are healthy
docker compose ps
docker compose logs -f
```

## 6. Verify

- `https://yourdomain.com` → Next.js web app
- `https://yourdomain.com/api/v1/health` → `{"status":"ok"}`
- `wss://yourdomain.com/ws` → WebSocket endpoint

## Deploying updates

```bash
git pull
cd infra/compose
docker compose build && docker compose up -d
```

## Useful commands

```bash
# View logs
docker compose logs api -f
docker compose logs web -f

# Connect to Postgres
docker compose exec postgres psql -U deco

# Connect to Redis
docker compose exec redis redis-cli -a $REDIS_PASSWORD
```
