import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import { KubectlV35Layer } from "@aws-cdk/lambda-layer-kubectl-v35";
import { Construct } from "constructs";
import { config } from "./config";

export interface EksStackProps extends cdk.StackProps {
  /** The VPC the cluster runs in (from NetworkStack). */
  readonly vpc: ec2.IVpc;
  /**
   * IAM principal ARN (user or role) granted cluster-admin via an EKS access
   * entry, so it can run kubectl against the cluster. Typically the identity
   * running the deployment.
   */
  readonly adminPrincipalArn: string;
}

/**
 * EksStack — the EKS cluster and its worker nodes.
 *
 * Creates:
 *   - The control-plane and worker-node IAM roles (kept here because EKS
 *     couples them to the cluster via aws-auth/access entries)
 *   - An EKS cluster (Kubernetes version from config) in the provided VPC
 *   - A managed node group of EC2 workers in the private subnets
 *
 * The cluster automatically includes the core networking add-ons required for
 * a functioning cluster:
 *   - VPC CNI    - assigns VPC IP addresses to pods
 *   - CoreDNS    - in-cluster DNS for service discovery
 *   - kube-proxy - routes traffic to pods via the cluster network
 *
 * A kubectl Lambda layer (matching the Kubernetes version) lets CDK apply
 * Kubernetes manifests and Helm charts to the cluster.
 *
 * `cluster` is exposed so later stacks can attach capabilities or charts.
 */
export class EksStack extends cdk.Stack {
  public readonly cluster: eks.Cluster;

  constructor(scope: Construct, id: string, props: EksStackProps) {
    super(scope, id, props);

    // Control-plane role. The EKS control plane assumes this to manage AWS
    // resources on the cluster's behalf, such as the network interfaces it
    // uses to communicate with worker nodes.
    const clusterRole = new iam.Role(this, "ClusterRole", {
      roleName: `${config.prefix}-eks-cluster-role`,
      assumedBy: new iam.ServicePrincipal("eks.amazonaws.com"),
      description: "Role assumed by the EKS control plane",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKSClusterPolicy"),
      ],
    });

    // Worker node role, assumed by the EC2 instances in the managed node
    // group. The attached policies provide what every node needs:
    //   AmazonEKSWorkerNodePolicy          - register and join the cluster
    //   AmazonEC2ContainerRegistryReadOnly - pull images from ECR
    //   AmazonEKS_CNI_Policy               - let the VPC CNI assign pod IPs
    //   AmazonSSMManagedInstanceCore       - open a shell via SSM Session
    //                                        Manager (no SSH key or public IP)
    const nodeRole = new iam.Role(this, "NodeRole", {
      roleName: `${config.prefix}-eks-node-role`,
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: "Role assumed by EKS managed worker nodes",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKSWorkerNodePolicy"),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonEC2ContainerRegistryReadOnly",
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKS_CNI_Policy"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
      ],
    });

    this.cluster = new eks.Cluster(this, "Cluster", {
      clusterName: config.clusterName,
      version: eks.KubernetesVersion.V1_35,

      // Run the cluster in the VPC's private subnets; worker nodes have no
      // public IPs and reach the internet through the NAT gateway.
      vpc: props.vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],

      role: clusterRole,

      // Use EKS access entries (the modern access model) alongside the legacy
      // aws-auth ConfigMap. Access entries let us grant kubectl access to an
      // IAM principal declaratively (see grantAccess below).
      authenticationMode: eks.AuthenticationMode.API_AND_CONFIG_MAP,

      // The API server endpoint is reachable publicly and privately. Public
      // access lets you run kubectl from your machine; nodes use the private
      // path inside the VPC.
      endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE,

      // kubectl layer matching Kubernetes 1.35, used by CDK's internal Lambda
      // to apply manifests/Helm charts to the cluster.
      kubectlLayer: new KubectlV35Layer(this, "KubectlLayer"),

      // Define the node group explicitly below rather than a default one.
      defaultCapacity: 0,
    });

    // Managed node group: EC2 worker nodes that run pods.
    this.cluster.addNodegroupCapacity("DefaultNodeGroup", {
      nodegroupName: `${config.prefix}-nodes`,
      instanceTypes: [new ec2.InstanceType(config.nodeGroup.instanceType)],
      nodeRole,
      desiredSize: config.nodeGroup.desiredSize,
      minSize: config.nodeGroup.minSize,
      maxSize: config.nodeGroup.maxSize,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      // Amazon Linux 2023 is required: the older AL2 AMI is not supported on
      // Kubernetes 1.33+.
      amiType: eks.NodegroupAmiType.AL2023_X86_64_STANDARD,
    });

    // Grant cluster-admin to the configured IAM principal via an access entry,
    // so it can run kubectl. Without this, only CDK's internal creation role
    // has access and the deploying user cannot reach the cluster.
    this.cluster.grantAccess(
      "AdminAccess",
      props.adminPrincipalArn,
      [
        eks.AccessPolicy.fromAccessPolicyName("AmazonEKSClusterAdminPolicy", {
          accessScopeType: eks.AccessScopeType.CLUSTER,
        }),
      ],
    );

    // Stack outputs.
    new cdk.CfnOutput(this, "ClusterName", {
      value: this.cluster.clusterName,
      description: "EKS cluster name",
    });
    new cdk.CfnOutput(this, "ConfigureKubectl", {
      value: `aws eks update-kubeconfig --name ${this.cluster.clusterName} --region ${this.region}`,
      description: "Command to configure kubectl for this cluster",
    });
  }
}
