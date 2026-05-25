FROM node:20-alpine
WORKDIR /app
COPY package.json serverless.yml handler.js ./
# devDependencies are required — sls offline and serverless-s3-local run inside the container
RUN npm install
RUN mkdir -p /tmp/kijani-s3-local
# HTTP API :3000  |  local S3 server :4569
EXPOSE 3000 4569
CMD ["npx", "sls", "offline", "start", "--host", "0.0.0.0"]
