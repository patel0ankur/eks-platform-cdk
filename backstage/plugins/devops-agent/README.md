# AWS DevOps Agent plugin for Backstage (frontend)

Adds a per-component **DevOps Agent** tab to the Backstage catalog, surfacing
[AWS DevOps Agent](https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.html)
for the service you're looking at: open **recommendations**, recent
**investigations**, an **"Ask the agent"** chat, and a **"Start investigation"**
action — all scoped to that component's Agent Space.

> Requires the companion backend plugin
> [`@your-scope/backstage-plugin-aws-devops-agent-backend`](../devops-agent-backend/README.md),
> which holds AWS credentials and talks to the AWS DevOps Agent API. The browser
> never sees AWS credentials.

> **Frontend system:** this plugin targets the Backstage **new frontend system**
> (`createApp({ features })`). Apps still on the old frontend system are not
> supported.

## How it works

The tab appears on any catalog entity that declares an Agent Space via an
annotation, mirroring how the Kubernetes and ArgoCD plugins gate their tabs:

```yaml
# catalog-info.yaml
metadata:
  annotations:
    aws-devops-agent/space-id: <your-agent-space-id>
    # optional: scope to a specific DevOps Agent "Service"
    # aws-devops-agent/service-id: <service-id>
```

Only users who can see the component (Backstage permissions + ownership) see the
tab, and the backend only ever talks to that component's declared Agent Space —
which itself enforces per-space user access in AWS DevOps Agent.

## Installation

Install both packages:

```bash
# frontend
yarn --cwd packages/app add @your-scope/backstage-plugin-aws-devops-agent
# backend
yarn --cwd packages/backend add @your-scope/backstage-plugin-aws-devops-agent-backend
```

Add the frontend plugin to your app's features (new frontend system):

```ts
// packages/app/src/App.tsx
import { createApp } from '@backstage/frontend-defaults';
import devopsAgentPlugin from '@your-scope/backstage-plugin-aws-devops-agent';

export default createApp({
  features: [
    // ...other features
    devopsAgentPlugin,
  ],
});
```

Add the backend plugin:

```ts
// packages/backend/src/index.ts
backend.add(import('@your-scope/backstage-plugin-aws-devops-agent-backend'));
```

Then configure the backend (see the
[backend README](../devops-agent-backend/README.md)) and annotate your
components.

## Try it without AWS (mock mode)

Set `devOpsAgent.mock: true` in `app-config.yaml` to serve deterministic mock
data — no Agent Space or AWS credentials required. Useful for local development
and demos.

```yaml
devOpsAgent:
  mock: true
```

## Configuration reference

All configuration lives on the backend plugin — see its
[README](../devops-agent-backend/README.md) and `config.d.ts` for the full
schema (`mock`, `region`, `assumeRoleArn`, `userType`, per-space `webhook`).

## License

Apache-2.0
