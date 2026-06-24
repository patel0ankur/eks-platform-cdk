import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { config } from "./config";

/**
 * NetworkStack — the VPC the EKS cluster runs inside.
 *
 * Creates:
 *   - A VPC across `maxAzs` Availability Zones
 *   - Public subnets   for internet-facing load balancers and NAT gateways
 *   - Private subnets  for EKS worker nodes and pods
 *   - NAT gateway(s)   for outbound internet access from private subnets
 *   - Subnet tags that let the AWS Load Balancer Controller place load
 *     balancers in the correct subnets
 *
 * `vpc` is exposed so the EKS stack can place the cluster into it.
 */
export class NetworkStack extends cdk.Stack {
  /** The VPC the EKS cluster is deployed into. */
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The VPC. Subnets, route tables, internet gateway, and NAT gateways are
    // derived automatically from `subnetConfiguration` below.
    this.vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: `${config.prefix}-vpc`,

      // 10.0.0.0/16 = 65,536 addresses. With the VPC CNI every pod gets a
      // real VPC IP, so a /16 leaves ample room for pods.
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),

      // Number of Availability Zones to span.
      maxAzs: config.maxAzs,

      // Number of NAT gateways. 1 is cheaper; raise for higher availability.
      natGateways: config.natGateways,

      // Two subnet tiers, each given an equal slice of the VPC CIDR.
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24, // 256 IPs — load balancers and NAT gateways
        },
        {
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24, // 256 IPs — worker nodes and pods
        },
      ],
    });

    // Subnet tags used by the AWS Load Balancer Controller to choose where to
    // place load balancers:
    //   role/elb          => public subnets host internet-facing load balancers
    //   role/internal-elb => private subnets host internal load balancers
    for (const subnet of this.vpc.publicSubnets) {
      cdk.Tags.of(subnet).add("kubernetes.io/role/elb", "1");
    }
    for (const subnet of this.vpc.privateSubnets) {
      cdk.Tags.of(subnet).add("kubernetes.io/role/internal-elb", "1");
    }

    // Stack outputs: the VPC and subnet IDs, viewable after deploy.
    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpcId,
      description: "The VPC the EKS cluster will run in",
    });
    new cdk.CfnOutput(this, "PrivateSubnetIds", {
      value: this.vpc.privateSubnets.map((s) => s.subnetId).join(","),
      description: "Private subnets where worker nodes will run",
    });
    new cdk.CfnOutput(this, "PublicSubnetIds", {
      value: this.vpc.publicSubnets.map((s) => s.subnetId).join(","),
      description: "Public subnets for internet-facing load balancers",
    });
  }
}
