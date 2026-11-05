# Los XSD oficiales se bajan al construir la imagen: necesita acceso a ekuatia.set.gov.py.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json schemas.lock.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm ci --ignore-scripts
RUN npm run build
RUN node scripts/download-xsd.mjs
RUN npm prune --omit=dev --ignore-scripts

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production SANDBOX_HOST=0.0.0.0 SANDBOX_PORT=3900 SANDBOX_XSD_DIR=/app/xsd
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/xsd ./xsd
USER node
EXPOSE 3900
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3900/__sandbox/health || exit 1
CMD ["node", "dist/index.js"]
