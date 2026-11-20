FROM node:24-alpine
WORKDIR /app
COPY server.js package.json ./
COPY public/ ./public/
ENV NODE_ENV=production PORT=3000 DATA_DIR=/var/lib/novacon
USER node
EXPOSE 3000
CMD ["node", "server.js"]
