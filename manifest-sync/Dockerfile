FROM node:22-alpine
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build
# certs mounted at runtime, never baked into image
VOLUME ["/certs"]
CMD ["node", "dist/main.js"]
