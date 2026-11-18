# GitHub's own runner image, plus the C toolchain gryt-cloud's cargo build links with.
FROM ghcr.io/actions/actions-runner:2.338.2

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential pkg-config libssl-dev ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir /state && chown runner:runner /state
# Yarn 1, which GitHub's own machines carry and the scraper's lockfile wants. Node comes from setup-node.
RUN curl -fsSL https://github.com/yarnpkg/yarn/releases/download/v1.22.22/yarn-v1.22.22.tar.gz | tar -xz -C /opt \
 && ln -s /opt/yarn-v1.22.22/bin/yarn /usr/local/bin/yarn
USER runner

COPY --chown=runner:runner entrypoint.sh /home/runner/entrypoint.sh
ENTRYPOINT ["/home/runner/entrypoint.sh"]
