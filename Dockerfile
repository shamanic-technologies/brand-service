# Stage 1: Builder
# Cette étape installe les dépendances, compile le code et prépare les fichiers de production.
FROM node:20-slim AS builder

WORKDIR /app

# Installer pnpm
RUN npm install -g pnpm

# Copier tous les fichiers du projet.
COPY . .

# Nettoyer node_modules existants pour forcer une réinstallation propre
RUN rm -rf node_modules

# Installer TOUTES les dépendances du monorepo pour pouvoir builder.
RUN pnpm install -r --no-frozen-lockfile

# Construire uniquement le `company-service`
RUN pnpm --filter company-service build

# Préparer un répertoire de production propre pour le service
# avec uniquement les dépendances de production.
RUN pnpm deploy --filter company-service --legacy /prod

# Stage 2: Production
# Cette étape crée l'image finale en ne copiant que le nécessaire depuis le builder.
FROM node:20-slim

WORKDIR /app

# Install pnpm in production image (needed for migrations)
RUN npm install -g pnpm

# Copier le répertoire de production préparé depuis le builder
COPY --from=builder /prod .

# Copy migrations directory (not included in pnpm deploy)
COPY --from=builder /app/apps/company-service/migrations ./migrations

# Force IPv4 first to avoid IPv6 connection issues with Neon
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

# Exposer le port que votre service écoute
EXPOSE 8080

# La commande pour démarrer le service
CMD ["node", "dist/index.js"]

