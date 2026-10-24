FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm run build && npm test
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
