# Replacing MinIO in the self-host stack

GRYT-1438. Measured on 2026-09-24.

MinIO pulled its public images this month. `quay.io/minio/*` and Docker Hub's
`minio/*` now answer 401 unless you're logged in, and the console and docs were
already gone. The stack runs a pinned `pgsty/minio` community build for now
(GRYT-1437). This page is about what replaces it for good.

I tried three stores, Garage, SeaweedFS and RustFS, plus a fourth option: no
store at all, with uploads on the server's own disk. Each one ran in Docker on
its own. I pointed the S3 calls Gryt makes at it, then the real server and image
worker, then moved 1 GiB out of a MinIO volume into it. The scripts are in
[`object-storage-eval/`](object-storage-eval/), so all of it can be run again.

## Recommendation

**Make the filesystem backend the default for a self-hosted server, and use
Garage where somebody wants a separate S3 store.** Rule out SeaweedFS for small
machines. RustFS is the fallback if we want to switch dev.lan's existing MinIO
volumes in place, but I wouldn't make it the default.

Why:

- **Filesystem.** The server and the image worker both have a filesystem
  backend already, with the same layout, and the pair passed the whole
  end-to-end run on it: upload, whole and ranged reads, the 416, the video
  poster frame and the worker's thumbnail. There's no worker work to do.
  Dropping the store takes a container, a key pair, an init service and `mc`
  out of every install. The `gryt` CLI already offers it, but it's broken there
  today (GRYT-1443).
- **Garage** sat at 8 to 24 MiB idle and peaked at 27 to 47 MiB while taking
  50 MB uploads back to back. MinIO did 86 to 127 idle and 236 to 297 under the
  same load. Garage's image is 27 MB, it builds for arm, arm64, amd64 and 386,
  and its bootstrap fits in the one service (`--single-node --default-bucket`),
  so `minio-init` goes away. It needs two settings, and one of them isn't
  optional: without it, downloading any file over 8 MB in one request kills the
  Gryt server. Details below.
- **RustFS** passed everything with no changes, and it ran on a copy of a MinIO
  data directory as it was. MinIO could read the directory back afterwards.
  That makes it the cheapest switch. But 1.0.0 came out on 2026-09-16, eight
  days ago, and the project has published 35 security advisories since
  December 2025. 18 of them are high or critical, and a lot are in its auth and
  IAM code. It also held about 440 MiB once it had 1 GiB stored.
- **SeaweedFS** passed everything, then grew to 1.7 GiB under the upload load
  and stayed there. With a 512 MiB memory limit it was OOM-killed inside 20
  seconds. `GOMEMLIMIT=384MiB` keeps it alive under that limit, so it's
  fixable, but a Raspberry Pi install shouldn't need Go runtime tuning. Its
  image is 186 MB for arm64.

## What Gryt asks of a store

This is the test matrix, read off `origin/main` of each repo.

**Server** (`packages/server/src/storage/s3.ts`). The client is built from
`S3_ENDPOINT`, `S3_REGION` (`auto`), `S3_FORCE_PATH_STYLE=true` and a static key
pair, on `@aws-sdk/client-s3` 3.1121.0 with the SDK's default checksum settings.

- `HeadBucket`, then `CreateBucket` on a 404 (`ensureBucket`, at startup).
- `PutObject` from a buffer or string with a `ContentType`: avatars and their
  thumbnails, emojis, server icons, SVGs, video poster frames, webhook media.
- `@aws-sdk/lib-storage` `Upload` from a file, for every attachment. That's one
  PUT under 8 MB, and multipart above it with 8 MB parts, 4 in flight and
  `leavePartsOnError: false`.
- `GetObject` whole (emojis, the server icon, `getObjectAsBuffer`) and with a
  single `Range` for attachments. The route relies on the store clamping an end
  past EOF, and on `InvalidRange` for a start at or past EOF, which it turns
  into a 416 after a `HeadObject` for the size.
- The server icon route serves the stored object's `Content-Type`, so that has
  to survive a round trip and a migration. Attachments take theirs from the
  database.
- `DeleteObject`, including on keys that are already gone, because the media
  sweep and the cleanup paths run again.
