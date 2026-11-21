FROM node:20-alpine

WORKDIR /app

# Install dependensi dulu agar layer cache Docker optimal
COPY package*.json ./
RUN npm install --omit=dev

# Salin source code backend dan frontend
COPY server.js db.js ./
COPY public ./public

EXPOSE 3000

CMD ["node", "server.js"]