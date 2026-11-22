import { v4 as uuidv4 } from 'uuid';
import { Capability, ManifestEntry } from './manifest/schema';
import { ExposureReader } from './manifest/repository';

const CAPABILITY_DEFINITIONS: Record<Capability, object> = {
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
  SceneController: {
    type: 'AlexaInterface',
    interface: 'Alexa.SceneController',
    version: '3',
    supportsDeactivation: false,
  },
};

const ALEXA_BASE = {
  type: 'AlexaInterface',
  interface: 'Alexa',
  version: '3',
};

const COVER_MODE_CONTROLLER = {
  type: 'AlexaInterface',
  interface: 'Alexa.ModeController',
  version: '3',
  instance: 'Cover.Position',
  properties: {
    supported: [{ name: 'mode' }],
    retrievable: false,
    proactivelyReported: false,
    nonControllable: false,
  },
  capabilityResources: {
    friendlyNames: [
      { '@type': 'asset', value: { assetId: 'Alexa.Setting.Opening' } },
    ],
  },
  configuration: {
    ordered: true,
    supportedModes: [
      {
        value: 'Position.Open',
        modeResources: {
          friendlyNames: [
            { '@type': 'asset', value: { assetId: 'Alexa.Value.Open' } },
            { '@type': 'text', value: { text: 'open', locale: 'en-US' } },
          ],
        },
      },
      {
        value: 'Position.Closed',
        modeResources: {
          friendlyNames: [
            { '@type': 'asset', value: { assetId: 'Alexa.Value.Close' } },
            { '@type': 'text', value: { text: 'closed', locale: 'en-US' } },
          ],
        },
      },
    ],
  },
};

function displayCategory(e: ManifestEntry): string {
  if (e.type === 'COVER') return 'OTHER';
  if (e.type === 'SWITCH') return 'SWITCH';
  if (e.type === 'THERMOSTAT') return 'THERMOSTAT';
  if (e.type === 'SCENE_TRIGGER') return 'SCENE_TRIGGER';
  return 'LIGHT';
}

/** Alexa endpoint definition for one manifest entry. Shared by Discovery and proactive reports. */
export function buildEndpoint(e: ManifestEntry): object {
  return {
    endpointId: e.endpointId,
    friendlyName: e.friendlyName,
    description: `Home Assistant ${e.type.toLowerCase()}`,
    manufacturerName: 'Home Assistant',
    displayCategories: [displayCategory(e)],
    capabilities: e.type === 'COVER'
      ? [ALEXA_BASE, COVER_MODE_CONTROLLER]
      : [ALEXA_BASE, ...e.capabilities.map((cap: Capability) => CAPABILITY_DEFINITIONS[cap])],
  };
}

export async function discovery(exposure: ExposureReader): Promise<object> {
  const endpoints: object[] = (await exposure.listEndpoints()).map(buildEndpoint);

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
