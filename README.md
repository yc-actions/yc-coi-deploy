## GitHub Action to deploy your container into Yandex Cloud virtual machine created from Container Optimized Image.

[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

The action creates a VM with the provided name in the provided folder if there is no one. Then it deploys a container
using the provided image name and tag.

**Table of Contents**

<!-- toc -->

- [Usage](#usage)
- [Permissions](#permissions)
- [License Summary](#license-summary)

<!-- tocstop -->

## Usage

```yaml
    - name: Login to Yandex Cloud Container Registry
      id: login-cr
      uses: yc-actions/yc-cr-login@v1
      with:
        yc-sa-json-credentials: ${{ secrets.YC_SA_JSON_CREDENTIALS }}

    - name: Build, tag, and push image to Yandex Cloud Container Registry
      env:
        CR_REGISTRY: crp00000000000000000
        CR_REPOSITORY: my-cr-repo
        IMAGE_TAG: ${{ github.sha }}
      run: |
        docker build -t cr.yandex/$CR_REGISTRY/$CR_REPOSITORY:$IMAGE_TAG .
        docker push cr.yandex/$CR_REGISTRY/$CR_REPOSITORY:$IMAGE_TAG

    - name: Deploy COI VM
      id: deploy-coi
      uses: yc-actions/yc-coi-deploy@v2
      env:
        CR_REGISTRY: crp00000000000000000
        CR_REPOSITORY: my-cr-repo
        IMAGE_TAG: ${{ github.sha }}
      with:
        yc-sa-json-credentials: ${{ secrets.YC_SA_JSON_CREDENTIALS }}
        folder-id: bbajn5q2d74c********
        vm-name: yc-action-demo
        vm-service-account-id: ajeqnasj95o7********
        vm-cores: 2
        vm-memory: 2Gb
        vm-core-fraction: 100
        vm-subnet-id: e9b*********
        user-data-path: './user-data.yaml'
        docker-compose-path: './docker-compose.yaml'
```

Data from files `user-data.yaml` and `docker-compose.yaml` will be passed to the Mustache template renderer, so the there
could be used environment variables substitution via `{{ env.VARIABLE }}` syntax.  

See [action.yml](action.yml) for the full documentation for this action's inputs and outputs.

## Permissions

### Deploy time permissions
To perform this action, the service account on behalf of which we are acting must have
the `compute.admin` role or higher.

### Runtime permissions

The service account provided to virtual machine must have the `container-registry.images.puller` role or higher, if images
provided in the `docker-compose` metadata key are stored in the Yandex.Cloud Container Registry and are private.


## Debug

### Conflict between `docker-compose` and `docker-container-declaration` metadata keys
There are two ways to provide info about container to deploy to the `yc-container-daemon` installed inside COI image:
1. Pass container declaration via `docker-container-declaration` metadata key.
2. Pass docker-compose.yaml via `docker-compose` metadata key.

But if both of these keys defined in the VM metadata deamon doesn't know what config it should use and fail with following exception:
```json
{
  "level":"ERROR",
  "ts":"2023-06-01T01:23:45.000Z",
  "caller":"mdtracking/checker.go:135",
  "msg": "OnChange callback failed: both 'docker-compose' and 'docker-container-declaration' are found in metadata, only one should be specified"
}
```
So the action detects the conflict and fails if there is `'docker-container-declaration'` in the metadata of the provided pre-created VM.

To fix the issue you should either let the action to create new VM by removing `name` param or recreate VM using
`'docker-compose'` method.

### Network configuration

If the VM does not have a [public IP address](https://yandex.cloud/en/docs/compute/operations/vm-control/vm-attach-public-ip)
that allows data exchange over the Internet, it won't be able to access the Yandex.Cloud Container Registry to pull the image.

In this case, there are several ways to give the virtual machine access to the registry without assigning an address:
- Use a [NAT gateway](https://yandex.cloud/en/docs/vpc/concepts/gateways).
- Set up traffic routing to the Internet using a [NAT instance](https://yandex.cloud/en/docs/vpc/tutorials/nat-instance/).

## License Summary

This code is made available under the MIT license.
