import * as core from '@actions/core';
import * as github from '@actions/github';
import {Session} from '@nikolay.matrosov/yc-ts-sdk';
import {ImageService, InstanceService} from '@nikolay.matrosov/yc-ts-sdk/lib/api/compute/v1';
import {ServiceAccountService} from '@nikolay.matrosov/yc-ts-sdk/lib/api/iam/v1';
import {
  GetImageLatestByFamilyRequest,
  ImageServiceService,
} from '@nikolay.matrosov/yc-ts-sdk/lib/generated/yandex/cloud/compute/v1/image_service';
import {IpVersion} from '@nikolay.matrosov/yc-ts-sdk/lib/generated/yandex/cloud/compute/v1/instance';
import {
  AttachedDiskSpec_Mode,
  CreateInstanceRequest,
  InstanceServiceService,
  ListInstancesRequest,
  UpdateInstanceMetadataRequest,
} from '@nikolay.matrosov/yc-ts-sdk/lib/generated/yandex/cloud/compute/v1/instance_service';
import {
  ListServiceAccountsRequest,
  ServiceAccountServiceService,
} from '@nikolay.matrosov/yc-ts-sdk/lib/generated/yandex/cloud/iam/v1/service_account_service';
import {Operation} from '@nikolay.matrosov/yc-ts-sdk/lib/generated/yandex/cloud/operation/operation';
import {completion} from '@nikolay.matrosov/yc-ts-sdk/lib/src/operation';
import {fromServiceAccountJsonFile} from '@nikolay.matrosov/yc-ts-sdk/lib/src/TokenService/iamTokenService';
import * as fs from 'fs';
import Mustache from 'mustache';
import {Client} from 'nice-grpc';
import * as path from 'path';
import {parseMemory} from './memory';

async function findCoiImageId(imageService: Client<typeof ImageServiceService, {}>): Promise<string> {
  core.startGroup('Find COI image id');

  const res = await imageService.getLatestByFamily(
    GetImageLatestByFamilyRequest.fromPartial({
      folderId: 'standard-images',
      family: 'container-optimized-image',
    }),
  );
  core.info(`COI image id: ${res.id}`);
  core.endGroup();
  return res.id;
}

async function resolveServiceAccountId(
  saService: Client<typeof ServiceAccountServiceService, {}>,
  folderId: string,
  name: string,
): Promise<string | null> {
  const res = await saService.list(
    ListServiceAccountsRequest.fromPartial({
      folderId,
      filter: `name = '${name}'`,
    }),
  );

  return res.serviceAccounts.length ? res.serviceAccounts[0].id : null;
}

async function findVm(
  instanceService: Client<typeof InstanceServiceService, {}>,
  folderId: string,
  name: string,
): Promise<string | null> {
  core.startGroup('Find VM by name');
  const res = await instanceService.list(
    ListInstancesRequest.fromPartial({
      folderId,
      filter: `name = '${name}'`,
    }),
  );
  core.endGroup();
  if (res.instances.length) {
    return res.instances[0].id;
  }
  return null;
}

interface ResourcesSpec {
  memory: number;
  cores: number;
  coreFraction: number;
}

interface VmParams {
  userDataPath: string;
  dockerComposePath: string;
  subnetId: string;
  serviceAccountId: string;
  serviceAccountName: string | undefined;
  diskType: string;
  diskSize: number;
  folderId: string;
  name: string;
  zoneId: string;
  platformId: string;
  resourcesSpec: ResourcesSpec;
}

function prepareConfig(filePath: string): string {
  const workspace = process.env['GITHUB_WORKSPACE'] ?? '';
  const content = fs.readFileSync(path.join(workspace, filePath)).toString();

  return Mustache.render(content, {env: {...process.env}}, {}, {escape: x => x});
}

async function createVm(
  session: Session,
  instanceService: Client<typeof InstanceServiceService, {}>,
  imageService: Client<typeof ImageServiceService, {}>,
  vmParams: VmParams,
  repo: {owner: string; repo: string},
): Promise<void> {
  const coiImageId = await findCoiImageId(imageService);

  core.startGroup('Create new VM');

  const request = CreateInstanceRequest.fromPartial({
    folderId: vmParams.folderId,
    name: vmParams.name,
    description: `Created from: ${repo.owner}/${repo.repo}`,
    zoneId: vmParams.zoneId,
    platformId: vmParams.platformId,
    resourcesSpec: vmParams.resourcesSpec,
    metadata: {
      'user-data': prepareConfig(vmParams.userDataPath),
      'docker-compose': prepareConfig(vmParams.dockerComposePath),
    },
    labels: {},

    bootDiskSpec: {
      mode: AttachedDiskSpec_Mode.READ_WRITE,
      autoDelete: true,
      diskSpec: {
        typeId: vmParams.diskType,
        size: vmParams.diskSize,
        imageId: coiImageId,
      },
    },
    networkInterfaceSpecs: [
      {
        subnetId: vmParams.subnetId,
        primaryV4AddressSpec: {
          oneToOneNatSpec: {
            ipVersion: IpVersion.IPV4,
          },
        },
      },
    ],
    serviceAccountId: vmParams.serviceAccountId,
  });

  core.debug(`CreateInstanceRequest: ${CreateInstanceRequest.toJSON(request)}`);

  let op = await instanceService.create(request);
  op = await completion(op, session);

  core.debug(`Operation completed: ${op.response}`);

  handleOperationError(op);
  core.endGroup();
}

