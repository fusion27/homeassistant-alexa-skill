import { publishCommand } from './iot';
import { buildErrorResponse } from './index';
import { v4 as uuidv4 } from 'uuid';
import { ExposureReader } from './manifest/repository';
import { ManifestEntry } from './manifest/schema';

const TYPE_TO_DOMAIN: Record<string, string> = {
  SWITCH: 'switch',
  LIGHT: 'light',
  LOCK: 'lock',
  CLIMATE: 'climate',
  THERMOSTAT: 'climate',
  SCENE_TRIGGER: 'scene',
  COVER: 'cover',
};

function resolveService(domain: string, name: string): string {
  if (domain === 'cover') {
    return name === 'TurnOn' ? 'open_cover' : 'close_cover';
  }
  return name === 'TurnOn' ? 'turn_on' : 'turn_off';
}

interface ResolvedTarget {
  entityId: string;
  domain: string;
  source: 'dynamodb' | 'legacy-cookie';
}

async function resolveTarget(event: any, exposure: ExposureReader): Promise<ResolvedTarget | undefined> {
  const endpointId: string = event.directive.endpoint.endpointId;
  const endpoint: ManifestEntry | undefined = await exposure.getEndpoint(endpointId);
  if (endpoint !== undefined) {
    return { entityId: endpoint.entityId, domain: TYPE_TO_DOMAIN[endpoint.type] ?? endpoint.entityId.split('.')[0], source: 'dynamodb' };
  }
  // TRANSITIONAL (remove in Slice 2 with the SSM catalog): devices discovered before the
  // DynamoDB cutover use endpointId = entity_id, or a cover cookie carrying haEntityId.
  const cookie: { haType?: string; haEntityId?: string } = event.directive.endpoint.cookie ?? {};
  const legacyEntityId: string | undefined = cookie.haEntityId ?? (endpointId.includes('.') ? endpointId : undefined);
  if (legacyEntityId === undefined) return undefined;
  const domain: string = (cookie.haType ? TYPE_TO_DOMAIN[cookie.haType] : undefined) ?? legacyEntityId.split('.')[0];
  return { entityId: legacyEntityId, domain, source: 'legacy-cookie' };
}

export async function handleController(event: any, exposure: ExposureReader): Promise<any> {
  const namespace: string = event.directive.header.namespace;
  const name: string = event.directive.header.name;
  const endpointId: string = event.directive.endpoint.endpointId;

  try {
    const target: ResolvedTarget | undefined = await resolveTarget(event, exposure);
    if (target === undefined) {
      return buildErrorResponse(event, 'NO_SUCH_ENDPOINT', `Endpoint ${endpointId} is not exposed`);
    }
    const { entityId, domain } = target;
    console.log(JSON.stringify({ msg: 'resolved endpoint', endpointId, entityId, source: target.source }));

    let command;

    if (namespace === 'Alexa.ModeController') {
      const mode: string = event.directive.payload.mode; // 'Position.Open' | 'Position.Closed'
      command = {
        domain,
        service: mode === 'Position.Open' ? 'open_cover' : 'close_cover',
        entity_id: entityId,
      };
    } else if (namespace === 'Alexa.PowerController') {
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
