import { Capability, EndpointType, ManifestEntry } from '../contract';
import { EntityState, HaRegistrySnapshot, RegistryEntity } from '../ha/registry';

export interface SkippedEntity {
  entityId: string;
  reason: string;
}

export interface BuildResult {
  entries: ManifestEntry[];
  skipped: SkippedEntity[];
}

interface AlexaShape {
  type: EndpointType;
  capabilities: Capability[];
}

/** Maps an HA domain to how Alexa sees it. Add a domain by adding an entry. */
type DomainMapper = (state: EntityState | undefined) => AlexaShape;

const DOMAIN_MAPPERS: Readonly<Record<string, DomainMapper>> = {
  switch: (): AlexaShape => ({ type: 'SWITCH', capabilities: ['PowerController'] }),
};

function spokenName(entity: RegistryEntity, state: EntityState | undefined): string {
  return (entity.aliases[0] ?? state?.friendlyName ?? entity.entityId).trim();
}

/**
 * Pure: an entity is exposed if and only if it is enabled and carries `labelId`.
 * The first alias is the spoken name, falling back to HA's friendly name.
 */
export function buildManifest(registry: HaRegistrySnapshot, labelId: string): BuildResult {
  const entries: ManifestEntry[] = [];
  const skipped: SkippedEntity[] = [];

  for (const entity of registry.entities) {
    if (!entity.labels.includes(labelId)) continue;
    if (entity.disabled) {
      skipped.push({ entityId: entity.entityId, reason: 'disabled' });
      continue;
    }
    const domain: string = entity.entityId.split('.')[0];
    const mapper: DomainMapper | undefined = DOMAIN_MAPPERS[domain];
    if (mapper === undefined) {
      skipped.push({ entityId: entity.entityId, reason: `unsupported domain ${domain}` });
      continue;
    }
    const state: EntityState | undefined = registry.states.get(entity.entityId);
    entries.push({ endpointId: entity.id, entityId: entity.entityId, friendlyName: spokenName(entity, state), ...mapper(state) });
  }

  entries.sort((a: ManifestEntry, b: ManifestEntry) => a.entityId.localeCompare(b.entityId));
  return { entries, skipped };
}
