FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    CASS_HOST=0.0.0.0 \
    CASS_PORT=3000 \
    CASS_CSV_PATH=/data/sms-records.csv

COPY package.json ./
COPY server.js ./
COPY public ./public

RUN addgroup -S cass && adduser -S cass -G cass && mkdir -p /data && chown -R cass:cass /app /data
USER cass

EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "server.js"]
