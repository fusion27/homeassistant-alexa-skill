import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SSMClient } from '@aws-sdk/client-ssm';
import { discovery } from './discovery';
import { handleController } from './controllers';
import { DynamoExposureRepository, ExposureReader } from './manifest/repository';
import { acceptGrant } from './alexa/accept-grant';
import { DynamoGrantStore, GrantStore } from './alexa/grant-store';
import { HttpLwaClient, LwaClient } from './alexa/lwa';
import { SsmCredentialsSource } from './alexa/credentials';

const dynamo = new DynamoDBClient({});
const tableName: string = process.env.EXPOSURE_TABLE ?? '';
const exposure: ExposureReader = new DynamoExposureRepository(dynamo, tableName);
const grants: GrantStore = new DynamoGrantStore(dynamo, tableName);
const lwa: LwaClient = new HttpLwaClient(new SsmCredentialsSource(new SSMClient({}), process.env.CONFIG_PARAMETER ?? ''));

export async function handler(event: any): Promise<any> {
  const namespace: string = event?.directive?.header?.namespace ?? '';
  // Never log the whole directive: it carries the account-link bearer token.
  console.log(JSON.stringify({
    msg: 'directive',
    namespace,
    name: event?.directive?.header?.name,
    endpointId: event?.directive?.endpoint?.endpointId,
  }));

  switch (namespace) {
    case 'Alexa.Discovery':
      return discovery(exposure);
    case 'Alexa.Authorization':
      return acceptGrant(event, lwa, grants);
    case 'Alexa.PowerController':
    case 'Alexa.BrightnessController':
    case 'Alexa.ColorController':
    case 'Alexa.ThermostatController':
    case 'Alexa.ModeController':
    case 'Alexa.SceneController':
      return handleController(event, exposure);
    default:
      console.warn('Unhandled namespace:', namespace);
      return buildErrorResponse(event, 'INVALID_DIRECTIVE', `Unsupported namespace: ${namespace}`);
  }
}

export function buildErrorResponse(event: any, type: string, message: string): any {
  return {
    event: {
      header: {
        namespace: 'Alexa',
        name: 'ErrorResponse',
        messageId: event?.directive?.header?.messageId,
        payloadVersion: '3',
      },
      endpoint: event?.directive?.endpoint,
      payload: { type, message },
    },
  };
}
