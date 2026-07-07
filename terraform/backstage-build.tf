########################################################################
# backstage-build.tf — builds the Backstage container image and pushes it
# to ECR.
#
# The build context is the backstage/ folder in this repo — our own
# Backstage monorepo with a multi-stage Dockerfile that builds the app from
# source. A build can take ~10-15 minutes, so a null_resource starts the
# build during apply and does not wait for it; the image lands in ECR
# asynchronously, where the ArgoCD Backstage Application pulls it.
#
# Creates:
#   - An ECR repository for the Backstage image
#   - A CodeBuild project that clones this repo and builds backstage/
#   - A null_resource that triggers the build on apply
#
# Reuses the CodeBuild service role from iam.tf (aws_iam_role.codebuild).
########################################################################

# ECR repository for the Backstage image.
resource "aws_ecr_repository" "backstage" {
  name = var.backstage_ecr_repo_name

  image_scanning_configuration {
    scan_on_push = true
  }

  force_delete = true
}

# Keep only the 10 most recent images.
resource "aws_ecr_lifecycle_policy" "backstage" {
  repository = aws_ecr_repository.backstage.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep only the 10 most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      },
    ]
  })
}

# Buildspec: log in to ECR, clone this repo, build the backstage/ folder
# (nodes are amd64, so no multi-arch), push to ECR.
locals {
  backstage_buildspec = yamlencode({
    version = "0.2"
    phases = {
      pre_build = {
        commands = [
          "echo \"Logging in to Amazon ECR...\"",
          "aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com",
          "export REPO_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$ECR_REPO_NAME",
          "echo \"Cloning $SOURCE_REPO_URL ($SOURCE_REVISION)\"",
          "git clone --depth 1 --branch $SOURCE_REVISION $SOURCE_REPO_URL src",
        ]
      }
      build = {
        commands = [
          "echo \"Building Backstage image $REPO_URI:$IMAGE_TAG ...\"",
          "docker build -t $REPO_URI:$IMAGE_TAG src/backstage",
        ]
      }
      post_build = {
        commands = [
          "docker push $REPO_URI:$IMAGE_TAG",
          "echo \"Image successfully pushed: $REPO_URI:$IMAGE_TAG\"",
        ]
      }
    }
  })
}

resource "aws_codebuild_project" "backstage" {
  name         = "${var.prefix}-backstage-builder"
  description  = "Builds the Backstage container image and pushes it to ECR"
  service_role = aws_iam_role.codebuild.arn

  build_timeout = 45 # minutes

  artifacts {
    type = "NO_ARTIFACTS"
  }

  source {
    type      = "NO_SOURCE"
    buildspec = local.backstage_buildspec
  }

  environment {
    image = "aws/codebuild/standard:7.0"
    # Larger compute — the Backstage yarn build is heavy.
    compute_type    = "BUILD_GENERAL1_LARGE"
    type            = "LINUX_CONTAINER"
    privileged_mode = true # required for docker build

    environment_variable {
      name  = "AWS_ACCOUNT_ID"
      value = local.account_id
    }
    environment_variable {
      name  = "ECR_REPO_NAME"
      value = var.backstage_ecr_repo_name
    }
    environment_variable {
      name  = "IMAGE_TAG"
      value = "latest"
    }
    environment_variable {
      name  = "SOURCE_REPO_URL"
      value = var.gitops_repo_url
    }
    environment_variable {
      name  = "SOURCE_REVISION"
      value = var.gitops_revision
    }
  }
}

# Start the Backstage build on apply. Re-runs whenever the build token
# changes (var.backstage_build_token), so a fresh image is built against the
# latest source. Fire-and-forget: it does not wait for the build to finish,
# and a build failure never blocks the apply.
resource "null_resource" "trigger_backstage_build" {
  triggers = {
    project_name = aws_codebuild_project.backstage.name
    build_token  = var.backstage_build_token
  }

  provisioner "local-exec" {
    command = "aws codebuild start-build --project-name ${aws_codebuild_project.backstage.name} --region ${var.region} || true"
  }
}
