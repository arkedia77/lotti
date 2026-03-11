FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY server.js .
RUN mkdir -p /app/data /app/uploads
EXPOSE 3002
CMD ["node", "server.js"]
