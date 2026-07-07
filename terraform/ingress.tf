########################################################################
# ingress.tf — the platform's ALB ingress capability, via EKS Auto Mode.
#
# EKS Auto Mode includes a built-in load-balancing controller
# (controller name eks.amazonaws.com/alb), so there is NO separate AWS Load
# Balancer Controller to install — Auto Mode provisions and manages ALBs
# from Ingress objects directly.
#
# To use it, the cluster needs:
#   - an IngressClassParams CRD (eks.amazonaws.com/v1) holding AWS-specific
#     load balancer settings (scheme, etc.)
#   - an IngressClass wired to the eks.amazonaws.com/alb controller that
#     references those params
#
# Marked as the default IngressClass so any Ingress without an explicit
# ingressClassName uses it. Applied via the kubectl provider (server-side),
# which authenticates to the cluster using the endpoint/CA from module.eks.
########################################################################

# AWS-specific ALB configuration. internet-facing = public ALB with a
# routable DNS name (what we output as the Backstage URL).
resource "kubectl_manifest" "alb_ingressclassparams" {
  yaml_body = yamlencode({
    apiVersion = "eks.amazonaws.com/v1"
    kind       = "IngressClassParams"
    metadata = {
      name = "alb"
    }
    spec = {
      scheme = "internet-facing"
    }
  })

  depends_on = [module.eks]
}

# The IngressClass that binds the Auto Mode controller to the params above.
resource "kubectl_manifest" "alb_ingressclass" {
  yaml_body = yamlencode({
    apiVersion = "networking.k8s.io/v1"
    kind       = "IngressClass"
    metadata = {
      name = "alb"
      annotations = {
        # Make this the cluster default so an Ingress can omit ingressClassName.
        "ingressclass.kubernetes.io/is-default-class" = "true"
      }
    }
    spec = {
      controller = "eks.amazonaws.com/alb"
      parameters = {
        apiGroup = "eks.amazonaws.com"
        kind     = "IngressClassParams"
        name     = "alb"
      }
    }
  })

  depends_on = [kubectl_manifest.alb_ingressclassparams]
}
