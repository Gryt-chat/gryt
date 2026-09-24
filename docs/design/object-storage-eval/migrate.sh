#!/usr/bin/env bash
# Copy the MinIO bucket into a candidate over a shared Docker network, and time it.
# Usage: migrate.sh <garage|seaweedfs|rustfs [rclone|mc] | filesystem <host dir>>
set -euo pipefail
target="$1" tool="${2:-rclone}"
net=gryt-eval-migrate
docker network inspect "$net" >/dev/null 2>&1 || docker network create "$net" >/dev/null
connect() { docker network connect "$net" "$1" 2>/dev/null || true; }
connect gryt-eval-minio

src=(-e RCLONE_CONFIG_SRC_TYPE=s3 -e RCLONE_CONFIG_SRC_PROVIDER=Minio
  -e RCLONE_CONFIG_SRC_ENDPOINT=http://gryt-eval-minio:9000
  -e RCLONE_CONFIG_SRC_ACCESS_KEY_ID=evaladmin -e RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY=evalsecret-evalsecret)
dst=()
dst_s3() { # endpoint key secret
  endpoint="$1" key="$2" secret="$3"
  dst=(-e RCLONE_CONFIG_DST_TYPE=s3 -e RCLONE_CONFIG_DST_PROVIDER=Other -e RCLONE_CONFIG_DST_REGION=auto
    -e "RCLONE_CONFIG_DST_ENDPOINT=$1" -e "RCLONE_CONFIG_DST_ACCESS_KEY_ID=$2" -e "RCLONE_CONFIG_DST_SECRET_ACCESS_KEY=$3")
}
case "$target" in
  garage)    connect gryt-eval-garage;    dst_s3 http://gryt-eval-garage:3900 GK0123456789abcdef01234567 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef ;;
  seaweedfs) connect gryt-eval-seaweedfs; dst_s3 http://gryt-eval-seaweedfs:8333 evaladmin evalsecret-evalsecret ;;
  rustfs)    connect gryt-eval-rustfs;    dst_s3 http://gryt-eval-rustfs:9000 evaladmin evalsecret-evalsecret ;;
  filesystem) dir="$2" ;;
esac

now() { perl -MTime::HiRes=time -e "printf \"%.1f\", time"; }
start=$(now)
if [ "$target" = filesystem ]; then
  # The filesystem backend keeps Content-Type in a <key>.meta file beside the
  # object, and the server icon route reads it, so write those too.
  docker run --rm --network "$net" "${src[@]}" -v "$dir:/out" --entrypoint /bin/sh rclone/rclone:1.71 -c '
    set -e
    rclone sync src:gryt /out/gryt --transfers 8 --checkers 16
    rclone lsf -R --files-only --format pm --separator "|" src:gryt | while IFS="|" read -r key type; do
      printf "{\"contentType\":\"%s\"}" "$type" > "/out/gryt/$key.meta"
    done
    chown -R 1001:1001 /out/gryt'
elif [ "$tool" = mc ]; then
  docker run --rm --network "$net" --entrypoint /bin/sh pgsty/mc:RELEASE.2026-09-16T00-00-00Z -c "
    set -e
    mc alias set src http://gryt-eval-minio:9000 evaladmin evalsecret-evalsecret >/dev/null
    mc alias set dst $endpoint $key $secret >/dev/null
    mc mb -p dst/gryt >/dev/null 2>&1 || true
    mc mirror --overwrite --remove src/gryt dst/gryt >/dev/null"
else
  docker run --rm --network "$net" "${src[@]}" "${dst[@]}" rclone/rclone:1.71 \
    sync src:gryt dst:gryt --transfers 8 --checkers 16
fi
echo "migrate $target ($tool): $(perl -e "printf \"%.1f\", $(now) - $start") s"
