# AWS DevOps Agent plugin for Backstage (backend)

Backend for the [AWS DevOps Agent frontend plugin](../devops-agent/README.md). It
holds AWS credentials and proxies the AWS DevOps Agent API so the browser never
sees credentials. It exposes routes the frontend calls to list recommendations
and investigations, drive chat, and trigger investigations via a generic webhook.

## Installation

```bash
yarn --cwd packages/backend add @your-scope/backstage-plugin-aws-devops-agent-backend
```

Add it to your backend:

```ts
// packages/backend/src/index.ts
const backend = createBackend();
// ...
backend.add(import('@your-scope/backstage-plugin-aws-devops-agent-backend'));
```

## Configuration

All config lives under `devOpsAgent` in `app-config.yaml`. The full schema is in
[`config.d.ts`](./config.d.ts).

### Local / demo (no AWS)

```yaml
devOpsAgent:
  mock: true # serve deterministic mock data; no AWS calls
```

### Real AWS DevOps Agent

```yaml
devOpsAgent:
  mock: false
  # Optional. Falls back to standard AWS region resolution (AWS_REGION, etc.).
  region: us-east-1
  # Optional cross-account role to assume to reach the Agent Space.
  # assumeRoleArn: arn:aws:iam::123456789012:role/backstage-devops-agent
  # How the agent resolves the calling user's identity for chat (default IAM).
  # userType: IDC
  # Per-Agent-Space generic webhook (only needed for "Start investigation").
  spaces:
    your-agent-space-id:
      webhook:
        url: https://event-ai.us-east-1.api.aws/webhook/generic/XXXXXXXX
        secret: ${DEVOPS_AGENT_WEBHOOK_SECRET}
```

### AWS credentials

Credentials come from the **default AWS SDK provider chain** — environment
variables, a shared profile, EKS Pod Identity / IRSA, ECS task roles, etc. — so
the plugin works wherever you run Backstage without embedding secrets. Use
`region` / `assumeRoleArn` only when you need to override the defaults.

The credentials must allow the AWS DevOps Agent read operations the plugin uses
(`ListRecommendations`, `ListBacklogTasks`, `ListExecutions`, `CreateChat`,
`SendMessage`). The "Start investigation" action does not use IAM — it posts to
the per-space **generic webhook** with HMAC authentication, so it only needs the
webhook `url` + `secret` (created in the AWS DevOps Agent console under your
Agent Space → Capabilities → Webhook).

## Annotations

Components opt in by declaring their Agent Space (see the
[frontend README](../devops-agent/README.md)):

```yaml
metadata:
  annotations:
    aws-devops-agent/space-id: <your-agent-space-id>
    # aws-devops-agent/service-id: <service-id>   # optional
```

## Routes

All routes require an authenticated user and are scoped to a space id from the
path:

| Method & path | Purpose |
| --- | --- |
| `GET  /spaces/:spaceId/recommendations` | List open recommendations |
| `GET  /spaces/:spaceId/investigations` | List recent investigations |
| `POST /spaces/:spaceId/chat` | Start a chat session |
| `POST /spaces/:spaceId/chat/:executionId/messages` | Send a message, get the reply |
| `POST /spaces/:spaceId/investigations` | Trigger an investigation (webhook) |

## Development

Run the whole app (frontend + backend) with `yarn start` from the repo root, or
start this backend standalone with `yarn start` in this package. Use
`devOpsAgent.mock: true` to develop without AWS.

## License

Apache-2.0
