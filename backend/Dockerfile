FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev
RUN npx playwright install --with-deps chromium


COPY . .

ENV PORT=4000
EXPOSE 4000

CMD ["node", "server.js"]
