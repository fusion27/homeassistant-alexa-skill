import { publishCommand } from './iot';
import { buildErrorResponse } from './index';
import { v4 as uuidv4 } from 'uuid';

const TYPE_TO_DOMAIN: Record<string, string> = {
  SWITCH: 'switch',
  LIGHT: 'light',
  LOCK: 'lock',
  CLIMATE: 'climate',
  THERMOSTAT: 'climate',
  SCENE_TRIGGER: 'scene',
  COVER: 'cover',
};

const FRUNK_JOKES = [
  "I'm sorry, but the frunk closure actuator is not equipped with a reverse-polarity electromagnetic latch motor. Manual intervention required.",
  "Negative. The frunk lid reintegration sequence requires biometric confirmation and a minimum of two carbon-fiber-reinforced human appendages.",
  "Error 418: Frunk closure protocol unavailable. The pneumatic hinge dampener does not support remote re-engagement. Please proceed manually.",
  "That action is outside my operational parameters. The frunk utilizes a passive gravity-assisted open state with no motorized return-to-closed capability. You're gonna have to touch it.",
  "Frunk closure via voice command is not supported by the onboard Tesla Fleet API closure subsystem. Kindly apply approximately 15 newtons of downward force to the lid.",
  "I've consulted the Tesla Fleet API documentation, three Stack Overflow threads, and two Reddit posts. The consensus is: go push it down yourself.",
  "Initiating frunk closure... just kidding. There's no motor. That's a you problem.",
];

function resolveService(domain: string, name: string): string {
  if (domain === 'cover') {
    return name === 'TurnOn' ? 'open_cover' : 'close_cover';
  }
  return name === 'TurnOn' ? 'turn_on' : 'turn_off';
}

export async function handleController(event: any): Promise<any> {
  const namespace: string = event.directive.header.namespace;
  const name: string = event.directive.header.name;
  const endpointId: string = event.directive.endpoint.endpointId;
  const cookie = event.directive.endpoint.cookie ?? {};
  const haType: string | undefined = cookie.haType;
  const coverType: string | undefined = cookie.coverType;
  const entityId: string = cookie.haEntityId ?? endpointId;
  const domain: string = haType ? (TYPE_TO_DOMAIN[haType] ?? endpointId.split('.')[0]) : endpointId.split('.')[0];

  try {
    let command;

    if (namespace === 'Alexa.ModeController') {
      const mode: string = event.directive.payload.mode; // 'Position.Open' | 'Position.Closed'
      if (domain === 'cover' && coverType === 'FRUNK' && mode === 'Position.Closed') {
        const joke = FRUNK_JOKES[Math.floor(Math.random() * FRUNK_JOKES.length)];
        return {
          event: {
            header: {
              namespace: 'Alexa',
              name: 'ErrorResponse',
              payloadVersion: '3',
              messageId: uuidv4(),
              correlationToken: event.directive.header.correlationToken,
            },
            endpoint: { endpointId },
            payload: { type: 'ENDPOINT_UNREACHABLE', message: joke },
          },
        };
      }
      command = {
        domain,
        service: mode === 'Position.Open' ? 'open_cover' : 'close_cover',
        entity_id: entityId,
      };
    } else if (namespace === 'Alexa.PowerController') {
      // Frunk close via PowerController fallback
      if (domain === 'cover' && coverType === 'FRUNK' && name === 'TurnOff') {
        const joke = FRUNK_JOKES[Math.floor(Math.random() * FRUNK_JOKES.length)];
        return {
          event: {
            header: {
              namespace: 'Alexa',
              name: 'ErrorResponse',
              payloadVersion: '3',
              messageId: uuidv4(),
              correlationToken: event.directive.header.correlationToken,
            },
            endpoint: { endpointId },
            payload: { type: 'ENDPOINT_UNREACHABLE', message: joke },
          },
        };
      }
      command = {
        domain,
        service: resolveService(domain, name),
        entity_id: entityId,
      };
    } else if (namespace === 'Alexa.BrightnessController') {
      const brightness = event.directive.payload.brightness;
      command = {
        domain,
        service: 'turn_on',
        entity_id: entityId,
        service_data: { brightness_pct: brightness },
      };
    } else if (namespace === 'Alexa.ColorController') {
      const { hue, saturation, brightness } = event.directive.payload.color;
      command = {
        domain,
        service: 'turn_on',
        entity_id: entityId,
        service_data: { hs_color: [hue, saturation * 100], brightness_pct: brightness * 100 },
      };
    } else {
      return buildErrorResponse(event, 'INVALID_DIRECTIVE', `Unhandled controller: ${namespace}`);
    }

    await publishCommand(command);

    const context = namespace === 'Alexa.ModeController'
      ? {
          properties: [{
            namespace: 'Alexa.ModeController',
            instance: 'Cover.Position',
            name: 'mode',
            value: event.directive.payload.mode,
            timeOfSample: new Date().toISOString(),
            uncertaintyInMilliseconds: 500,
          }],
        }
      : namespace === 'Alexa.PowerController'
      ? {
          properties: [{
            namespace: 'Alexa.PowerController',
            name: 'powerState',
            value: name === 'TurnOn' ? 'ON' : 'OFF',
            timeOfSample: new Date().toISOString(),
            uncertaintyInMilliseconds: 500,
          }],
        }
      : {};

    return {
      context,
      event: {
        header: {
          namespace: 'Alexa',
          name: 'Response',
          messageId: uuidv4(),
          correlationToken: event.directive.header.correlationToken,
          payloadVersion: '3',
        },
        endpoint: { endpointId },
        payload: {},
      },
    };
  } catch (err) {
    console.error('[Controller] Error:', err);
    return buildErrorResponse(event, 'INTERNAL_ERROR', String(err));
  }
}
