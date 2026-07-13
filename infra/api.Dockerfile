FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY seed-harnesses ./seed-harnesses
COPY templates ./templates
COPY data ./data

RUN npm ci
RUN npm run build -w @harnesshub/api -w @harnesshub/schema -w @harnesshub/semantic-diff -w onlyharness

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV HARNESS_API_HOST=0.0.0.0
ENV HARNESS_API_PORT=8787
ENV HARNESS_WORKSPACE_ROOT=/app

COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/seed-harnesses ./seed-harnesses
COPY --from=build /app/templates ./templates
COPY --from=build /app/data ./data

EXPOSE 8787
CMD ["node", "apps/harness-api/dist/server.js"]
