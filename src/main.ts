import * as core from '@actions/core'
import * as github from '@actions/github'
import {
    decodeMessage,
    errors,
    serviceClients,
    Session,
    waitForOperation,
    WrappedServiceClientType
} from '@yandex-cloud/nodejs-sdk'
import {
    GetImageLatestByFamilyRequest,
    ImageServiceService
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/compute/v1/image_service'
import { Instance, IpVersion } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/compute/v1/instance'
import {
    AttachedDiskSpec_Mode,
    CreateInstanceRequest,
    GetInstanceRequest,
    InstanceServiceService,
    InstanceView,
    ListInstancesRequest,
    UpdateInstanceMetadataRequest
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/compute/v1/instance_service'
import {
    ListServiceAccountsRequest,
    ServiceAccountServiceService
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account_service'
import { Operation } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/operation/operation'
import * as fs from 'fs'
import Mustache from 'mustache'
import * as path from 'path'
import { DOCKER_COMPOSE_KEY, DOCKER_CONTAINER_DECLARATION_KEY } from './const'
import { parseMemory } from './memory'
import { fromServiceAccountJsonFile } from './service-account-json'

async function findCoiImageId(imageService: WrappedServiceClientType<typeof ImageServiceService>): Promise<string> {
    core.startGroup('Find COI image id')

    const res = await imageService.getLatestByFamily(
        GetImageLatestByFamilyRequest.fromPartial({
            folderId: 'standard-images',
            family: 'container-optimized-image'
        })
    )
    core.info(`COI image id: ${res.id}`)
    core.endGroup()
    return res.id
}

async function resolveServiceAccountId(
    saService: WrappedServiceClientType<typeof ServiceAccountServiceService>,
    folderId: string,
    name: string
): Promise<string | null> {
    const res = await saService.list(
        ListServiceAccountsRequest.fromPartial({
            folderId,
            filter: `name = '${name}'`
        })
    )

    return res.serviceAccounts.length ? res.serviceAccounts[0].id : null
}

async function findVm(
    instanceService: WrappedServiceClientType<typeof InstanceServiceService>,
    folderId: string,
    name: string
): Promise<string | null> {
    core.startGroup('Find VM by name')
    const res = await instanceService.list(
        ListInstancesRequest.fromPartial({
            folderId,
            filter: `name = '${name}'`
        })
    )
    core.endGroup()
    if (res.instances.length) {
        return res.instances[0].id
    }
    return null
}

interface ResourcesSpec {
    memory: number
    cores: number
    coreFraction: number
}

interface VmParams {
    userDataPath: string
    dockerComposePath: string
    subnetId: string
    ipAddress: string
    serviceAccountId: string
    serviceAccountName: string | undefined
    diskType: string
    diskSize: number
    folderId: string
    name: string
    zoneId: string
    platformId: string
    resourcesSpec: ResourcesSpec
    metadataEnableOslogin: string
}

function prepareConfig(filePath: string): string {
    const workspace = process.env['GITHUB_WORKSPACE'] ?? ''
    const content = fs.readFileSync(path.join(workspace, filePath)).toString()

    return Mustache.render(
        content,
        {
            env: { ...process.env }
        },
        {},
        { escape: x => x }
    )
}

function getInstanceFromOperation(op: Operation): Instance | undefined {
    const v = op.response?.value
    if (v !== undefined) {
        return Instance.decode(v)
    }
}

function setOutputs(op: Operation): void {
    const instance = getInstanceFromOperation(op)

    core.setOutput('instance-id', instance?.id)
    core.setOutput('disk-id', instance?.bootDisk?.diskId)

    if (instance?.networkInterfaces && instance?.networkInterfaces.length > 0) {
        core.setOutput('public-ip', instance?.networkInterfaces[0].primaryV4Address?.oneToOneNat?.address)
    }
}

async function createVm(
    session: Session,
    instanceService: WrappedServiceClientType<typeof InstanceServiceService>,
    imageService: WrappedServiceClientType<typeof ImageServiceService>,
    vmParams: VmParams,
    repo: { owner: string; repo: string }
): Promise<void> {
    const coiImageId = await findCoiImageId(imageService)

    core.startGroup('Create new VM')

    core.setOutput('created', 'true')

    const op = await instanceService.create(
        CreateInstanceRequest.fromPartial({
            folderId: vmParams.folderId,
            name: vmParams.name,
            description: `Created from: ${repo.owner}/${repo.repo}`,
            zoneId: vmParams.zoneId,
            platformId: vmParams.platformId,
            resourcesSpec: vmParams.resourcesSpec,
            metadata: {
                'enable-oslogin': vmParams.metadataEnableOslogin,
                'user-data': prepareConfig(vmParams.userDataPath),
                'docker-compose': prepareConfig(vmParams.dockerComposePath)
            },
            labels: {},

            bootDiskSpec: {
                mode: AttachedDiskSpec_Mode.READ_WRITE,
                autoDelete: true,
                diskSpec: {
                    typeId: vmParams.diskType,
                    size: vmParams.diskSize,
                    imageId: coiImageId
                }
            },
            networkInterfaceSpecs: [
                {
                    subnetId: vmParams.subnetId,
                    primaryV4AddressSpec: {
                        oneToOneNatSpec: {
                            address: vmParams.ipAddress,
                            ipVersion: IpVersion.IPV4
                        }
                    }
                }
            ],
            serviceAccountId: vmParams.serviceAccountId
        })
    )
    const finishedOp = await waitForOperation(op, session)
    if (finishedOp.response) {
        const instanceId = decodeMessage<Instance>(finishedOp.response).id
        core.info(`Created instance with id '${instanceId}'`)
    } else {
        core.error(`Failed to create instance'`)
        throw new Error('Failed to create instance')
    }
    setOutputs(finishedOp)
    core.endGroup()
}

async function updateMetadata(
    session: Session,
    instanceService: WrappedServiceClientType<typeof InstanceServiceService>,
    instanceId: string,
    vmParams: VmParams
): Promise<Operation> {
    core.startGroup('Update metadata')

    core.setOutput('created', 'false')

    const op = await instanceService.updateMetadata(
        UpdateInstanceMetadataRequest.fromPartial({
            instanceId,
            upsert: {
                'enable-oslogin': vmParams.metadataEnableOslogin,
                'user-data': prepareConfig(vmParams.userDataPath),
                'docker-compose': prepareConfig(vmParams.dockerComposePath)
            }
        })
    )
    const finishedOp = await waitForOperation(op, session)
    if (finishedOp.response) {
        core.info(`Updated instance with id '${instanceId}'`)
    } else {
        core.error(`Failed to update instance metadata'`)
        throw new Error('Failed  to update instance metadata')
    }
    setOutputs(op)
    core.endGroup()
    return op
}

function parseVmInputs(): VmParams {
    core.startGroup('Parsing Action Inputs')

    const folderId: string = core.getInput('folder-id', {
        required: true
    })
    const userDataPath: string = core.getInput('user-data-path', {
        required: true
    })
    const dockerComposePath: string = core.getInput('docker-compose-path', {
        required: true
    })
    const name: string = core.getInput('vm-name', { required: true })
    const serviceAccountId: string = core.getInput('vm-service-account-id')
    const serviceAccountName: string = core.getInput('vm-service-account-name')

    if (!serviceAccountId && !serviceAccountName) {
        throw new Error('Either id or name of service account should be provided')
    }

    const zoneId: string = core.getInput('vm-zone-id') || 'ru-central1-a'
    const subnetId: string = core.getInput('vm-subnet-id', { required: true })
    const ipAddress: string = core.getInput('vm-public-ip')
    const platformId: string = core.getInput('vm-platform-id') || 'standard-v3'
    const cores: number = parseInt(core.getInput('vm-cores') || '2', 10)
    const memory: number = parseMemory(core.getInput('vm-memory') || '2Gb')
    const diskType: string = core.getInput('vm-disk-type') || 'network-ssd'
    const diskSize: number = parseMemory(core.getInput('vm-disk-size') || '30Gb')
    const coreFraction: number = parseInt(core.getInput('vm-core-fraction') || '100', 10)
    const metadataEnableOslogin: string = core.getInput('metadata-enable-oslogin') || 'false'

    core.endGroup()
    return {
        diskType,
        diskSize,
        subnetId,
        ipAddress,
        zoneId,
        platformId,
        folderId,
        name,
        userDataPath,
        dockerComposePath,
        serviceAccountId,
        serviceAccountName,
        resourcesSpec: {
            cores,
            memory,
            coreFraction
        },
        metadataEnableOslogin
    }
}

async function detectMetadataConflict(
    session: Session,
    instanceService: WrappedServiceClientType<typeof InstanceServiceService>,
    instanceId: string
): Promise<boolean> {
    core.startGroup('Check metadata')
    const instance = await instanceService.get(
        GetInstanceRequest.fromPartial({
            instanceId,
            view: InstanceView.FULL
        })
    )
    if (DOCKER_CONTAINER_DECLARATION_KEY in instance.metadata) {
        throw Error(
            `Provided VM was created with '${DOCKER_CONTAINER_DECLARATION_KEY}' metadata key.
It will conflict with '${DOCKER_COMPOSE_KEY}' key this action using.
Either recreate VM using docker-compose as container definition
or let the action create the new one by dropping 'name' parameter.`
        )
    }
    core.endGroup()
    return true
}

export async function run(): Promise<void> {
    try {
        core.info(`start`)
        const ycSaJsonCredentials = core.getInput('yc-sa-json-credentials', {
            required: true
        })

        const vmInputs = parseVmInputs()

        core.info(`Folder ID: ${vmInputs.folderId}, name: ${vmInputs.name}`)

        const serviceAccountJson = fromServiceAccountJsonFile(JSON.parse(ycSaJsonCredentials))
        core.info('Parsed Service account JSON')

        const session = new Session({ serviceAccountJson })
        const imageService = session.client<typeof ImageServiceService>(serviceClients.ComputeImageServiceClient)
        const instanceService = session.client<typeof InstanceServiceService>(serviceClients.InstanceServiceClient)
        const serviceAccountService = session.client<typeof ServiceAccountServiceService>(
            serviceClients.ServiceAccountServiceClient
        )

        const { folderId, serviceAccountName } = vmInputs
        if (!vmInputs.serviceAccountId && serviceAccountName !== undefined) {
            const id = await resolveServiceAccountId(serviceAccountService, folderId, serviceAccountName)
            if (!id) {
                core.setFailed(`There is no service account '${serviceAccountName}' in folder ${folderId}`)
                return
            }
            vmInputs.serviceAccountId = id
        }

        const vmId = await findVm(instanceService, folderId, vmInputs.name)
        if (vmId === null) {
            await createVm(session, instanceService, imageService, vmInputs, github.context.repo)
        } else {
            await detectMetadataConflict(session, instanceService, vmId)
            await updateMetadata(session, instanceService, vmId, vmInputs)
        }
    } catch (error) {
        if (error instanceof errors.ApiError) {
            core.error(`${error.message}\nx-request-id: ${error.requestId}\nx-server-trace-id: ${error.serverTraceId}`)
        }
        core.setFailed(error as Error)
    }
}