- Not used: presigned URLs (`getObjectSignedUrl` exists and nothing calls it),
  ACLs (`aclPublicRead` exists and nothing sets it), bucket policies, anonymous
  access, lifecycle rules, CORS and listing. Clients never talk to the store.
  Every read goes through the API.

Keys look like `uploads/<uuid>.<ext>`, `thumbnails/<uuid>.jpg|avif`,
`avatars/<uuid>.<ext>`, `avatars/thumb_<uuid>.avif`, `emojis/<name>.<ext>`,
`emoji_raw/<job id>` and `server-icons/<host>/<uuid>.<ext>`.

**Image worker** (`packages/image-worker/src/storage.ts`, the same client
without the custom HTTP agents): `GetObject` into a buffer, `PutObject` and
`DeleteObject`.

**Compose and the CLI.** `ops/deploy/compose/prod.yml`, `beta.yml`,
`ops/deploy/host/compose.yml`, `ops/internal/community/compose.yml` and the
CLI's shared project (`packages/cli/internal/config/shared.go`) all run
`minio server /data` with `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`, a
healthcheck of `mc ready local`, and a `minio-init` one-shot that runs
`mc alias set` and `mc mb -p local/$S3_BUCKET`. The CLI puts every server on the
machine on one store and one bucket.

**Ops scripts.** `ops/internal/community/backup.sh` runs
`mc mirror --overwrite --remove` from the bucket into the backup folder.
`ops/internal/ha/snapshot.sh` runs `mc ls` to list the buckets and `mc mirror`
for each. That one isn't on `main`; it's an untracked file in the shared
checkout.

## Results

All four stores ran single-node in Docker from the compose files in
`object-storage-eval/compose/`. The baseline is
`pgsty/minio:RELEASE.2026-08-04T00-00-00Z`. The others are
`dxflrs/garage:v2.4.1`, `chrislusf/seaweedfs:4.47` (`weed server -s3`) and
`rustfs/rustfs:1.0.0`.

### The S3 matrix

`s3-matrix.cjs` makes each call above with the server's own client setup and
SDK version.

| Call | MinIO | Garage | SeaweedFS | RustFS |
|---|---|---|---|---|
| `ensureBucket` (HeadBucket 404, CreateBucket) | pass | pass | pass | pass |
| PutObject, buffer and string, with ContentType | pass | pass | pass | pass |
| HeadObject size and ContentType | pass | pass | pass | pass |
| GetObject whole, ContentType back | pass | pass | pass | pass |
| GetObject on a missing key is `NoSuchKey` | pass | pass | pass | pass |
| `Upload` of a 3 MB file (one PUT) | pass | pass | pass | pass |
| `Upload` of 50 MB (7 parts) | pass | pass | pass | pass |
| GetObject whole on the 50 MB multipart object | pass | **fail** (see below) | pass | pass |
| Range: first KiB, open end, suffix, end past EOF, across a part boundary | pass | pass | pass | pass |
| Range at EOF and `bytes=-0` give `InvalidRange` | pass | pass | pass | pass |
| An aborted multipart upload leaves nothing | pass | pass | pass | pass |
| DeleteObject, existing and missing | pass | pass | pass | pass |
| ListObjectsV2 and ListBuckets (backup tools) | pass | pass | pass | pass |
| Presigned GET (unused) | pass | pass | pass | pass |
| PutObject with `ACL: public-read` (unused) | pass | pass | pass | pass |
| **Total** | 24/24 | 23/24, and 24/24 with the setting | 24/24 | 24/24 |

Garage needed two changes before any of it worked:

- **Region.** Garage checks the region in the signature. With its default
  `s3_region = "garage"` every call failed with `AuthorizationHeaderMalformed`,
  because the server signs for `auto`. Setting `s3_region = "auto"` in
  `garage.toml` fixes it with no change to Gryt's env. `ops/deploy/host`
  defaults `S3_REGION` to `us-east-1`, so that file would have to match.
- **Checksums on multipart objects.** The SDK asks for a checksum on every GET
  and checks it. For an object uploaded in parts, MinIO answers with a
  composite CRC32 like `cqJzwA==-7` and `ChecksumType: COMPOSITE`, and the SDK
  knows to skip those. Garage sends the composite value without the `-7` and
  without a type, so the SDK checks it against the whole body and throws
  `Checksum mismatch` at the end of the stream. Setting
  `AWS_RESPONSE_CHECKSUM_VALIDATION=when_required` on the server and the worker
  fixes it, and so would `responseChecksumValidation: "WHEN_REQUIRED"` in both
  clients. Uploads still send checksums either way. I didn't find an upstream
  issue for it.

