import * as cdk from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as fs from "fs";
import * as path from "path";
import { config } from "./config";

export interface IngressStackProps extends cdk.StackProps {
  /** Cluster name, used to scope the Pod Identity association. */
  readonly clusterName: string;
}

/**
 * IngressStack — IAM wiring for the AWS Load Balancer Controller (LBC).
 *
 * The LBC watches Kubernetes Ingress objects and provisions AWS Application
 * Load Balancers for them. It needs broad ELB/EC2/WAF permissions, granted via
 * the controller's official IAM policy. Credentials are delivered through EKS
 * Pod Identity (consistent with the rest of the platform), associated with the
 * controller's service account (kube-system/aws-load-balancer-controller).
 *
 * The controller itself is installed via GitOps (Helm) in
 * gitops/platform/aws-load-balancer-controller/.
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
      clusterName: props.clusterName,
      namespace: "kube-system",
      serviceAccount: "aws-load-balancer-controller",
      roleArn: lbcRole.roleArn,
    });

    new cdk.CfnOutput(this, "LbcRoleArn", { value: lbcRole.roleArn });
  }
}
