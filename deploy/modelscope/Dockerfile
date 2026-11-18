# Context: 仓库根目录（必须先把 public/models 构建进 dist）
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7860
COPY dist ./dist
COPY deploy/modelscope/server.mjs ./server.mjs
EXPOSE 7860
CMD ["node", "server.mjs"]
