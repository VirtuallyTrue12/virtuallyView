# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
COPY . .
# npm skips an optional native package it fails to download (Rollup's, here) and the build then dies later.
# Check it loaded and try again a few times, so one bad download does not sink the install.
RUN for i in 1 2 3 4; do npm ci && node -e "require('rollup')" && exit 0; echo "install attempt $i failed, retrying"; rm -rf node_modules; sleep 3; done; exit 1
RUN npm run build --workspace=apps/server --workspace=apps/web
# Drop dev tooling; workspace packages stay linked.
RUN npm prune --omit=dev

FROM node:24-alpine
# ffmpeg converts MKV/HEVC/DTS files that browsers cannot decode natively.
# tar is used for backups; curl carries the optional Tor/SOCKS5 proxy calls.
RUN apk add --no-cache ffmpeg tar curl
# yt-dlp is used only by the optional YouTube service (docker compose --profile youtube).
RUN curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_musllinux && chmod 755 /usr/local/bin/yt-dlp
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages ./packages
COPY --from=build /app/themes ./themes
COPY --from=build /app/scripts ./scripts
LABEL org.opencontainers.image.title="virtuallyView" \
      org.opencontainers.image.description="Self-hosted media manager and browser player for the Radarr, Sonarr and Lidarr stack" \
      org.opencontainers.image.source="https://github.com/VirtuallyTrue12/virtuallyView" \
      org.opencontainers.image.licenses="MIT"
EXPOSE 3000
VOLUME ["/app/apps/server/data"]
CMD ["npm", "start", "--workspace=apps/server"]
