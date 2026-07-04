FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY apps ./apps
COPY packages ./packages
COPY seed-harnesses ./seed-harnesses
COPY scripts ./scripts
RUN npm install
EXPOSE 8787
CMD ["npm", "run", "start", "-w", "@harnesshub/api"]
