FROM node:22-alpine
WORKDIR /app
COPY e2e/bootstrap.mjs ./bootstrap.mjs
CMD ["node", "bootstrap.mjs"]
