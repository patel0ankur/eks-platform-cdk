# Container image for ${{ values.name }}. The platform's CodeBuild pipeline
# builds this and pushes it to ECR; ArgoCD then deploys the k8s/ manifests.
FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json ./
RUN npm install --omit=dev

COPY app.js ./

EXPOSE ${{ values.port }}
USER node
CMD ["node", "app.js"]
