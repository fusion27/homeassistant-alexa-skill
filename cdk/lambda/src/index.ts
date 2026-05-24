import { discovery } from './discovery';
import { handleController } from './controllers';

export async function handler(event: any): Promise<any> {
  console.log('Directive:', JSON.stringify(event, null, 2));

  const namespace: string = event?.directive?.header?.namespace ?? '';

  switch (namespace) {
    case 'Alexa.Discovery':
      return discovery(event);
    case 'Alexa.PowerController':
    case 'Alexa.BrightnessController':
    case 'Alexa.ColorController':
    case 'Alexa.ThermostatController':
      return handleController(event);
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
