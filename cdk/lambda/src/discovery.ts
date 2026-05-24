import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { v4 as uuidv4 } from 'uuid';

const ssm = new SSMClient({ region: 'us-east-1' });

interface EntityConfig {
  entityId: string;
  friendlyName: string;
  type: 'LIGHT' | 'SWITCH' | 'THERMOSTAT' | 'SCENE_TRIGGER';
  capabilities: string[];
}

const CAPABILITY_DEFINITIONS: Record<string, object> = {
  PowerController: {
    type: 'AlexaInterface',
    interface: 'Alexa.PowerController',
    version: '3',
    properties: { supported: [{ name: 'powerState' }], proactivelyReported: false, retrievable: false },
  },
  BrightnessController: {
    type: 'AlexaInterface',
    interface: 'Alexa.BrightnessController',
    version: '3',
    properties: { supported: [{ name: 'brightness' }], proactivelyReported: false, retrievable: false },
  },
  ColorController: {
    type: 'AlexaInterface',
    interface: 'Alexa.ColorController',
    version: '3',
    properties: { supported: [{ name: 'color' }], proactivelyReported: false, retrievable: false },
  },
};

const ALEXA_BASE = {
  type: 'AlexaInterface',
  interface: 'Alexa',
  version: '3',
};

export async function discovery(event: any): Promise<any> {
  const paramName = process.env.ENTITY_CATALOG_PARAM!;
  const result = await ssm.send(new GetParameterCommand({ Name: paramName }));
  const entities: EntityConfig[] = JSON.parse(result.Parameter?.Value ?? '[]');

  const endpoints = entities.map((e) => ({
    endpointId: e.entityId,
    friendlyName: e.friendlyName,
    description: `Home Assistant ${e.type.toLowerCase()}`,
    manufacturerName: 'Home Assistant',
    displayCategories: [e.type === 'SWITCH' ? 'SWITCH' : e.type === 'THERMOSTAT' ? 'THERMOSTAT' : 'LIGHT'],
    capabilities: [
      ALEXA_BASE,
      ...e.capabilities.map((cap) => CAPABILITY_DEFINITIONS[cap]).filter(Boolean),
    ],
  }));

  return {
    event: {
      header: {
        namespace: 'Alexa.Discovery',
        name: 'Discover.Response',
        messageId: uuidv4(),
        payloadVersion: '3',
      },
      payload: { endpoints },
    },
  };
}
