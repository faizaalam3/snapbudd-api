# Single-stage install — avoids npm ci lockfile issues on some cloud builders
FROM node:22-slim AS build
WORKDIR /app

# Install with dev deps first (do not set NODE_ENV=production here)
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
