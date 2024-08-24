/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * These should be run as if the action was called from a workflow.
 * Specifically, the inputs listed in `action.yml` should be set as environment
 * variables following the pattern `INPUT_<INPUT_NAME>`.
 */

import * as core from '@actions/core'
import * as main from '../src/main'
import * as sdk from '@yandex-cloud/nodejs-sdk'
import * as github from '@actions/github'
import { Instance } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/compute/v1/instance'
import { ServiceAccount } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account'
import { DOCKER_CONTAINER_DECLARATION_KEY } from '../src/const'

declare module '@yandex-cloud/nodejs-sdk' {
    function __setComputeInstanceList(value: Instance[]): void

    function __setServiceAccountList(value: ServiceAccount[]): void

    function __setCreateInstanceFail(value: boolean): void

    function __setUpdateMetadataFail(value: boolean): void
}

// Mock the action's main function
const runMock = jest.spyOn(main, 'run')

// Mock the GitHub Actions core library
let errorMock: jest.SpyInstance
let getInputMock: jest.SpyInstance
let setFailedMock: jest.SpyInstance
let setOutputMock: jest.SpyInstance

// yandex sdk mock

const requiredInputs: Record<string, string> = {
    'yc-sa-json-credentials': `{
    "id": "id",
    "created_at": "2021-01-01T00:00:00Z", 
    "key_algorithm": "RSA_2048",
    "service_account_id": "service_account_id",
    "private_key": "private_key",
    "public_key": "public_key"
  }`,
    'folder-id': 'folderid',
    'vm-zone-id': 'ru-central1-a',
    'vm-subnet-id': 'subnetid',
    'user-data-path': '__tests__/user-data.yaml',
    'docker-compose-path': '__tests__/docker-compose.yaml'
}

