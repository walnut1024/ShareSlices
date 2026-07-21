# cspell:words addgroup adduser setcap
FROM caddy:2.10.2-alpine

RUN setcap -r /usr/bin/caddy \
    && addgroup -S -g 10001 shareslices \
    && adduser -S -D -H -u 10001 -G shareslices shareslices

ENV XDG_CONFIG_HOME=/tmp/caddy/config
ENV XDG_DATA_HOME=/tmp/caddy/data

USER 10001:10001
EXPOSE 8080

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
