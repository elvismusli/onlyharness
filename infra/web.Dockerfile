FROM node:24-alpine AS build

WORKDIR /app

ARG VITE_HARNESS_API_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

ENV VITE_HARNESS_API_URL=$VITE_HARNESS_API_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/registry-web ./apps/registry-web

RUN npm ci
RUN npm run build -w @harnesshub/registry-web

FROM caddy:2.8-alpine

COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/registry-web/dist /srv/web

EXPOSE 80 443
