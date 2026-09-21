# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace=apps/server --workspace=apps/web
# Drop dev tooling; workspace packages stay linked.
RUN npm prune --omit=dev

FROM node:24-alpine
# ffmpeg converts MKV/HEVC/DTS files that browsers cannot decode natively.
# tar is used for backups.
RUN apk add --no-cache ffmpeg tar
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
      org.opencontainers.image.description="Self-hosted interface for Radarr, Sonarr, Lidarr, Prowlarr, Bazarr, and qBittorrent" \
      org.opencontainers.image.licenses="MIT"
EXPOSE 3000
VOLUME ["/app/apps/server/data"]
CMD ["npm", "start", "--workspace=apps/server"]
