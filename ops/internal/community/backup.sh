#!/usr/bin/env bash
# Nightly backup for community.gryt.chat: the SQLite database and the MinIO
# bucket, both in Docker volumes on one disk on one machine.

# Copied with sqlite3 rather than cp — a live database has data in the WAL that a
# file copy misses, and it restores cleanly, which is the part that hurts.

# This writes to the same box, so it is a backup of the volume and not of the
# machine. Copying BACKUP_DIR off the VM is a separate job and nothing does it.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/gryt-community}"
DATA_VOLUME="${DATA_VOLUME:-gryt-community-server-data}"
NETWORK="${NETWORK:-gryt-community}"
KEEP_DAYS="${KEEP_DAYS:-31}"

: "${MINIO_ROOT_USER:?set MINIO_ROOT_USER, or run with --env-file /opt/gryt-community/.env}"
: "${MINIO_ROOT_PASSWORD:?set MINIO_ROOT_PASSWORD}"
S3_BUCKET="${S3_BUCKET:-gryt-community}"

stamp="$(date -u +%Y%m%d-%H%M%S)"
dest="$BACKUP_DIR/$stamp"
mkdir -p "$dest/objects"

# Through the server's own node rather than a throwaway container. `alpine:3`
# plus `apk add sqlite` needed a mirror, and on this VM it hung for five minutes.

# VACUUM INTO rather than `.backup`: one statement, a consistent snapshot of a
# live WAL database, nothing that is not already in the image.

# It also refuses rather than overwriting, so a stale file cannot pass for a fresh
# one. The script goes in on stdin because VACUUM INTO needs a quoted SQL literal.
docker exec -i gryt-community-server node <<'NODE'
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.env.DATA_DIR + "/gryt.db");
db.exec("VACUUM INTO '/tmp/gryt-backup.db'");
NODE
docker cp gryt-community-server:/tmp/gryt-backup.db "$dest/gryt.db"
docker exec gryt-community-server rm -f /tmp/gryt-backup.db
gzip -9 "$dest/gryt.db"

# mc mirror rather than a tarball of the volume: it goes through MinIO, so it
# sees a consistent view instead of files caught mid-write.

# It needs an image, but one the stack has already pulled, and it talks to MinIO
# over the compose network rather than the internet.
docker run --rm --pull=never \
  --network "$NETWORK" \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD -e S3_BUCKET \
  -v "$dest/objects:/backup" \
  --entrypoint /bin/sh minio/mc:latest -c '
    set -e
    mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc mirror --overwrite --remove "local/$S3_BUCKET" /backup >/dev/null
  '

# Anything older than KEEP_DAYS goes. Same window as the Keycloak dumps: long
# enough to notice a problem, short enough that the disk cannot fill quietly.
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} +

du -sh "$dest"
