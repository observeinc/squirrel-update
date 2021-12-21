FROM node:17
COPY index.html index.js s3.js config.json package.json npm-shrinkwrap.json ./
RUN npm install --production
EXPOSE 8080
ENTRYPOINT [ "node", "index.js" ]
