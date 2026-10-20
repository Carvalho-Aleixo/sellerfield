FROM oven/bun:1-slim
WORKDIR /app
COPY src ./src
COPY web ./web
COPY migrations ./migrations
COPY test/fixtures ./test/fixtures
ENV SELLERFIELD_HOST=0.0.0.0 SELLERFIELD_PORT=8787 SELLERFIELD_DB=/data/sellerfield.sqlite
RUN mkdir /data && chown bun /data
VOLUME /data
EXPOSE 8787
USER bun
CMD ["bun", "src/server.ts"]
