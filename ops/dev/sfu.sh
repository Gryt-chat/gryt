#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/ops/dev/common.env.sh"

cd "${ROOT_DIR}/packages/sfu"
./start.sh

