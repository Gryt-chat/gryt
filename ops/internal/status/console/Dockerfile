FROM node:22-alpine

# No dependencies on purpose. Everything here is a Node built-in, so there is no
# lockfile to keep current and nothing to audit on a box that only runs this.
WORKDIR /app
COPY server.mjs hash-password.mjs ./

USER node
EXPOSE 3002

HEALTHCHECK --interval=60s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
