#!/usr/bin/env bash
set -euo pipefail

# AgentWiki Nginx HTTPS setup helper
# Usage:
#   Local dev:   ./setup-ssl.sh local
#   Production:  ./setup-ssl.sh prod your-domain.com

MODE="${1:-local}"
DOMAIN="${2:-localhost}"
SSL_DIR="/etc/nginx/ssl"
CONF_SRC="$(dirname "$0")/agentwiki.conf"
CONF_DST="/etc/nginx/sites-available/agentwiki.conf"

echo "=== AgentWiki HTTPS Setup ($MODE) ==="

if ! command -v nginx &>/dev/null; then
  echo "Nginx not found. Installing..."
  if command -v brew &>/dev/null; then
    brew install nginx
  elif command -v apt &>/dev/null; then
    sudo apt update && sudo apt install -y nginx
  else
    echo "Please install nginx manually." && exit 1
  fi
fi

echo "Creating SSL directory..."
sudo mkdir -p "$SSL_DIR"

if [ "$MODE" = "local" ]; then
  if ! command -v mkcert &>/dev/null; then
    echo "Installing mkcert for local trusted certificates..."
    if command -v brew &>/dev/null; then
      brew install mkcert nss
    elif command -v apt &>/dev/null; then
      sudo apt install -y libnss3-tools mkcert
    fi
  fi
  mkcert -install
  echo "Generating local certificates for localhost..."
  cd "$SSL_DIR" && sudo mkcert localhost 127.0.0.1 ::1
  sudo mv localhost+2.pem agentwiki.crt
  sudo mv localhost+2-key.pem agentwiki.key
elif [ "$MODE" = "prod" ]; then
  echo "Setting up Let's Encrypt certificate for $DOMAIN..."
  if ! command -v certbot &>/dev/null; then
    echo "Installing certbot..."
    sudo apt install -y certbot python3-certbot-nginx
  fi
  sudo certbot certonly --nginx -d "$DOMAIN" \
    --key-path "$SSL_DIR/agentwiki.key" \
    --fullchain-path "$SSL_DIR/agentwiki.crt"
  # Update server_name in config
  sudo sed -i "s/server_name _;/server_name $DOMAIN;/" "$CONF_SRC"
fi

echo "Installing Nginx config..."
if [ -d /etc/nginx/sites-available ]; then
  sudo cp "$CONF_SRC" "$CONF_DST"
  sudo ln -sf "$CONF_DST" /etc/nginx/sites-enabled/agentwiki.conf
else
  sudo cp "$CONF_SRC" /etc/nginx/conf.d/agentwiki.conf
fi

echo "Testing Nginx config..."
sudo nginx -t

echo "Reloading Nginx..."
sudo nginx -s reload || sudo nginx

echo ""
echo "=== Done! ==="
echo "HTTPS is now available at https://${DOMAIN}"
echo "Make sure AgentWiki is running:  cd agentwiki && pnpm dev"
