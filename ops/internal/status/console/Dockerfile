# @gryt/ui's published stylesheet, pinned. It carries the token system this page
# is styled from — colours, radii, spacing — so the console looks like Gryt
# without pulling React and a bundler in for one form.
#
# Bump the version to pick up a design change.
FROM node:22-alpine AS styles
ARG GRYT_UI_VERSION=0.28.0
WORKDIR /tmp/ui
RUN npm pack "@gryt/ui@${GRYT_UI_VERSION}" --silent \
  && tar -xzf gryt-ui-*.tgz \
  && cp package/dist/styles.css /styles.css

FROM node:22-alpine

# No runtime dependencies. Everything here is a Node built-in, so there is no
# lockfile to keep current and nothing to audit on a box that only runs this.
WORKDIR /app
COPY server.mjs hash-password.mjs ./
COPY --from=styles /styles.css ./styles.css

USER node
EXPOSE 3002

HEALTHCHECK --interval=60s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