### The real server

`gryt-e2e.sh` runs the server and the image worker from `main` against one
store. It makes a member, uploads a 5.6 MB PNG and a 49 MB MP4 through
`POST /api/uploads`, reads both back through `GET /api/uploads/files/:id`,
checks a ranged read and a 416, fetches the video's poster frame, and waits for
the worker's AVIF thumbnail.

| | MinIO | Garage | Garage with the setting | SeaweedFS | RustFS | Filesystem |
|---|---|---|---|---|---|---|
| Steps passed | 8/8 | 4/8, then the server crashed | 8/8 | 8/8 | 8/8 | 8/8 |

Without the checksum setting, Garage sent the whole video through to the last
byte. Then the SDK threw, nothing caught it, and the server process exited, so
every request after that failed. That's Gryt's bug as much as Garage's, because
the file route pipes the S3 body into the response with no error handler. It's
GRYT-1444, whichever store we pick.

### Numbers

These were measured on an M-series Mac under OrbStack, so the speeds are far
above a Pi's. Memory is from `docker stats`. Idle is 30 seconds after the
container turned healthy. The peak is while `measure.sh` ran the matrix and then
20 seconds of 50 MB multipart uploads and ranged reads back to back. Each store
got two fresh runs, and both results are shown.

| | MinIO (pgsty) | Garage | SeaweedFS | RustFS |
|---|---|---|---|---|
| Idle, empty | 86 / 127 MiB | 8 / 24 MiB | 92 / 120 MiB | 65 / 101 MiB |
| Peak under upload load | 236 / 297 MiB | 27 / 47 MiB | 1,742 / 1,778 MiB | 303 / 350 MiB |
| Idle, 10 minutes after taking in 1 GiB | 363 MiB | 11 MiB | 456 MiB | 445 MiB |
| Under a 512 MiB limit | not tried | not tried | OOM-killed; survives with `GOMEMLIMIT=384MiB` (peak 373 MiB) | not tried |
| One 50 MB upload (Mac) | 522 / 538 MB/s | 476 / 494 MB/s | 344 / 348 MB/s | 261 / 338 MB/s |
| Image, arm64 / amd64, compressed | 49 / 55 MB | 27 / 28 MB | 186 / 195 MB | 104 / 110 MB |
| Architectures | amd64, arm64 | amd64, arm64, arm, 386 | amd64, arm64, arm/v7, 386 | amd64, arm64 |
| Licence | AGPL-3.0 | AGPL-3.0 | Apache-2.0 | Apache-2.0 |
| Version tested, released | 2026-08-04 community build | v2.4.1, 2026-09-08 | 4.47, 2026-09-14 | 1.0.0, 2026-09-16 |
| Release cadence | pgsty rebuilds | v2.2.0 in January, v2.3.0 in April, v2.4.0 in September, plus patches | about weekly (12 releases from June 25 to September 14) | first stable last week; previews almost daily |
| Published security advisories | n/a | none found on its forge | 25 since June 10, 9 of them critical | 35 since December 2025, 4 critical |
| Runs as | root | root | root | uid 10001 |

Overwritten data doesn't all go away at once. After the load run, which kept
rewriting four 50 MB keys, MinIO was back to 251 MiB within about five
minutes. SeaweedFS held 7,065 MiB and RustFS 4,968 MiB (4.7 GB of it in
`.rustfs.sys/tmp`), both for about 250 MiB of live objects. They were still
that size five minutes after the load, and down to about 250 MiB each after
twenty. So a disk needs room for about twenty minutes of overwrites on top of
what's stored.
Garage used 54 MiB, because it stores content-addressed blocks and the load
reused one file.

### Bucket bootstrap

What replaces `minio-init` and `mc`:

