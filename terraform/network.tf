########################################################################
# network.tf — the VPC the EKS cluster runs inside.
#
# Creates:
#   - A VPC across `max_azs` Availability Zones
#   - Public subnets   for internet-facing load balancers and NAT gateways
#   - Private subnets  for EKS worker nodes and pods
#   - NAT gateway(s)   for outbound internet access from private subnets
#   - Subnet tags that let the AWS Load Balancer Controller place load
#     balancers in the correct subnets
########################################################################

# Availability Zones in the region; we take the first `max_azs` of them.
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.max_azs)

  # Two subnet tiers, each a clean /24 per AZ carved out of 10.0.0.0/16.
  # Public tier starts at 10.0.0.0/24; private tier at 10.0.128.0/24.
  public_subnet_cidrs  = [for i in range(var.max_azs) : cidrsubnet("10.0.0.0/16", 8, i)]
  private_subnet_cidrs = [for i in range(var.max_azs) : cidrsubnet("10.0.0.0/16", 8, i + 128)]
}

# The VPC. 10.0.0.0/16 = 65,536 addresses. With the VPC CNI every pod gets a
# real VPC IP, so a /16 leaves ample room for pods.
resource "aws_vpc" "this" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.prefix}-vpc"
  }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${var.prefix}-igw"
  }
}

# Public subnets — host internet-facing load balancers and NAT gateways.
# The role/elb tag lets the AWS Load Balancer Controller select them for
# internet-facing load balancers.
resource "aws_subnet" "public" {
  count                   = var.max_azs
  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_subnet_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name                     = "${var.prefix}-public-${local.azs[count.index]}"
    "kubernetes.io/role/elb" = "1"
  }
}

# Private subnets — host EKS worker nodes and pods. The role/internal-elb tag
# marks them for internal load balancers.
resource "aws_subnet" "private" {
  count             = var.max_azs
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_subnet_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = {
    Name                              = "${var.prefix}-private-${local.azs[count.index]}"
    "kubernetes.io/role/internal-elb" = "1"
  }
}

# One Elastic IP per NAT gateway.
resource "aws_eip" "nat" {
  count  = var.nat_gateways
  domain = "vpc"

  tags = {
    Name = "${var.prefix}-nat-eip-${count.index}"
  }
}

# NAT gateway(s) live in the public subnets. `nat_gateways` = 1 is cheaper
# (single-AZ egress); raise to `max_azs` for HA.
resource "aws_nat_gateway" "this" {
  count         = var.nat_gateways
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = {
    Name = "${var.prefix}-nat-${count.index}"
  }

  depends_on = [aws_internet_gateway.this]
}

# Single public route table: default route to the internet gateway, shared by
# all public subnets.
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = {
    Name = "${var.prefix}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  count          = var.max_azs
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# One private route table per AZ, each defaulting to a NAT gateway. When
# nat_gateways < max_azs, private subnets share the available NAT gateway(s)
# (index wraps via modulo).
resource "aws_route_table" "private" {
  count  = var.max_azs
  vpc_id = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[count.index % var.nat_gateways].id
  }

  tags = {
    Name = "${var.prefix}-private-rt-${local.azs[count.index]}"
  }
}

resource "aws_route_table_association" "private" {
  count          = var.max_azs
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}
