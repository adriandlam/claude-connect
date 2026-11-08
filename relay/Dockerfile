# oven/bun:1.3.14-alpine
FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0
ENV NODE_ENV=production
WORKDIR /app
COPY server.ts .
# Root, because Railway mounts volumes owned by root; a non-root user could not write DB_PATH there.
CMD ["bun", "server.ts"]
