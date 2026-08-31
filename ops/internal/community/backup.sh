#!/usr/bin/env bash
# Nightly backup for community.gryt.chat.
#
# Two things are worth keeping: the SQLite database, which holds every message,
# membership, report and audit entry, and the MinIO bucket, which holds every
# upload. Both live in Docker volumes on one disk on one machine.
#
# The database is copied with sqlite3 .backup rather than cp. A live SQLite
# database has data in the WAL that a file copy does not see, so a cp taken
# while the server is writing restores as a database missing the last however
# many minutes — and it restores cleanly, which is the part that hurts.
#
# This writes to a directory on the same box. That is a backup of the volume,
# not a backup of the machine: if the VM's disk goes, so does this. Copying
# BACKUP_DIR off the VM is a separate job and nothing does it yet.
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

# Through the server's own node rather than a throwaway container.
#
# The first version of this ran `alpine:3` and `apk add sqlite`, which needs a
# package mirror — so the backup depended on the network being up and on
# Alpine's CDN being reachable. On this VM it simply hung: containers on the
# default bridge could not get out, the service sat in `activating` for five
# minutes with an empty backup directory, and nothing said why. A backup that
# fails when the network is down is a backup that fails on exactly the day you
# needed it.
#
# VACUUM INTO rather than `.backup`: it is one SQL statement, it takes a
# consistent snapshot of a live WAL database including whatever is still in the
# log, and it needs nothing that is not already in the image. It also refuses
# rather than overwriting, so a stale file cannot be mistaken for a fresh one.
# The script goes in on stdin rather than through -e. VACUUM INTO needs a
# single-quoted SQL literal, and a shell cannot put one of those inside a
# single-quoted argument at all.
docker exec -i gryt-community-server node <<'NODE'
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.env.DATA_DIR + "/gryt.db");
db.exec("VACUUM INTO '/tmp/gryt-backup.db'");
NODE
docker cp gryt-community-server:/tmp/gryt-backup.db "$dest/gryt.db"
docker exec gryt-community-server rm -f /tmp/gryt-backup.db
gzip -9 "$dest/gryt.db"

# mc mirror rather than a tarball of the volume: it goes through MinIO, so it
# sees a consistent view of the bucket instead of files caught mid-write.
#
# This one does need an image, but only one already pulled by the stack itself,
# and it talks to MinIO over the compose network rather than to the internet.
docker run --rm --pull=never \
  --network "$NETWORK" \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD -e S3_BUCKET \
  -v "$dest/objects:/backup" \
  --entrypoint /bin/sh minio/mc:latest -c '
    set -e
    mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc mirror --overwrite --remove "local/$S3_BUCKET" /backup >/dev/null
  '

# Anything older than KEEP_DAYS goes. Same window as the Keycloak dumps, and
# for the same reason: long enough to notice a problem, short enough that the
# disk cannot fill quietly.
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} +

du -sh "$dest"
