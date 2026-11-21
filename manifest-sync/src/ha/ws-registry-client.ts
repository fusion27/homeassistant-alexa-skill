import { HaConnection } from './connection';
import { EntityState, HaRegistryClient, HaRegistrySnapshot, RegistryEntity } from './registry';

interface ListedEntity {
  entity_id: string;
}

interface ExtendedEntity {
  id: string;
  entity_id: string;
  labels: string[];
  aliases: (string | null)[];
  disabled_by: string | null;
}

interface HaState {
  entity_id: string;
  attributes: { friendly_name?: string; supported_color_modes?: string[] };
}

/**
 * Reads the registries over the WebSocket API. `entity_registry/list` omits aliases,
 * so the full entries come from `entity_registry/get_entries`.
 */
export class WsHaRegistryClient implements HaRegistryClient {
  constructor(private readonly url: string, private readonly token: string) {}

  async fetchSnapshot(): Promise<HaRegistrySnapshot> {
    const connection: HaConnection = await HaConnection.open(this.url, this.token);
    try {
      const listed: ListedEntity[] = await connection.call<ListedEntity[]>('config/entity_registry/list');
      const extended: Record<string, ExtendedEntity | null> = await connection.call<Record<string, ExtendedEntity | null>>(
        'config/entity_registry/get_entries',
        { entity_ids: listed.map((e: ListedEntity) => e.entity_id) },
      );
      const states: HaState[] = await connection.call<HaState[]>('get_states');

      const entities: RegistryEntity[] = Object.values(extended)
        .filter((e: ExtendedEntity | null): e is ExtendedEntity => e !== null)
        .map((e: ExtendedEntity): RegistryEntity => ({
          id: e.id,
          entityId: e.entity_id,
          labels: e.labels,
          aliases: e.aliases.filter((a: string | null): a is string => typeof a === 'string' && a.trim() !== ''),
          disabled: e.disabled_by !== null,
        }));

      const stateMap = new Map<string, EntityState>(states.map((s: HaState): [string, EntityState] => [
        s.entity_id,
        { friendlyName: s.attributes.friendly_name, supportedColorModes: s.attributes.supported_color_modes },
      ]));
      return { entities, states: stateMap };
    } finally {
      connection.close();
    }
  }
}
