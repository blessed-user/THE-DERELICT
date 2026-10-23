FROM zfnd/zebra:6.3.0
COPY regtest/zebrad.toml /etc/zebra/zebrad.toml
EXPOSE 18234
CMD ["zebrad", "-c", "/etc/zebra/zebrad.toml", "start"]
