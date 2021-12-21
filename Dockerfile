FROM node:17
WORKDIR /node/
EXPOSE 8080
COPY config.json package.json npm-shrinkwrap.json ./
COPY src/ ./src/
COPY data/ ./data/
RUN npm install --production
RUN pwd && ls -l
CMD node src/index.js
