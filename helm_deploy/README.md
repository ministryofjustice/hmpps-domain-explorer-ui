# Deployment Notes

## Prerequisites

- Ensure you have helm v3 client installed.

```sh
$ helm version
version.BuildInfo{Version:"v3.0.1", GitCommit:"7c22ef9ce89e0ebeb7125ba2ebf7d421f3e82ffa", GitTreeState:"clean", GoVersion:"go1.13.4"}
```

- Ensure a TLS cert for your intended hostname is configured and ready, see section below.

### Useful helm (v3) commands:

__Test chart template rendering:__

This will out the fully rendered kubernetes resources in raw yaml.

```sh
helm template [path to chart] --values=values-dev.yaml
```

__List releases:__

```sh
helm --namespace [namespace] list
```

__List current and previously installed application versions:__

```sh
helm --namespace [namespace] history [release name]
```

__Rollback to previous version:__

```sh
helm --namespace [namespace] rollback [release name] [revision number] --wait
```

Note: replace _revision number_ with one from listed in the `history` command)

__Example deploy command:__

The following example is `--dry-run` mode - which will allow for testing. Github actions normally runs this command with actual secret values (from AWS secret manager), and also updated the chart's application version to match the release version:

```sh
helm upgrade [release name] [path to chart]. \
  --install --wait --force --reset-values --timeout 5m --history-max 10 \
  --dry-run \
  --namespace [namespace] \
  --values values-dev.yaml \
  --values example-secrets.yaml
```

### Ingress TLS certificate

Ensure a certificate definition exists in the cloud-platform-environments repo under the relevant namespaces folder:

e.g.

```sh
cloud-platform-environments/namespaces/live-1.cloud-platform.service.justice.gov.uk/[INSERT NAMESPACE NAME]/05-certificate.yaml
```

Ensure the certificate is created and ready for use.

The name of the kubernetes secret where the certificate is stored is used as a value to the helm chart - this is used to configure the ingress.

## Bootstrap namespace secrets

Use the script below to generate values for each secret listed under `generic-service.namespace_secrets` in `hmpps-domain-explorer-ui/values.yaml`, then create/update those secrets in a namespace.

By default, existing secrets are not rotated.

```sh
npm run bootstrap:namespace-secrets -- <namespace>
```

Useful options:

```sh
# Preview generated values without applying to kubernetes
npm run bootstrap:namespace-secrets -- <namespace> --dry-run

# Rotate existing secrets
npm run bootstrap:namespace-secrets -- <namespace> --rotate

# Process only one secret name from namespace_secrets
npm run bootstrap:namespace-secrets -- <namespace> --name hmpps-domain-explorer-ui-auth-code

# Set an explicit value for a named single-key secret
npm run bootstrap:namespace-secrets -- <namespace> --name hmpps-domain-explorer-ui-session-secret --value my-session-secret --rotate

# Use a different values file
npm run bootstrap:namespace-secrets -- <namespace> --values-file helm_deploy/hmpps-domain-explorer-ui/values.yaml
```

Note: generated values are suitable for bootstrapping only. Replace them with environment-specific values where needed.
`--value` only works with `--name`, and only for secrets that contain a single key in `namespace_secrets`.

