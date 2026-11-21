/** The slice of Home Assistant's registries and state the manifest is built from. */
export interface RegistryEntity {
  /** Entity-registry id: stable across entity_id renames. */
  id: string;
  entityId: string;
  labels: string[];
  aliases: string[];
  disabled: boolean;
}

export interface EntityState {
  friendlyName?: string;
  supportedColorModes?: string[];
}

export interface HaRegistrySnapshot {
  entities: RegistryEntity[];
  states: ReadonlyMap<string, EntityState>;
}

export interface HaRegistryClient {
  fetchSnapshot(): Promise<HaRegistrySnapshot>;
}
