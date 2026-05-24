import { publishCommand } from './iot';
import { buildErrorResponse } from './index';
import { v4 as uuidv4 } from 'uuid';

export async function handleController(event: any): Promise<any> {
  const namespace: string = event.directive.header.namespace;
  const name: string = event.directive.header.name;
  const endpointId: string = event.directive.endpoint.endpointId;
  const [domain] = endpointId.split('.');

  try {
    let command;

    if (namespace === 'Alexa.PowerController') {
      command = {
        domain,
        service: name === 'TurnOn' ? 'turn_on' : 'turn_off',
        entity_id: endpointId,
      };
    } else if (namespace === 'Alexa.BrightnessController') {
      const brightness = event.directive.payload.brightness;
      command = {
        domain,
        service: 'turn_on',
        entity_id: endpointId,
        service_data: { brightness_pct: brightness },
      };
    } else if (namespace === 'Alexa.ColorController') {
      const { hue, saturation, brightness } = event.directive.payload.color;
      command = {
        domain,
        service: 'turn_on',
        entity_id: endpointId,
        service_data: { hs_color: [hue, saturation * 100], brightness_pct: brightness * 100 },
      };
    } else {
      return buildErrorResponse(event, 'INVALID_DIRECTIVE', `Unhandled controller: ${namespace}`);
    }

    await publishCommand(command);

    return {
      context: {},
      event: {
        header: {
          namespace: 'Alexa',
          name: 'Response',
          messageId: uuidv4(),
          correlationToken: event.directive.header.correlationToken,
          payloadVersion: '3',
        },
        endpoint: {
          scope: event.directive.endpoint.scope,
          endpointId,
        },
        payload: {},
      },
    };
  } catch (err) {
    console.error('[Controller] Error:', err);
    return buildErrorResponse(event, 'INTERNAL_ERROR', String(err));
  }
}
