FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY src/ ./src/
COPY tsconfig.json ./
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3333/health || exit 1
CMD ["bun", "run", "src/server.ts"]
