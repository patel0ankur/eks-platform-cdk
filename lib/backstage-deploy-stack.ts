import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as eks from "aws-cdk-lib/aws-eks";
import { Construct } from "constructs";
import { config } from "./config";

export interface BackstageDeployStackProps extends cdk.StackProps {
  /** The EKS cluster to deploy Backstage onto. */
  readonly cluster: eks.Cluster;
}

/**
 * BackstageDeployStack — deploys the Backstage portal as a single ArgoCD
 * Application, applied directly from CDK (same pattern as the ingress
 * controller: exactly one app, no GitOps directory wrapper).
 *
 * The Kubernetes manifests live in git under gitops/platform-apps/backstage and
 * are rendered with Kustomize. The only account-specific value — the ECR image
 * URI — is injected here as a Kustomize image override, so the registry never
 * appears in git. ArgoCD then syncs the rendered resources into the cluster.
 *
 * Backstage is deliberately kept OUT of the gitops/platform/* directory
 * generator: that generator applies each folder as raw manifests, which would
 * leave the placeholder image name unresolved. Applying it as its own
 * Application lets CDK supply the image override at sync time.
 */
export class BackstageDeployStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BackstageDeployStackProps) {
    super(scope, id, props);

    // The ECR repository CodeBuild pushes the Backstage image into. Imported by
    // name so we can build the fully-qualified image URI for the override.
    const repo = ecr.Repository.fromRepositoryName(
      this,
      "BackstageRepo",
      config.backstageEcrRepoName,
    );
    const imageUri = `${repo.repositoryUri}:latest`;

    new eks.KubernetesManifest(this, "BackstageArgoApp", {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: "argoproj.io/v1alpha1",
          kind: "Application",
          metadata: {
            name: "backstage",
            namespace: "argocd",
          },
          spec: {
            project: "default",
            source: {
              repoURL: config.gitops.repoUrl,
              targetRevision: config.gitops.revision,
              path: "gitops/platform-apps/backstage",
              // Render with Kustomize and rewrite the placeholder image name to
              // the real ECR URI. `newName`+`newTag` replace "backstage-image".
              kustomize: {
                images: [`backstage-image=${imageUri}`],
              },
            },
            destination: { name: "in-cluster", namespace: "backstage" },
            syncPolicy: {
              automated: { prune: true, selfHeal: true },
              syncOptions: ["CreateNamespace=true"],
            },
          },
        },
      ],
    });

    new cdk.CfnOutput(this, "BackstageImageUri", { value: imageUri });
  }
}
