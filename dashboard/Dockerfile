FROM oven/bun:1
WORKDIR /app

# Copy dashboard files
COPY server.ts .
COPY views/ views/
COPY static/ static/

# Copy shared dependencies from parent
COPY ../package.json ./package.json

RUN bun install --production

EXPOSE 3000
CMD ["bun", "run", "server.ts"]
