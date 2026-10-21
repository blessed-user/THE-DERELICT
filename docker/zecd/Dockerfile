# zecd static Linux binary for the regtest funder wallet.
FROM alpine:3.22
RUN addgroup -g 10001 zecd \
 && adduser -D -u 10001 -G zecd zecd \
 && mkdir -p /var/lib/zecd \
 && chown zecd:zecd /var/lib/zecd
COPY zecd /usr/local/bin/zecd
RUN chmod +x /usr/local/bin/zecd
COPY derelict-entrypoint.sh /usr/local/bin/derelict-entrypoint.sh
RUN chmod +x /usr/local/bin/derelict-entrypoint.sh
USER zecd
WORKDIR /var/lib/zecd
EXPOSE 18242 9243
ENTRYPOINT ["/usr/local/bin/derelict-entrypoint.sh"]
