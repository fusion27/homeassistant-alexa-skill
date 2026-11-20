import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { discovery } from './discovery';
import { handleController } from './controllers';
import { DynamoExposureRepository, ExposureReader } from './manifest/repository';

const exposure: ExposureReader = new DynamoExposureRepository(new DynamoDBClient({}), process.env.EXPOSURE_TABLE ?? '');

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
    case 'Alexa.PowerController':
    case 'Alexa.BrightnessController':
    case 'Alexa.ColorController':
    case 'Alexa.ThermostatController':
    case 'Alexa.ModeController':
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
