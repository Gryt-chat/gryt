# Gryt Helm Chart

A Helm chart for deploying the Gryt Voice Chat Platform on Kubernetes.

## Prerequisites

- Kubernetes 1.24+
- Helm 3.8+
- NGINX Ingress Controller
- cert-manager (optional, for automatic SSL certificates)

## Installation

### Quick Start

1. **Add the Helm repository** (if published):
   ```bash
   helm repo add gryt https://charts.gryt.chat
   helm repo update
   ```

2. **Install with default values**:
   ```bash
   helm install my-gryt gryt/gryt
   ```

3. **Install from local chart**:
   ```bash
   helm install my-gryt ./helm/gryt
   ```

### Custom Installation

1. **Create a custom values file**:
   ```bash
   cp helm/gryt/values.yaml my-values.yaml
   ```

2. **Edit your configuration**:
   ```yaml
   # my-values.yaml
   gryt:
     domain: "gryt.yourdomain.com"
     
   server:
     secrets:
       serverPassword: "your-secure-password"
       corsOrigin: "https://app.gryt.chat,https://gryt.yourdomain.com"
   ```

3. **Install with custom values**:
   ```bash
   helm install my-gryt ./helm/gryt -f my-values.yaml
   ```

## Configuration

### Essential Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `gryt.domain` | Your domain name | `gryt.yourdomain.com` |
| `gryt.tls.enabled` | Enable TLS/SSL | `true` |
| `gryt.tls.certManager.enabled` | Use cert-manager for certificates | `true` |
| `gryt.auth.apiUrl` | Gryt authentication API URL | `https://auth.gryt.chat` |
| `server.secrets.serverPassword` | Server password for client authentication | `your-secure-password` |

**Note**: This Helm chart does **not** deploy/manage Keycloak. `gryt.auth.apiUrl` should point at an existing auth service (backed by Keycloak). Settings like **user self-registration** are toggled in the **Keycloak realm** (Admin Console → Realm settings → Login → User registration).

### Routing Configuration

#### Subdomain Routing (Recommended)
```yaml
ingress:
  routing:
    useSubdomains: true
    subdomains:
      client: "gryt"      # gryt.yourdomain.com
      api: "api"          # api.yourdomain.com
```

#### Path-based Routing
```yaml
ingress:
  routing:
    useSubdomains: false
    paths:
      client: "/"
      api: "/api"
      sfu: "/sfu"
```

### Resource Configuration

```yaml
# SFU Resources
sfu:
  resources:
    requests:
      memory: "256Mi"
      cpu: "250m"
    limits:
      memory: "512Mi"
      cpu: "500m"

# Server Resources with Autoscaling
server:
  replicaCount: 2
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
```

### Security Configuration

```yaml
security:
  podSecurityContext:
    runAsNonRoot: true
    runAsUser: 1001
    runAsGroup: 1001
    fsGroup: 1001
  
  securityContext:
    allowPrivilegeEscalation: false
    readOnlyRootFilesystem: true
    capabilities:
      drop:
        - ALL
```

## Examples

### Production Deployment

```yaml
# production-values.yaml
gryt:
  domain: "gryt.mycompany.com"
  tls:
    enabled: true
    certManager:
      enabled: true
      issuer: "letsencrypt-prod"

server:
  replicaCount: 3
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 20
  secrets:
    serverPassword: "super-secure-production-password"
    corsOrigin: "https://app.gryt.chat,https://gryt.mycompany.com"
  resources:
    requests:
      memory: "256Mi"
      cpu: "200m"
    limits:
      memory: "512Mi"
      cpu: "500m"

client:
  replicaCount: 3
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 10

sfu:
  resources:
    requests:
      memory: "512Mi"
      cpu: "500m"
    limits:
      memory: "1Gi"
      cpu: "1000m"

monitoring:
  serviceMonitor:
    enabled: true
```

### Development Deployment

```yaml
# dev-values.yaml
gryt:
  domain: "gryt-dev.mycompany.com"
  tls:
    enabled: false

server:
  replicaCount: 1
  autoscaling:
    enabled: false
  secrets:
    serverPassword: "dev-password"
    corsOrigin: "https://app.gryt.chat,http://gryt-dev.mycompany.com"

client:
  replicaCount: 1
  autoscaling:
    enabled: false

sfu:
  replicaCount: 1
```

## Upgrading

```bash
# Upgrade to latest version
helm upgrade my-gryt ./helm/gryt -f my-values.yaml

# Upgrade with new values
helm upgrade my-gryt ./helm/gryt -f my-values.yaml --set server.replicaCount=5
```

## Uninstalling

```bash
helm uninstall my-gryt
```

## Troubleshooting

### Check Pod Status
```bash
kubectl get pods -l app.kubernetes.io/name=gryt
```

### View Logs
```bash
# Server logs
kubectl logs -l app.kubernetes.io/component=server -f

# SFU logs
kubectl logs -l app.kubernetes.io/component=sfu -f

# Client logs
kubectl logs -l app.kubernetes.io/component=client -f
```

### Check Ingress
```bash
kubectl get ingress
kubectl describe ingress my-gryt-ingress
```

### Common Issues

#### WebSocket Connection Issues
- Verify ingress annotations for WebSocket support
- Check CORS configuration
- Ensure proper domain DNS resolution

#### Certificate Issues
- Verify cert-manager is installed and configured
- Check certificate status: `kubectl get certificates`
- Review cert-manager logs

#### Resource Issues
- Check HPA status: `kubectl get hpa`
- Monitor resource usage: `kubectl top pods`

## Values Reference

See [values.yaml](values.yaml) for the complete list of configurable parameters.

## Contributing

1. Fork the repository
2. Create your feature branch
3. Make your changes
4. Test with `helm lint` and `helm template`
5. Submit a pull request

## Support

For issues and questions:
- Check the [troubleshooting section](#troubleshooting)
- Review the [main documentation](../../README.md)
- Open an issue on GitHub 