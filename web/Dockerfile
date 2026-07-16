# cspell:ignore VITE
FROM node:26.4.0-bookworm-slim AS build

WORKDIR /workspace

RUN npm install --global pnpm@11.9.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/package.json
RUN pnpm install --frozen-lockfile --filter @shareslices/web...

COPY tsconfig.base.json ./
COPY web/ web/
ARG VITE_GALLERY_TURNSTILE_PUBLIC_SITE_ID=""
RUN VITE_GALLERY_TURNSTILE_SITE_KEY="$VITE_GALLERY_TURNSTILE_PUBLIC_SITE_ID" pnpm --dir web run build

FROM caddy:2.10.2-alpine AS runtime

ENV XDG_CONFIG_HOME=/tmp/caddy/config
ENV XDG_DATA_HOME=/tmp/caddy/data

COPY --from=build --chown=10001:10001 /workspace/web/dist /srv
RUN printf ':8080 {\n  handle /a/* {\n    reverse_proxy api:7456\n  }\n  handle /artifacts/*/preview {\n    root * /srv\n    rewrite * /index.html\n    header Cache-Control "no-store"\n    file_server\n  }\n  handle {\n    root * /srv\n    try_files {path} /index.html\n    file_server\n  }\n}\n' > /etc/caddy/Caddyfile

USER 10001:10001
EXPOSE 8080

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
