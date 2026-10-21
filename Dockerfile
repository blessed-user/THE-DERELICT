# THE DERELICT — runtime image. The SPA is built inside the image so a fresh
# checkout only needs Docker, not a host Node toolchain.
FROM node:22-alpine AS spa
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY shared ./shared
COPY web ./web
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY shared ./shared
COPY server ./server
COPY scripts ./scripts
COPY --from=spa /app/web/dist ./web/dist
ENV PORT=8791
EXPOSE 8791
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8791/api/config || exit 1
CMD ["node", "server/index.mjs"]
