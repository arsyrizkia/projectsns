# Droplet setup (one-time)

Target: existing DigitalOcean droplet (Ubuntu, nginx already running).

```sh
# 1. dedicated user + dirs
sudo useradd --system --create-home --shell /usr/sbin/nologin projectsns
sudo mkdir -p /opt/projectsns/{web,worker}
sudo chown -R projectsns:projectsns /opt/projectsns

# 2. Node 22 (worker + web runtime)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. secrets file (mode 600, root-owned) — see apps/web/.env.example for keys
sudo install -m 600 /dev/null /etc/projectsns.env
sudo nano /etc/projectsns.env
#   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL (pooler, port 6543)
#   TOKEN_ENC_KEY (openssl rand -base64 32)
#   OAUTH_STATE_SECRET (openssl rand -hex 32)
#   APP_ORIGIN=https://sns.dilatih.co
#   LINKEDIN_/META_/TIKTOK_ client credentials

# 4. nginx + TLS
sudo cp ops/nginx/sns.dilatih.co.conf /etc/nginx/sites-available/sns.dilatih.co
sudo ln -s /etc/nginx/sites-available/sns.dilatih.co /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d sns.dilatih.co

# 5. systemd units
sudo cp ops/systemd/projectsns-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable projectsns-web projectsns-worker
```

DNS: add `sns` A record → droplet IP (through Cloudflare like the other
dilatih.co subdomains; do NOT put media routes behind Cloudflare Access).

## Deploys

GitHub Actions (`.github/workflows/deploy.yml`) builds on push to `main`,
rsyncs artifacts to `/opt/projectsns`, restarts both units. Requires repo
secrets: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`.

## Database migrations

NOT automatic (same policy as the other repos). Apply with:

```sh
supabase db push --db-url "$DIRECT_DATABASE_URL"   # direct connection, port 5432
```

## Health

- `systemctl status projectsns-web projectsns-worker`
- worker heartbeat: `select * from worker_heartbeat;` — web UI shows a banner
  when stale > 2 min.
