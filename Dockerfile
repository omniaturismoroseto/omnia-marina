# Immagine di produzione di Omnia Marina (adatta a Google Cloud Run e a qualsiasi server con Docker).
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-slim AS runner
WORKDIR /app
# AUTO_MIGRATE: all'avvio il database viene portato all'ultima versione (vedi src/instrumentation.ts).
# PORT: Cloud Run la imposta da sé; 8080 è il valore usato fuori da Cloud Run.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=8080 AUTO_MIGRATE=true
# I file appartengono all'utente "node" (non root): il server deve poter scrivere la propria cache in .next.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 8080
CMD ["node", "server.js"]