const defaultInputs: Record<string, string> = {
    ...requiredInputs,
    'vm-name': 'vmname',
    'vm-service-account-id': 'vm-service-account-id',
    'vm-cores': '2',
    'vm-memory': '1GB',
    'vm-core-fraction': '100',
    'vm-disk-type': 'network-ssd',
    'vm-disk-size': '30GB',
    'vm-platform-id': 'standard-v3',
    'metadata-enable-oslogin': 'false'
}
describe('action', () => {
    beforeEach(() => {
        jest.clearAllMocks()

        errorMock = jest.spyOn(core, 'error').mockImplementation()
        getInputMock = jest.spyOn(core, 'getInput').mockImplementation()
        setFailedMock = jest.spyOn(core, 'setFailed').mockImplementation()
        setOutputMock = jest.spyOn(core, 'setOutput').mockImplementation()
        jest.spyOn(github.context, 'repo', 'get').mockImplementation(() => {
            return {
                owner: 'some-owner',
                repo: 'some-repo'
            }
        })
        sdk.__setServiceAccountList([
            ServiceAccount.fromJSON({
                id: 'serviceaccountid'
            })
        ])
        sdk.__setCreateInstanceFail(false)
        sdk.__setUpdateMetadataFail(false)
    })

    it('updates vm when there is one', async () => {
        // Set the action's inputs as return values from core.getInput()
        getInputMock.mockImplementation((name: string): string => {
            const inputs = {
                ...defaultInputs
            }

            return inputs[name] || ''
        })

        process.env.GITHUB_REPOSITORY = 'owner/repo'
        process.env.GITHUB_SHA = 'sha'

        sdk.__setComputeInstanceList([
            Instance.fromJSON({
                id: 'instanceid',
                metadata: {
                    'enable-oslogin': 'false',
                    'user-data': 'userdata',
                    'docker-compose': 'dockercompose'
                }
            })
        ])

        await main.run()
        expect(runMock).toHaveReturned()
        expect(errorMock).not.toHaveBeenCalled()
        expect(setFailedMock).not.toHaveBeenCalled()
        expect(setOutputMock).toHaveBeenCalledWith('instance-id', 'instanceid')
        expect(setOutputMock).toHaveBeenCalledWith('disk-id', 'diskid')
    })

    it('creates vm when there is none', async () => {
        // Set the action's inputs as return values from core.getInput()
        getInputMock.mockImplementation((name: string): string => {
            const inputs = {
                ...defaultInputs
            }

            return inputs[name] || ''
        })

        sdk.__setComputeInstanceList([])

        await main.run()
        expect(runMock).toHaveReturned()
        expect(errorMock).not.toHaveBeenCalled()
        expect(setFailedMock).not.toHaveBeenCalled()
        expect(setOutputMock).toHaveBeenCalledWith('instance-id', 'instanceid')
        expect(setOutputMock).toHaveBeenCalledWith('disk-id', 'diskid')
    })

    it('reports if could not create vm', async () => {
        // Set the action's inputs as return values from core.getInput()
        getInputMock.mockImplementation((name: string): string => {
            const inputs = {
                ...defaultInputs
            }

            return inputs[name] || ''
        })

        sdk.__setComputeInstanceList([])
        sdk.__setCreateInstanceFail(true)

        await main.run()
        expect(runMock).toHaveReturned()
        expect(errorMock).toHaveBeenCalled()
        expect(setFailedMock).toHaveBeenCalled()
    })

    it('resolves service account id', async () => {
        // Set the action's inputs as return values from core.getInput()
        getInputMock.mockImplementation((name: string): string => {
            const inputs: Record<string, string> = {
                ...defaultInputs,
                'vm-service-account-id': '',
                'vm-service-account-name': 'service-account-name'
            }

            return inputs[name] || ''
        })

        sdk.__setComputeInstanceList([])

        await main.run()
        expect(runMock).toHaveReturned()
        expect(errorMock).not.toHaveBeenCalled()
        expect(setFailedMock).not.toHaveBeenCalled()
        expect(setOutputMock).toHaveBeenCalledWith('instance-id', 'instanceid')
        expect(setOutputMock).toHaveBeenCalledWith('disk-id', 'diskid')
    })

    it('should fail if neither service account id nor name is provided', async () => {
        // Set the action's inputs as return values from core.getInput()
        getInputMock.mockImplementation((name: string): string => {
            const inputs: Record<string, string> = {
                ...defaultInputs,
                'vm-service-account-id': '',
                'vm-service-account-name': ''
            }

            return inputs[name] || ''
        })

        sdk.__setComputeInstanceList([])

        await main.run()
        expect(runMock).toHaveReturned()
        expect(errorMock).not.toHaveBeenCalled()
        expect(setFailedMock).toHaveBeenCalledWith(new Error('Either id or name of service account should be provided'))
        expect(setOutputMock).not.toHaveBeenCalledWith('instance-id', 'instanceid')
        expect(setOutputMock).not.toHaveBeenCalledWith('disk-id', 'diskid')
    })

    it('should run with only required inputs provided', async () => {
        getInputMock.mockImplementation((name: string): string => {
            const inputs: Record<string, string> = {
                ...requiredInputs,
                'vm-service-account-id': 'vm-service-account-id'
            }

            return inputs[name] || ''
        })

        sdk.__setComputeInstanceList([])

        await main.run()
        expect(runMock).toHaveReturned()
        expect(errorMock).not.toHaveBeenCalled()
        expect(setFailedMock).not.toHaveBeenCalled()
        expect(setOutputMock).toHaveBeenCalledWith('instance-id', 'instanceid')
        expect(setOutputMock).toHaveBeenCalledWith('disk-id', 'diskid')
    })

    it('should fail if could not resolve SA', async () => {
        getInputMock.mockImplementation((name: string): string => {
            const inputs: Record<string, string> = {
                ...requiredInputs,
                'vm-service-account-name': 'unknown'
            }

            return inputs[name] || ''
        })

        sdk.__setComputeInstanceList([])
        sdk.__setServiceAccountList([])

        await main.run()
        expect(runMock).toHaveReturned()
        expect(setFailedMock).toHaveBeenCalledWith("There is no service account 'unknown' in folder folderid")
        expect(setOutputMock).not.toHaveBeenCalledWith('instance-id', 'instanceid')
        expect(setOutputMock).not.toHaveBeenCalledWith('disk-id', 'diskid')
    })

    it('should fail if VM has conflictiong matadata', async () => {
        getInputMock.mockImplementation((name: string): string => {
            const inputs: Record<string, string> = {
                ...requiredInputs,
                'vm-service-account-name': 'unknown'
            }

            return inputs[name] || ''
        })

        sdk.__setComputeInstanceList([
            Instance.fromJSON({
                id: 'instanceid',
                metadata: {
                    'user-data': 'userdata',
                    [DOCKER_CONTAINER_DECLARATION_KEY]: 'unsupported'
                }
            })
        ])

        await main.run()
        expect(runMock).toHaveReturned()
        expect(setFailedMock).toHaveBeenCalledWith(
            new Error(
                "Provided VM was created with 'docker-container-declaration' metadata key.\n" +
                    "It will conflict with 'docker-compose' key this action using.\n" +
                    'Either recreate VM using docker-compose as container definition\n' +
                    "or let the action create the new one by dropping 'name' parameter."
            )
        )
        expect(setOutputMock).not.toHaveBeenCalledWith('instance-id', 'instanceid')
        expect(setOutputMock).not.toHaveBeenCalledWith('disk-id', 'diskid')
    })

    it('reports if could not update metadata', async () => {
        // Set the action's inputs as return values from core.getInput()
        getInputMock.mockImplementation((name: string): string => {
            const inputs = {
                ...defaultInputs
            }

            return inputs[name] || ''
        })

        sdk.__setComputeInstanceList([
            Instance.fromJSON({
                id: 'instanceid',
                metadata: {
                    'enable-oslogin': 'false',
                    'user-data': 'userdata',
                    'docker-compose': 'dockercompose'
                }
            })
        ])
        sdk.__setUpdateMetadataFail(true)

        await main.run()
        expect(runMock).toHaveReturned()
        expect(errorMock).toHaveBeenCalled()
        expect(setFailedMock).toHaveBeenCalled()
    })
})
