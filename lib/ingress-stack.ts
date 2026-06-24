import * as cdk from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as fs from "fs";
import * as path from "path";
import { config } from "./config";

export interface IngressStackProps extends cdk.StackProps {
  /** The EKS cluster to install the controller onto. */
  readonly cluster: eks.Cluster;
}

/**
 * IngressStack — the AWS Load Balancer Controller (LBC), end to end.
 *
 * Installs the controller as a SINGLE ArgoCD Application (its official Helm
 * chart), applied directly from CDK — no GitOps directory wrapper, so it shows
 * up as exactly one app. IAM is provided via EKS Pod Identity.
 *
 * The LBC watches Kubernetes Ingress objects and provisions AWS Application
 * Load Balancers for them. It needs broad ELB/EC2/WAF permissions, granted via
 * the controller's official IAM policy. Credentials are delivered through EKS
 * Pod Identity (consistent with the rest of the platform), associated with the
 * controller's service account (kube-system/aws-load-balancer-controller).
 */
export class IngressStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IngressStackProps) {
    super(scope, id, props);

    // Official AWS Load Balancer Controller IAM policy (vendored from the
    // upstream project so the permission set tracks a known controller release).
    const policyDoc = iam.PolicyDocument.fromJson(
      JSON.parse(
        fs.readFileSync(
          path.join(
            __dirname,
            "policies",
            "aws-load-balancer-controller-iam-policy.json",
          ),
          "utf-8",
        ),
      ),
    );

    const lbcRole = new iam.Role(this, "LbcRole", {
      roleName: `${config.prefix}-aws-lbc-role`,
      assumedBy: new iam.ServicePrincipal("pods.eks.amazonaws.com"),
      description: "Role for the AWS Load Balancer Controller via Pod Identity",
      inlinePolicies: {
        AWSLoadBalancerControllerIAMPolicy: policyDoc,
      },
    });
    // Pod Identity trust requires both sts:AssumeRole and sts:TagSession.
    (lbcRole.assumeRolePolicy as iam.PolicyDocument).addStatements(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("pods.eks.amazonaws.com")],
        actions: ["sts:TagSession"],
      }),
    );

    // Bind the role to the controller's service account.
    new eks.CfnPodIdentityAssociation(this, "LbcPodIdentity", {
      clusterName: props.cluster.clusterName,
      namespace: "kube-system",
      serviceAccount: "aws-load-balancer-controller",
      roleArn: lbcRole.roleArn,
    });

    // Install the controller as a single ArgoCD Application (its Helm chart),
    // applied directly here. One app, no GitOps directory wrapper. ArgoCD syncs
    // the chart; the service account it creates is bound to the IAM role above
    // via the Pod Identity association.
    new eks.KubernetesManifest(this, "LbcArgoApp", {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: "argoproj.io/v1alpha1",
          kind: "Application",
          metadata: {
            name: "aws-load-balancer-controller",
            namespace: "argocd",
          },
          spec: {
            project: "default",
            source: {
              repoURL: "https://aws.github.io/eks-charts",
              chart: "aws-load-balancer-controller",
              targetRevision: "1.13.4",
              helm: {
                releaseName: "aws-load-balancer-controller",
                valuesObject: {
                  clusterName: config.clusterName,
                  region: this.region,
                  vpcId: props.cluster.vpc.vpcId,
                  serviceAccount: {
                    create: true,
                    name: "aws-load-balancer-controller",
                  },
                },
              },
            },
            destination: { name: "in-cluster", namespace: "kube-system" },
            syncPolicy: {
              automated: { prune: true, selfHeal: true },
              syncOptions: ["CreateNamespace=true"],
            },
          },
        },
      ],
    });

    new cdk.CfnOutput(this, "LbcRoleArn", { value: lbcRole.roleArn });
  }
}