async function updateMetadata(
  session: Session,
  instanceService: Client<typeof InstanceServiceService, {}>,
  instanceId: string,
  vmParams: VmParams,
): Promise<Operation> {
  core.startGroup('Update metadata');

  let op = await instanceService.updateMetadata(
    UpdateInstanceMetadataRequest.fromPartial({
      instanceId,
      upsert: {
        'user-data': prepareConfig(vmParams.userDataPath),
        'docker-compose': prepareConfig(vmParams.dockerComposePath),
      },
    }),
  );
  op = await completion(op, session);
  handleOperationError(op);
  core.endGroup();
  return op;
}

function parseVmInputs(): VmParams {
  core.startGroup('Parsing Action Inputs');

  const folderId: string = core.getInput('folder-id', {
    required: true,
  });
  const userDataPath: string = core.getInput('user-data-path', {required: true});
  const dockerComposePath: string = core.getInput('docker-compose-path', {required: true});
  const name: string = core.getInput('vm-name', {required: true});
  const serviceAccountId: string = core.getInput('vm-service-account-id');
  const serviceAccountName: string = core.getInput('vm-service-account-name');

  if (!serviceAccountId && !serviceAccountName) {
    throw new Error('Either id or name of service account should be provided');
  }

  const zoneId: string = core.getInput('vm-zone-id') || 'ru-central1-a';
  const subnetId: string = core.getInput('vm-subnet-id', {required: true});
  const platformId: string = core.getInput('vm-platform-id') || 'standard-v3';
  const cores: number = parseInt(core.getInput('vm-cores') || '2', 10);
  const memory: number = parseMemory(core.getInput('vm-memory') || '1Gb');
  const diskType: string = core.getInput('vm-disk-type') || 'network-ssd';
  const diskSize: number = parseMemory(core.getInput('vm-disk-size') || '30Gb');
  const coreFraction: number = parseInt(core.getInput('vm-core-fraction') || '100', 10);

  core.endGroup();
  return {
    diskType,
    diskSize,
    subnetId,
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
      coreFraction,
    },
  };
}

async function run(): Promise<void> {
  try {
    core.info(`start`);
    const ycSaJsonCredentials = core.getInput('yc-sa-json-credentials', {
      required: true,
    });

    const vmInputs = parseVmInputs();

    core.info(`Folder ID: ${vmInputs.folderId}, name: ${vmInputs.name}`);

    const serviceAccountJson = fromServiceAccountJsonFile(JSON.parse(ycSaJsonCredentials));
    core.info('Parsed Service account JSON');

    const session = new Session({serviceAccountJson});
    const imageService = ImageService(session);
    const instanceService = InstanceService(session);
    const serviceAccountService = ServiceAccountService(session);

    if (!vmInputs.serviceAccountId && vmInputs.serviceAccountName !== undefined) {
      const {folderId, serviceAccountName} = vmInputs;
      const id = await resolveServiceAccountId(serviceAccountService, folderId, serviceAccountName);
      if (!id) {
        core.setFailed(`There is no service account '${serviceAccountName}' in folder ${folderId}`);
        return;
      }
      vmInputs.serviceAccountId = id;
    }

    const vmId = await findVm(instanceService, vmInputs.folderId, vmInputs.name);
    if (vmId === null) {
      core.debug(`No VM found - creating`);
      await createVm(session, instanceService, imageService, vmInputs, github.context.repo);
    } else {
      core.debug(`VM found - updating metadata`);
      await updateMetadata(session, instanceService, vmId, vmInputs);
    }
  } catch (error) {
    core.setFailed(error as Error);
  }
}

function handleOperationError(operation: Operation): void {
  if (operation.error) {
    const details = operation.error?.details;
    if (details) {
      throw Error(`${operation.error.code}: ${operation.error.message} (${details.join(', ')})`);
    }

    throw Error(`${operation.error.code}: ${operation.error.message}`);
  }
}

run();
