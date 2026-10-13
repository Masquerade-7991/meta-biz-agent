# The API server, every role from one image: ROLE=api|ingress|worker|stream (unset: all in one).
# Node runs the TypeScript directly, as `npm run dev:server` does. The front-end is built and
# served elsewhere (Vercel); only what the server imports is copied.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY src/app ./src/app
COPY docs/openapi.json ./docs/openapi.json
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:'+(process.env.PORT||8787)+'/api/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.ts"]
