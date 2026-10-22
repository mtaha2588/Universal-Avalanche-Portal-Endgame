#!/usr/bin/env bash
# Install or update the portal on a fresh Ubuntu 22.04 / 24.04 server (Oracle Cloud Always Free).
#
#   sudo bash setup_server.sh                 # http://<public-ip>/
#   sudo bash setup_server.sh --https         # also https://<ip-with-dashes>.sslip.io/ (free Let's Encrypt certificate)
#
# Expects avalanche-portal.zip in the same folder as this script (or in the current folder).
# Safe to run again after uploading a new zip: it replaces the code and data, keeps the virtual environment.
set -euo pipefail

APP_DIR=/opt/avalanche-portal
APP_USER=portal
SERVICE=avalanche-portal
WANT_HTTPS=0
[[ "${1:-}" == "--https" ]] && WANT_HTTPS=1

[[ $EUID -eq 0 ]] || { echo "Run with sudo: sudo bash $0 $*"; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
ZIP=""
for z in "$HERE/avalanche-portal.zip" "$PWD/avalanche-portal.zip"; do [[ -f "$z" ]] && ZIP="$z" && break; done
[[ -n "$ZIP" ]] || { echo "avalanche-portal.zip not found next to this script."; exit 1; }

echo "==> Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q python3 python3-venv python3-pip nginx unzip curl iptables-persistent >/dev/null

# The 1 GB "Micro" shape is tight while the large glacier layers are compressed at startup.
if [[ $(free -m | awk '/^Mem:/{print $2}') -lt 2000 && ! -f /swapfile ]]; then
  echo "==> Adding 2 GB swap (small machine)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Copying the portal to $APP_DIR"
id "$APP_USER" &>/dev/null || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
STAGE=$(mktemp -d)
unzip -q "$ZIP" -d "$STAGE"
# Replace everything except the virtual environment.
find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name .venv -exec rm -rf {} +
cp -a "$STAGE"/. "$APP_DIR"/
rm -rf "$STAGE"

# Server settings: Waitress listens only locally; nginx is the public entry point.
ENV="$APP_DIR/.env"
touch "$ENV"
set_env() { grep -q "^$1=" "$ENV" && sed -i "s|^$1=.*|$1=$2|" "$ENV" || echo "$1=$2" >> "$ENV"; }
set_env HOST 127.0.0.1
set_env PORT 5000
set_env FLASK_DEBUG 0
grep -q '^SECRET_KEY=.' "$ENV" || set_env SECRET_KEY "$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
chmod 600 "$ENV"

echo "==> Installing Python packages"
[[ -d "$APP_DIR/.venv" ]] || python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install -q --upgrade pip
"$APP_DIR/.venv/bin/pip" install -q -r "$APP_DIR/requirements.txt"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Creating the $SERVICE service (starts on boot, restarts on failure)"
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=Pakistan Avalanche Intelligence Portal
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/.venv/bin/python app.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q $SERVICE
systemctl restart $SERVICE

PUBLIC_IP=$(curl -s --max-time 5 https://checkip.amazonaws.com || curl -s --max-time 5 https://ifconfig.me || echo "")
PUBLIC_IP=$(echo "$PUBLIC_IP" | tr -d '[:space:]')
HOSTNAME_SSLIP=""
[[ -n "$PUBLIC_IP" ]] && HOSTNAME_SSLIP="${PUBLIC_IP//./-}.sslip.io"

echo "==> Configuring nginx"
# Optional login: create /etc/nginx/.portal_users (see DEPLOY.md) and every visitor must sign in.
AUTH=""
[[ -s /etc/nginx/.portal_users ]] && AUTH='auth_basic "Avalanche Portal"; auth_basic_user_file /etc/nginx/.portal_users;'
cat > /etc/nginx/sites-available/$SERVICE <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _ ${HOSTNAME_SSLIP};

    client_max_body_size 5m;
    ${AUTH}

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/$SERVICE /etc/nginx/sites-enabled/$SERVICE
nginx -t -q
systemctl reload nginx || systemctl restart nginx

echo "==> Opening ports 80 and 443 in the server firewall"
# Oracle's Ubuntu images ship an iptables REJECT rule; insert ACCEPT rules ahead of it.
for p in 80 443; do
  iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport $p -j ACCEPT
done
netfilter-persistent save >/dev/null 2>&1 || true
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

echo "==> Waiting for the portal to answer"
for i in $(seq 1 40); do
  curl -s -o /dev/null http://127.0.0.1:5000/api/config && break
  sleep 1
done
curl -s -o /dev/null -w "Portal HTTP status: %{http_code}\n" http://127.0.0.1/ || true

if [[ $WANT_HTTPS -eq 1 && -n "$HOSTNAME_SSLIP" ]]; then
  echo "==> Requesting a free HTTPS certificate for $HOSTNAME_SSLIP"
  apt-get install -y -q certbot python3-certbot-nginx >/dev/null
  if certbot --nginx -n --keep-until-expiring --agree-tos --register-unsafely-without-email --redirect -d "$HOSTNAME_SSLIP"; then
    echo "HTTPS ready."
  else
    echo "HTTPS certificate failed (the portal still works over http). Check that port 80 is open in the Oracle security list."
  fi
fi

echo
echo "============================================================"
echo " Portal installed."
[[ -n "$PUBLIC_IP" ]] && echo " Open:  http://$PUBLIC_IP/"
[[ $WANT_HTTPS -eq 1 && -n "$HOSTNAME_SSLIP" ]] && echo " HTTPS: https://$HOSTNAME_SSLIP/"
echo " Logs:  sudo journalctl -u $SERVICE -f"
echo "============================================================"
