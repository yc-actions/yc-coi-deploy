/* eslint-disable @typescript-eslint/no-explicit-any */
import { Instance } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/compute/v1/instance'
import { Operation } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/operation/operation'
import { Writer } from 'protobufjs'
import { decodeMessage } from '@yandex-cloud/nodejs-sdk'
import { ServiceAccount } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account'

const sdk: any = jest.createMockFromModule('@yandex-cloud/nodejs-sdk')

let instances: Instance[] = []
let serviceAccounts: ServiceAccount[] = [
    ServiceAccount.fromJSON({
        id: 'serviceaccountid'
    })
]
let createInstanceFail = false
let updateMetadataFail = false

const ImageServiceMock = {
    get: jest.fn().mockImplementation(() => ({
        id: 'imageid'
    })),
    getLatestByFamily: jest.fn().mockImplementation(() => ({
        id: 'imageid'
    }))
}

type PayloadClass<T> = {
    $type: string
    encode: (message: T, writer?: Writer) => Writer
    decode: (payload: Uint8Array) => T
    fromJSON: (payload: object) => T
}

function getOperation(payloadClass: PayloadClass<any>, data: object): Operation {
    return Operation.fromJSON({
        id: 'operationid',
        response: {
            typeUrl: payloadClass.$type,
            value: Buffer.from(payloadClass.encode(payloadClass.fromJSON(data)).finish()).toString('base64')
        },
        done: true
    })
}

const InstanceServiceMock = {
    create: jest.fn().mockImplementation(() => {
        if (createInstanceFail) {
            return Operation.fromJSON({
                id: 'operationid',
                error: {},
                done: true
            })
        }

        const data = {
            id: 'instanceid',
            metadata: {
                'enable-oslogin': 'false',
                'user-data': 'userdata',
                'docker-compose': 'dockercompose'
            },
            bootDisk: {
                diskId: 'diskid'
            },
            networkInterfaces: [
                {
                    primaryV4Address: {
                        oneToOneNat: {
                            address: '1.1.1.1'
                        }
                    }
                }
            ]
        }

        instances = [Instance.fromJSON(data)]
        return getOperation(Instance, data)
    }),
    get: jest.fn().mockImplementation(() => {
        return instances[0]
    }),
    list: jest.fn().mockImplementation(() => ({
        instances
    })),
    updateMetadata: jest.fn().mockImplementation(() => {
        return updateMetadataFail
            ? Operation.fromJSON({
                  id: 'operationid',
                  error: {},
                  done: true
              })
            : getOperation(Instance, {
                  id: 'instanceid',
                  bootDisk: {
                      diskId: 'diskid'
                  }
              })
    })
}

const ServiceAccountServiceMock = {
    list: jest.fn().mockImplementation(() => ({
        serviceAccounts
    }))
}

sdk.Session = jest.fn().mockImplementation(() => ({
    client: (service: { serviceName: string }) => {
        if (service.serviceName === 'yandex.cloud.compute.v1.ImageService') {
            return ImageServiceMock
        }
        if (service.serviceName === 'yandex.cloud.compute.v1.InstanceService') {
            return InstanceServiceMock
        }

        if (service.serviceName === 'yandex.cloud.iam.v1.ServiceAccountService') {
            return ServiceAccountServiceMock
        }
    }
}))

sdk.waitForOperation = jest.fn().mockImplementation((op: Operation) => op)
sdk.decodeMessage = decodeMessage

sdk.__setComputeInstanceList = (value: Instance[]) => {
    instances = value
}

sdk.__setServiceAccountList = (value: any[]) => {
    serviceAccounts = value
}

sdk.__setCreateInstanceFail = (value: boolean) => {
    createInstanceFail = value
}

sdk.__setUpdateMetadataFail = (value: boolean) => {
    updateMetadataFail = value
}

export = sdk
