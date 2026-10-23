FROM zfnd/zebra:6.3.0
COPY regtest/zebrad.toml /etc/zebra/zebrad.toml
COPY docker/railway/zebrad-entrypoint.sh /usr/local/bin/zebrad-entrypoint.sh
RUN chmod +x /usr/local/bin/zebrad-entrypoint.sh
EXPOSE 18234
# Railway volumes are mounted root-owned; ensure the state cache exists and is writable
# before Zebra creates its RocksDB database.
USER root
ENTRYPOINT ["/usr/local/bin/zebrad-entrypoint.sh"]
