# zecd static Linux binary for the regtest funder wallet.
FROM alpine:3.22
RUN addgroup -g 10001 zecd \
 && adduser -D -u 10001 -G zecd zecd \
 && mkdir -p /var/lib/zecd /etc/zecd \
 && chown zecd:zecd /var/lib/zecd
COPY docker/zecd/zecd /usr/local/bin/zecd
RUN chmod +x /usr/local/bin/zecd
COPY docker/zecd/derelict-entrypoint.sh /usr/local/bin/derelict-entrypoint.sh
COPY regtest/zecd.toml /etc/zecd/zecd.toml
RUN chmod +x /usr/local/bin/derelict-entrypoint.sh
USER zecd
WORKDIR /var/lib/zecd
EXPOSE 18242 9243
ENTRYPOINT ["/usr/local/bin/derelict-entrypoint.sh"]
