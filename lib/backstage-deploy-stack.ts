import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
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

    // --- AWS DevOps Agent access for the Backstage backend ---
    // The DevOps Agent backend plugin (running as the `backstage` service
    // account) calls the AWS DevOps Agent API (aidevops:*) to fetch
    // recommendations/investigations and drive chat. Grant it read + chat
    // access via EKS Pod Identity, so no AWS credentials live in the cluster.
    const devOpsAgentRole = new iam.Role(this, "DevOpsAgentReaderRole", {
      roleName: `${config.prefix}-backstage-devops-agent-role`,
      assumedBy: new iam.ServicePrincipal("pods.eks.amazonaws.com"),
      description:
        "Lets the Backstage backend read AWS DevOps Agent spaces and chat",
    });
    // Pod Identity trust requires both sts:AssumeRole and sts:TagSession.
    (devOpsAgentRole.assumeRolePolicy as iam.PolicyDocument).addStatements(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("pods.eks.amazonaws.com")],
        actions: ["sts:TagSession"],
      }),
    );
    devOpsAgentRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "aidevops:ListAgentSpaces",
          "aidevops:GetAgentSpace",
          "aidevops:ListServices",
          "aidevops:GetService",
          "aidevops:ListRecommendations",
          "aidevops:GetRecommendation",
          "aidevops:ListBacklogTasks",
          "aidevops:ListExecutions",
          "aidevops:ListChats",
          "aidevops:CreateChat",
          "aidevops:SendMessage",
          "aidevops:ListPendingMessages",
        ],
        // DevOps Agent is a new service; scope to agentspace resources in this
        // account/region (some list actions also accept "*").
        resources: ["*"],
      }),
    );

    new eks.CfnPodIdentityAssociation(this, "BackstageDevOpsAgentPodIdentity", {
      clusterName: props.cluster.clusterName,
      namespace: "backstage",
      serviceAccount: "backstage",
      roleArn: devOpsAgentRole.roleArn,
    });

    new cdk.CfnOutput(this, "BackstageImageUri", { value: imageUri });
    new cdk.CfnOutput(this, "DevOpsAgentRoleArn", {
      value: devOpsAgentRole.roleArn,
    });
  }
}
