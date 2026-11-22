/**
 * Exposure manifest contract: the set of HA entities exposed to Alexa, and how each appears.
 * Copied verbatim in manifest-sync/src/contract.ts. Change both together.
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

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isMember<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function parseEntry(raw: unknown, index: number, errors: string[]): ManifestEntry | undefined {
  const at = `entries[${index}]`;
  if (!isObject(raw)) {
    errors.push(`${at} must be an object`);
    return undefined;
  }
  const { endpointId, entityId, friendlyName, type, capabilities } = raw;
  const before: number = errors.length;
  if (!isNonEmptyString(endpointId)) errors.push(`${at}.endpointId must be a non-empty string`);
  if (!isNonEmptyString(entityId)) errors.push(`${at}.entityId must be a non-empty string`);
  if (!isNonEmptyString(friendlyName)) errors.push(`${at}.friendlyName must be a non-empty string`);
  if (!isMember(ENDPOINT_TYPES, type)) errors.push(`${at}.type must be one of ${ENDPOINT_TYPES.join(', ')}`);
  if (!Array.isArray(capabilities) || !capabilities.every((c: unknown) => isMember(CAPABILITIES, c))) {
    errors.push(`${at}.capabilities must be an array of ${CAPABILITIES.join(', ')}`);
  }
  if (errors.length !== before) return undefined;
  return {
    endpointId: endpointId as string,
    entityId: entityId as string,
    friendlyName: (friendlyName as string).trim(),
    type: type as EndpointType,
    capabilities: capabilities as Capability[],
  };
}

export function parseManifestSnapshot(raw: unknown): ParseResult<ManifestSnapshot> {
  const errors: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['snapshot must be an object'] };
  if (raw.version !== 1) errors.push('version must be 1');
  if (!isNonEmptyString(raw.generatedAt)) errors.push('generatedAt must be a non-empty string');
  if (!Array.isArray(raw.entries)) return { ok: false, errors: [...errors, 'entries must be an array'] };

  const entries: ManifestEntry[] = [];
  const seen = new Set<string>();
  raw.entries.forEach((item: unknown, index: number) => {
    const entry: ManifestEntry | undefined = parseEntry(item, index, errors);
    if (entry === undefined) return;
    if (seen.has(entry.endpointId)) {
      errors.push(`entries[${index}].endpointId ${entry.endpointId} is duplicated`);
      return;
    }
    seen.add(entry.endpointId);
    entries.push(entry);
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { version: 1, generatedAt: raw.generatedAt as string, entries } };
}
