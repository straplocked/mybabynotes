#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Chris Carvache

# mybabynotes — Unraid install/update script.
#
# First run:  installs to /mnt/user/appdata/baby-log, generates secrets, starts the stack.
# Re-run:     pulls the latest release from GitHub and rebuilds. Data survives in ./data.
#
#   curl -fsSL https://raw.githubusercontent.com/straplocked/mybabynotes/main/deploy/unraid/babylog.sh | sh
set -e

REPO="straplocked/mybabynotes"
BASE="${BABYLOG_BASE:-/mnt/user/appdata/baby-log}"
# BABYLOG_GH_API exists so tests can point the release lookup at a stub.
GH_API="${BABYLOG_GH_API:-https://api.github.com}"

# BABYLOG_REF pins a tag or commit (e.g. v1.0.0, main). Unset, it resolves to
# the latest GitHub release — or falls back to main when no release exists
# yet or the API can't be reached.
REF="$BABYLOG_REF"
if [ -z "$REF" ]; then
  LATEST=$(curl -fsSL "$GH_API/repos/$REPO/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1) || LATEST=""
  case "$LATEST" in
    v*) REF="$LATEST" ;;
    *)  echo "==> no release found (or GitHub API unreachable) — tracking main"
        REF="main" ;;
  esac
fi
echo "==> ref: $REF"

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found"; exit 1; }
docker compose version >/dev/null 2>&1 || {
  echo "ERROR: docker compose v2 not found — install the 'Docker Compose Manager' plugin from Community Apps first"
  exit 1
}

mkdir -p "$BASE/data"
cd "$BASE"

if [ ! -f .env ]; then
  cat > .env <<EOF
APP_KEY=base64:$(openssl rand -base64 32)
REVERB_APP_ID=babylog
REVERB_APP_KEY=$(openssl rand -hex 16)
REVERB_APP_SECRET=$(openssl rand -hex 24)
APP_PORT=3500
DATA_DIR=$BASE/data
EOF
  echo "==> generated fresh secrets in $BASE/.env"
fi

# Releases attach their own tarball + checksums.txt (GitHub's generated
# /archive/ tarballs aren't byte-stable, so those can't be checksummed).
# A v* ref uses the release asset and verifies it; anything else — or a v*
# tag from before the release workflow existed — falls back to GitHub's
# generated tarball, unverified.
VERIFY=0
rm -f checksums.txt
case "$REF" in
  v*)
    ASSETS="https://github.com/$REPO/releases/download/$REF"
    if curl -fsSL "$ASSETS/checksums.txt" -o checksums.txt 2>/dev/null; then
      TARBALL="$ASSETS/mybabynotes-$REF.tar.gz"
      VERIFY=1
    else
      echo "WARNING: release $REF has no checksums.txt — skipping verification"
      TARBALL="https://github.com/$REPO/archive/refs/tags/$REF.tar.gz"
    fi ;;
  *)
    TARBALL="https://github.com/$REPO/archive/$REF.tar.gz" ;;
esac

echo "==> downloading $REF…"
curl -fsSL "$TARBALL" -o src.tar.gz

if [ "$VERIFY" = 1 ]; then
  WANT=$(grep -F "mybabynotes-$REF.tar.gz" checksums.txt | awk '{print $1}')
  GOT=$(sha256sum src.tar.gz | awk '{print $1}')
  if [ -z "$WANT" ] || [ "$GOT" != "$WANT" ]; then
    echo "ERROR: checksum mismatch for mybabynotes-$REF.tar.gz (got $GOT, want ${WANT:-nothing})"
    rm -f src.tar.gz checksums.txt
    exit 1
  fi
  echo "==> checksum verified"
fi
rm -f checksums.txt

rm -rf src.new
mkdir src.new
tar xzf src.tar.gz -C src.new --strip-components=1
rm -f src.tar.gz
rm -rf src
mv src.new src

echo "==> building + starting…"
docker compose -p baby-log --env-file "$BASE/.env" -f "$BASE/src/deploy/unraid/docker-compose.yml" up -d --build
docker image prune -f >/dev/null 2>&1 || true

PORT=$(sed -n 's/^APP_PORT=//p' "$BASE/.env")
echo "==> done — mybabynotes is on port ${PORT:-3500}. Re-run this script any time to update."
