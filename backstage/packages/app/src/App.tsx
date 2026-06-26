import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
// Platform plugins (new frontend system). Adding each plugin's /alpha export to
// the features array registers its extensions, including the entity-page tabs:
//   - kubernetes: "Kubernetes" tab (live workloads on the EKS cluster)
//   - argo-cd:    ArgoCD sync/health (this platform's CD mechanism)
// (CI is intentionally not surfaced as GitHub Actions: this platform builds with
//  CodeBuild and deploys with ArgoCD, so an Actions tab would be empty/misleading.)
import kubernetesPlugin from '@backstage/plugin-kubernetes/alpha';
import argoCdPlugin from '@roadiehq/backstage-plugin-argo-cd/alpha';
// Our custom plugin: adds a per-component "DevOps Agent" tab (recommendations,
// investigations, chat, start-investigation) scoped to the component's AWS
// DevOps Agent Space.
import devopsAgentPlugin from '@your-scope/backstage-plugin-aws-devops-agent';
import { navModule } from './modules/nav';

export default createApp({
  features: [
    catalogPlugin,
    kubernetesPlugin,
    argoCdPlugin,
    devopsAgentPlugin,
    navModule,
  ],
});
