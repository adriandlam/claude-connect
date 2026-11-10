# oven/bun:1.3.14-alpine
FROM oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a
ENV NODE_ENV=production
WORKDIR /app
COPY server.ts .
# Root, because Railway mounts volumes owned by root; a non-root user could not write DB_PATH there.
CMD ["bun", "server.ts"]
