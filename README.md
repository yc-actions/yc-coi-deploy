## GitHub Action to deploy your container into Yandex Cloud virtual machine created from Container Optimized Image.

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
      uses: yc-actions/yc-coi-deploy@v1
      env:
        CR_REGISTRY: crp00000000000000000
        CR_REPOSITORY: my-cr-repo
        IMAGE_TAG: ${{ github.sha }}
      with:
        yc-sa-json-credentials: ${{ secrets.YC_SA_JSON_CREDENTIALS }}
        folder-id: bbajn5q2d74c********
        VM-name: yc-action-demo
        vm-service-account-id: ajeqnasj95o7********
        vm-cores: 1
        vm-memory: 512Mb
        vm-core-fraction: 100
        vm-subnet-id: e9b*********
        user-data-path: './user-data.yaml'
        docker-compose-path: './docker-compose.yaml'
```

Data from files `user-data.yaml` and `docker-compose.yaml` will be passed to the Mustache template renderer, so the there
could be used environment variables substitution via `{{ env.VARIABLE }}` syntax.  

See [action.yml](action.yml) for the full documentation for this action's inputs and outputs.

## Permissions

This action requires the following minimum set of permissions:

TODO: add permission set

## License Summary

This code is made available under the MIT license.
