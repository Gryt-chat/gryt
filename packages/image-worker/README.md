<div align="center">
  <img src="https://raw.githubusercontent.com/Gryt-chat/client/main/public/logo.svg" width="80" alt="Gryt logo" />
  <h1>Gryt Image Worker</h1>
  <p>Background image processing worker for the <a href="https://github.com/Gryt-chat/gryt">Gryt</a> voice &amp; video platform.<br />Compresses uploads to AVIF, generates thumbnails, and updates the shared SQLite database &mdash; powered by <a href="https://sharp.pixelplumbing.com/">Sharp</a>.</p>
</div>

<br />

## Docker

```bash
docker pull ghcr.io/gryt-chat/image-worker:latest
docker run -v gryt-data:/data --env-file .env ghcr.io/gryt-chat/image-worker:latest
```

Browse tags at [ghcr.io/gryt-chat/image-worker](https://github.com/Gryt-chat/image-worker/pkgs/container/image-worker).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `./data` | Path to the shared data directory (contains `gryt.db`) |
| `S3_BUCKET` | — | S3 bucket name (or subdirectory name for filesystem storage) |
| `STORAGE_BACKEND` | `s3` | Storage backend: `s3` or `filesystem` |
| `S3_ENDPOINT` | — | S3-compatible endpoint (e.g. MinIO) |
| `S3_REGION` | `auto` | S3 region |
| `S3_ACCESS_KEY_ID` | — | S3 access key |
| `S3_SECRET_ACCESS_KEY` | — | S3 secret key |
| `S3_FORCE_PATH_STYLE` | `false` | Use path-style S3 URLs (required for MinIO) |
| `IMAGE_WORKER_CONCURRENCY` | `2` | Max concurrent image processing jobs (1–8) |
| `IMAGE_WORKER_POLL_MS` | `1000` | Database polling interval in milliseconds (250–10000) |
| `HEALTH_PORT` | `8080` | HTTP health check port |

## Quick Start (development)

```bash
yarn install
yarn dev
```

## Build

```bash
yarn build
yarn start
```

## Documentation

Full docs at **[docs.gryt.chat/docs/deployment](https://docs.gryt.chat/docs/deployment)**.

## Issues

Please report bugs and request features in the [main Gryt repository](https://github.com/Gryt-chat/gryt/issues).

## License

[AGPL-3.0](https://github.com/Gryt-chat/gryt/blob/main/LICENSE) — Part of [Gryt](https://github.com/Gryt-chat/gryt)