- **Garage.** Nothing. `garage server --single-node --default-bucket` builds the
  layout, then makes the key and the bucket from `GARAGE_DEFAULT_ACCESS_KEY`,
  `GARAGE_DEFAULT_SECRET_KEY` and `GARAGE_DEFAULT_BUCKET`. Restarting it is
  harmless. The image has no shell, so the healthcheck is
  `["CMD", "/garage", "health"]`. The access key can be any string, but the
  secret has to be at least 16 characters, so the `minioadmin` default in
  `prod.yml` won't start. A bucket the server makes through `CreateBucket` is
  only visible to that key, while the default bucket is global. There's no
  `mc`, so `backup.sh` and `snapshot.sh` would move to `rclone`.
- **SeaweedFS.** The key pair goes in an `s3.json` identity file, passed as a
  compose `config`, and the server's own `ensureBucket` makes the bucket. With
  no identity file, S3 is open to anyone who can reach it. The healthcheck is
  `wget -qO- http://127.0.0.1:8333/healthz`. `weed server` also starts Iceberg,
  Lance and admin listeners by default.
- **RustFS.** `RUSTFS_ACCESS_KEY` and `RUSTFS_SECRET_KEY`, and then either
  `ensureBucket` or the existing `mc mb` works. `mc mirror` works too, so the
  backup scripts keep working. The healthcheck is
  `curl -fs http://127.0.0.1:9000/health`.
- **Filesystem.** A `mkdir`, which `ensureBucket` already does. The server and
  the worker already share `/data`, because the worker reads `gryt.db`.

All of them fit in one compose service with no manual step.

### Migration

`seed.cjs` wrote 2,572 objects (1,022 MiB) into a fresh `pgsty/minio` volume, in
the server's key layout and with content types: twelve 50 MB videos as
multipart, 150 images, thumbnails, avatars, emojis, raw emoji jobs and server
icons. `migrate.sh` copies the bucket with a one-shot `rclone/rclone:1.71`
container on a network both stores are on, the way a compose service would.
`verify.cjs` then compares every object's SHA-256, size and Content-Type on
both sides.

| Target | Tool | Time for 1 GiB | Objects | Mismatches |
|---|---|---|---|---|
| Garage | rclone sync | 2.8 s | 2,572 of 2,572 | 0 |
| SeaweedFS | rclone sync | 3.3 s | 2,572 of 2,572 | 0 |
| RustFS | rclone sync | 2.3 s | 2,572 of 2,572 | 0 |
| RustFS | `mc mirror` (pgsty/mc) | about 4 s | 2,572 of 2,572 | 0 |
| RustFS | none, started on a copy of the MinIO volume | 0 | 2,572 of 2,572 | 0 |
| Filesystem | rclone sync, then the `.meta` files | 2.0 s | 2,572 | 0 |

Those times are for a Mac SSD. A Pi 4 on a USB SSD will be limited by the disk.
I'd guess 10 to 60 seconds a gigabyte there, but I haven't measured it.

For RustFS in place, I copied the MinIO volume, `chown`ed it to uid 10001 and
started RustFS on it. It listed and served all 2,572 objects with the same
bytes and types, and passed the matrix writing into it. Then I stopped it and
started `pgsty/minio` on the same directory. MinIO read the original objects
and listed the new ones RustFS had written. So there's a switch with no copy
and a way back, tested once, on one version of each.

The steps for an existing deployment, for any of the S3 targets:

1. Start the new store next to MinIO, with an empty volume.
2. Stop the server and the image worker, so nothing writes during the copy.
3. Run rclone once on the compose network: `rclone sync src:gryt dst:gryt`,
   with both remotes set through `RCLONE_CONFIG_*` env vars (see `migrate.sh`).
4. Check the counts, or run `verify.cjs`.
5. Point `S3_ENDPOINT` and the keys at the new store. For Garage, also set
   `AWS_RESPONSE_CHECKSUM_VALIDATION=when_required` until the clients do it
   themselves.
6. Start the server and the worker. Keep the MinIO volume until a backup has
   run from the new store.

For the filesystem, step 3 is `rclone sync src:gryt /data/gryt` into the
server's data volume, then a `<key>.meta` file per object holding
`{"contentType": "..."}` for the server icon route, then
`chown -R 1001:1001`. `migrate.sh` does all three.

### Filesystem by default, sized

The brief assumed the worker would need a filesystem mode. It's had one since
March (`packages/image-worker/src/storage.ts`), with the same
`<DATA_DIR>/<bucket>/<key>` and `.meta` layout as the server. So no server or
worker code is needed. What's left:

