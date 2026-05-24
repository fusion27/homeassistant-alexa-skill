FROM node:20-alpine
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build
# certs mounted at runtime, never baked into image
VOLUME ["/certs"]
CMD ["node", "dist/bridge.js"]
