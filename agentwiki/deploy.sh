#!/usr/bin/env bash
set -euo pipefail

REQUIRED_NODE_MAJOR="26"

require_node_26() {
  local executable="${1:-node}"
  local version major
  version="$("${executable}" --version 2>/dev/null || true)"
  major="${version#v}"
  major="${major%%.*}"
  if [ "${major}" != "${REQUIRED_NODE_MAJOR}" ]; then
    echo "AgentWiki requires Node.js 26; ${executable} reports ${version:-not installed}." >&2
    return 1
  fi
}

require_node_26 node

REMOTE_HOST="${1:-100.64.35.78}"
REMOTE_USER="${2:-neomei}"
PROJECT_DIR="agentwiki"
ARCHIVE="agentwiki-release-$(date +%Y%m%d%H%M%S).tar.gz"

cleanup() {
  rm -f "${ARCHIVE}"
}
trap cleanup EXIT

echo "Packaging AgentWiki direct-runtime release..."
tar \
  --exclude='.env' \
  --exclude='apps/server/.env' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='coverage' \
  --exclude='*.tar.gz' \
  -czf "${ARCHIVE}" \
  package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json .dockerignore \
  apps packages deploy deploy.sh

scp "${ARCHIVE}" "${REMOTE_USER}@${REMOTE_HOST}:~/"

ssh "${REMOTE_USER}@${REMOTE_HOST}" "bash -se" <<REMOTE
set -euo pipefail
required_node_major="26"
node_binary="/usr/bin/node"
node_version="\$("\$node_binary" --version 2>/dev/null || true)"
node_major="\${node_version#v}"
node_major="\${node_major%%.*}"
if [ "\$node_major" != "\$required_node_major" ]; then
  echo "AgentWiki requires Node.js 26; \$node_binary reports \${node_version:-not installed}." >&2
  exit 1
fi
mkdir -p "\$HOME/${PROJECT_DIR}"
release_dir="\$(mktemp -d "\$HOME/agentwiki-release.XXXXXX")"
trap 'rm -rf "\$release_dir"' EXIT
tar -xzf "\$HOME/${ARCHIVE}" -C "\$release_dir"
rm -f "\$HOME/${ARCHIVE}"
rsync -a --delete --exclude='.env' --exclude='node_modules' --exclude='dist' \
  "\$release_dir/apps/" "\$HOME/${PROJECT_DIR}/apps/"
rsync -a --delete --exclude='node_modules' --exclude='dist' \
  "\$release_dir/packages/" "\$HOME/${PROJECT_DIR}/packages/"
rsync -a --delete "\$release_dir/deploy/" "\$HOME/${PROJECT_DIR}/deploy/"
install -m 0644 "\$release_dir/package.json" "\$HOME/${PROJECT_DIR}/package.json"
install -m 0644 "\$release_dir/pnpm-lock.yaml" "\$HOME/${PROJECT_DIR}/pnpm-lock.yaml"
install -m 0644 "\$release_dir/pnpm-workspace.yaml" "\$HOME/${PROJECT_DIR}/pnpm-workspace.yaml"
install -m 0644 "\$release_dir/tsconfig.json" "\$HOME/${PROJECT_DIR}/tsconfig.json"
install -m 0755 "\$release_dir/deploy.sh" "\$HOME/${PROJECT_DIR}/deploy.sh"
cd "\$HOME/${PROJECT_DIR}"

if ! grep -q '^JWT_SECRET=' .env; then
  secret="\$(sed -n 's/^APP_SECRET=//p' .env | head -n1)"
  test -n "\$secret"
  printf 'JWT_SECRET=%s\n' "\$secret" >> .env
fi
if ! grep -q '^CORS_ORIGINS=' .env; then
  origin="\$(sed -n 's/^CLIENT_URL=//p' .env | head -n1)"
  test -n "\$origin"
  printf 'CORS_ORIGINS=%s\n' "\$origin" >> .env
fi
grep -q '^MCP_ALLOWED_HOSTS=' .env || printf 'MCP_ALLOWED_HOSTS=${REMOTE_HOST},localhost,127.0.0.1\n' >> .env
grep -q '^ALLOWED_GIT_HOSTS=' .env || printf 'ALLOWED_GIT_HOSTS=github.com,gitlab.com\n' >> .env
sed -i '/^NODE_IMAGE=/d;/^NGINX_IMAGE=/d' .env
chmod 600 .env apps/server/.env

pnpm install --frozen-lockfile
pnpm --filter @agentwiki/shared build
pnpm --filter @agentwiki/server build
pnpm --filter @agentwiki/client build
pnpm --filter @agentwiki/server exec prisma migrate deploy

mkdir -p "\$HOME/.config/systemd/user"
install -m 0644 deploy/systemd/*.service "\$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable agentwiki-api.service agentwiki-worker.service agentwiki-frontend.service

for pid in \$(pgrep -u "\$USER" node || true); do
  cwd="\$(readlink "/proc/\$pid/cwd" 2>/dev/null || true)"
  case "\$cwd" in
    "\$HOME/${PROJECT_DIR}"/*) kill "\$pid" 2>/dev/null || true ;;
  esac
done

systemctl --user restart agentwiki-api.service
systemctl --user restart agentwiki-worker.service
systemctl --user restart agentwiki-frontend.service

for attempt in \$(seq 1 30); do
  api="\$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true)"
  ui="\$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/ || true)"
  if [ "\$api" = 200 ] && [ "\$ui" = 200 ]; then break; fi
  sleep 2
done
test "\${api:-}" = 200
test "\${ui:-}" = 200
systemctl --user --no-pager --full status agentwiki-api.service agentwiki-worker.service agentwiki-frontend.service
REMOTE

echo "Direct deployment complete: http://${REMOTE_HOST}:5173"
