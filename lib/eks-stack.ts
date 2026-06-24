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

    // Launch template that raises the IMDS hop limit to 2. The EKS default is
    // 1, which prevents PODS from reaching the instance metadata service (the
    // extra network hop into the pod netns exceeds the limit). Several
    // controllers (AWS Load Balancer Controller, EBS CSI) fetch region/VPC or
    // credentials from IMDS, so a limit of 1 breaks them. The template sets
    // only metadata options — no AMI/instance type — so EKS still injects the
    // AL2023 image and the node group keeps its own instance type.
    const nodeLaunchTemplate = new ec2.LaunchTemplate(this, "NodeLaunchTemplate", {
      launchTemplateName: `${config.prefix}-node-lt`,
      httpTokens: ec2.LaunchTemplateHttpTokens.REQUIRED, // IMDSv2
      httpPutResponseHopLimit: 2,
    });

    // Managed node group: EC2 worker nodes that run pods.
    // NOTE: a launch template can only be attached at node group CREATION, so
    // this group carries the IMDS launch template from the start. (The
    // construct id "DefaultNodeGroupLt" differs from any earlier group so a
    // cluster created without the template gets a clean replacement.)
    this.cluster.addNodegroupCapacity("DefaultNodeGroupLt", {
      nodegroupName: `${config.prefix}-nodes-lt`,
      instanceTypes: [new ec2.InstanceType(config.nodeGroup.instanceType)],
      nodeRole,
      desiredSize: config.nodeGroup.desiredSize,
      minSize: config.nodeGroup.minSize,
      maxSize: config.nodeGroup.maxSize,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      // Amazon Linux 2023 is required: the older AL2 AMI is not supported on
      // Kubernetes 1.33+.
      amiType: eks.NodegroupAmiType.AL2023_X86_64_STANDARD,
      launchTemplateSpec: {
        id: nodeLaunchTemplate.launchTemplateId!,
        version: nodeLaunchTemplate.latestVersionNumber,
      },
    });

    // Core EKS-managed add-ons. The base cluster ships CNI/CoreDNS/kube-proxy
    // as self-managed pods; declaring them as managed add-ons lets EKS own
    // their versioning and patching. The Pod Identity agent is added so add-ons
    // can get IAM credentials via Pod Identity. Versions are omitted so EKS
    // uses the default for the cluster's Kubernetes version. OVERWRITE adopts
    // the existing self-managed installs of CNI/CoreDNS/kube-proxy.
    const coreAddons: { id: string; name: string }[] = [
      { id: "VpcCniAddon", name: "vpc-cni" },
      { id: "CoreDnsAddon", name: "coredns" },
      { id: "KubeProxyAddon", name: "kube-proxy" },
      // Pod Identity agent must exist before add-ons that use Pod Identity for
      // credentials (the EBS CSI driver below).
      { id: "PodIdentityAddon", name: "eks-pod-identity-agent" },
    ];
    let podIdentityAddon: eks.CfnAddon | undefined;
    for (const addon of coreAddons) {
      const a = new eks.CfnAddon(this, addon.id, {
        clusterName: this.cluster.clusterName,
        addonName: addon.name,
        resolveConflicts: "OVERWRITE",
      });
      if (addon.name === "eks-pod-identity-agent") podIdentityAddon = a;
    }

    // EBS CSI driver — required for dynamically provisioned PersistentVolumes
    // (e.g. the Keycloak Postgres data volume); without it PVCs stay Pending.
    //
    // The driver's controller runs in the AWS control plane path and cannot
    // reach the node IMDS for credentials, so it is given its own IAM role via
    // EKS Pod Identity (not the node role). The role is assumed by the
    // ebs-csi-controller-sa service account.
    const ebsCsiRole = new iam.Role(this, "EbsCsiDriverRole", {
      roleName: `${config.prefix}-ebs-csi-driver-role`,
      assumedBy: new iam.ServicePrincipal("pods.eks.amazonaws.com"),
      description: "Role for the EBS CSI driver via EKS Pod Identity",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonEBSCSIDriverPolicy",
        ),
      ],
    });
    // Pod Identity trust requires both sts:AssumeRole and sts:TagSession.
    (ebsCsiRole.assumeRolePolicy as iam.PolicyDocument).addStatements(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("pods.eks.amazonaws.com")],
        actions: ["sts:TagSession"],
      }),
    );

    const ebsCsiAddon = new eks.CfnAddon(this, "EbsCsiAddon", {
      clusterName: this.cluster.clusterName,
      addonName: "aws-ebs-csi-driver",
      resolveConflicts: "OVERWRITE",
      podIdentityAssociations: [
        {
          serviceAccount: "ebs-csi-controller-sa",
          roleArn: ebsCsiRole.roleArn,
        },
      ],
    });
    // Ensure the Pod Identity agent exists before the EBS CSI driver uses it.
    if (podIdentityAddon) {
      ebsCsiAddon.node.addDependency(podIdentityAddon);
    }

    // Default gp3 storage class so PVCs without an explicit storageClassName
    // bind via the EBS CSI driver. The cluster's built-in gp2 class uses the
    // older in-tree provisioner and is not marked default; gp3 is cheaper and
    // faster, so we make it the default.
    this.cluster.addManifest("Gp3DefaultStorageClass", {
      apiVersion: "storage.k8s.io/v1",
      kind: "StorageClass",
      metadata: {
        name: "gp3",
        annotations: { "storageclass.kubernetes.io/is-default-class": "true" },
      },
      provisioner: "ebs.csi.aws.com",
      volumeBindingMode: "WaitForFirstConsumer",
      allowVolumeExpansion: true,
      parameters: { type: "gp3", encrypted: "true" },
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
