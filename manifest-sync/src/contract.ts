/**
 * Exposure manifest contract. Copied from cdk/lambda/src/manifest/schema.ts (types only),
 * the same way HACommand is shared with the bridge. Change both together.
 */
export const ENDPOINT_TYPES = ['LIGHT', 'SWITCH', 'THERMOSTAT', 'SCENE_TRIGGER', 'COVER'] as const;
export type EndpointType = typeof ENDPOINT_TYPES[number];

export const CAPABILITIES = ['PowerController', 'BrightnessController', 'ColorController', 'SceneController'] as const;
export type Capability = typeof CAPABILITIES[number];

export interface ManifestEntry {
  /** Stable Alexa endpoint ID: the HA entity-registry id, which survives entity_id renames. */
  endpointId: string;
  entityId: string;
  friendlyName: string;
  type: EndpointType;
  capabilities: Capability[];
}

export interface ManifestSnapshot {
  version: 1;
  generatedAt: string;
  entries: ManifestEntry[];
}