- **Compose.** In `prod.yml`, `beta.yml`, `ops/deploy/host/compose.yml` and the
  community compose: drop `minio` and `minio-init`, set
  `STORAGE_BACKEND=filesystem` on the server and the worker, and keep
  `S3_BUCKET` as the folder name. That's about 30 to 40 lines out and 4 in per
  file.
- **CLI.** Make `filesystem` the recommended answer, after fixing GRYT-1443.
  Right now the CLI doesn't set `S3_BUCKET` for a filesystem server, so every
  upload fails with `S3_BUCKET not configured`, and it only writes the image
  worker for `shared` storage. Probably 30 to 60 lines of Go plus tests.
- **Backups.** `backup.sh` swaps `mc mirror` for an `rsync` or `tar` of
  `/data/gryt`. About 10 lines.
- **Migration.** A one-shot that runs the filesystem branch of `migrate.sh`.
  About 20 lines.
- **Docs.** The self-hosting pages walk through MinIO.

Call it a day or two of work. There are limits, though. Objects are written
straight to their final path, so a backup or a reader can catch a file halfway
through. Nothing's shared between machines, so the commented-out second server
in `prod.yml`, which shares MinIO and the bucket, would need its own volume or a
real store. `getObjectSignedUrl` throws, but nothing calls it. And anybody who
wants R2, S3 or their own Garage can still set `STORAGE_BACKEND=s3`.

## Found along the way

- GRYT-1443: a CLI server on filesystem storage can't take uploads, and gets no
  image worker.
- GRYT-1444: a storage error partway through a file download kills the server.
  Garage's checksum error set it off. Restarting MinIO in the middle of a paused
  download didn't.
- GRYT-1445: CLI servers on one machine share a bucket, and emojis are keyed
  `emojis/<name>.<ext>` with nothing about the server in the key. Two servers'
  `:wave:` overwrite each other. That's from reading the code; I didn't
  reproduce it.

## Open questions

- Filesystem covers the CLI and `ops/deploy/host`, but what about Gryt's own
  prod, beta and community on dev.lan? Garage means a copy and two env changes.
  RustFS means no copy, if we're fine running something that new.
- If it's Garage, do we set `responseChecksumValidation: "WHEN_REQUIRED"` in the
  server's and the worker's S3 clients, or leave it to an env var in compose?
  The code change also covers people who bring their own Garage. Both files are
  in review-required paths.
- Should somebody report Garage's composite checksum header upstream?
- Nothing here ran over HTTPS or on a Pi. Garage has an open issue (#1549, filed
  today) about rejecting `STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER` uploads,
  which the SDK may send to an HTTPS endpoint. Gryt's compose files use plain
  HTTP inside the network, and that worked.
- The HA snapshot script isn't on `main` yet. Whoever lands it will have to drop
  `mc` for whichever store we pick.

## Running it again

Everything is named `gryt-eval-*` and listens on `127.0.0.1`: MinIO on 19100,
Garage on 19200, SeaweedFS on 19300 and RustFS on 19400. `SERVER_DIR` is a
`packages/server` checkout with `node_modules`, and `WORKER_DIR` is the same for
`packages/image-worker`.

```bash
cd docs/design/object-storage-eval
SERVER_DIR=... ./run-all.sh                    # matrix and memory for each store
docker compose -f compose/minio.yml up -d --wait
SERVER_DIR=... WORKER_DIR=... ./gryt-e2e.sh http://127.0.0.1:19100 evaladmin evalsecret-evalsecret
SERVER_DIR=... S3_ENDPOINT=http://127.0.0.1:19100 S3_ACCESS_KEY_ID=evaladmin \
  S3_SECRET_ACCESS_KEY=evalsecret-evalsecret node seed.cjs
docker compose -f compose/garage.yml up -d --wait
./migrate.sh garage                            # or seaweedfs, rustfs, "rustfs mc", "filesystem <dir>"
# clean up
for f in compose/*.yml; do docker compose -f "$f" down -v; done
docker network rm gryt-eval-migrate
```

Anything run against Garage needs `AWS_RESPONSE_CHECKSUM_VALIDATION=when_required`
in the environment; `run-all.sh` sets it.
