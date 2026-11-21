import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoExposureRepository, ExposureReader, ExposureWriter, sameEntry } from './repository';
import { ManifestEntry, ManifestSnapshot, ParseResult, parseManifestSnapshot } from './schema';

export interface IngestResult {
  put: number;
  deleted: number;
  unchanged: number;
}

/**
 * Makes the table match the snapshot: writes new or changed entries and deletes entries
 * the snapshot no longer contains. Re-publishing the same snapshot is a no-op.
 */
export async function ingestSnapshot(
  snapshot: ManifestSnapshot,
  repository: ExposureReader & ExposureWriter,
): Promise<IngestResult> {
  const existing = new Map<string, ManifestEntry>(
    (await repository.listEndpoints()).map((e: ManifestEntry): [string, ManifestEntry] => [e.endpointId, e]),
  );
  let put = 0;
  for (const entry of snapshot.entries) {
    const current: ManifestEntry | undefined = existing.get(entry.endpointId);
    if (current !== undefined && sameEntry(current, entry)) continue;
    await repository.putEndpoint(entry);
    put += 1;
  }
  const wanted = new Set<string>(snapshot.entries.map((e: ManifestEntry) => e.endpointId));
  let deleted = 0;
  for (const endpointId of existing.keys()) {
    if (wanted.has(endpointId)) continue;
    await repository.deleteEndpoint(endpointId);
    deleted += 1;
  }
  return { put, deleted, unchanged: snapshot.entries.length - put };
}

const repository = new DynamoExposureRepository(new DynamoDBClient({}), process.env.EXPOSURE_TABLE ?? '');

/** IoT Rule target. The event is the snapshot published by manifest-sync. */
export async function handler(event: unknown): Promise<IngestResult> {
  const parsed: ParseResult<ManifestSnapshot> = parseManifestSnapshot(event);
  if (!parsed.ok) {
    console.error(JSON.stringify({ msg: 'manifest rejected', errors: parsed.errors }));
    throw new Error('Invalid manifest snapshot');
  }
  const result: IngestResult = await ingestSnapshot(parsed.value, repository);
  console.log(JSON.stringify({ msg: 'manifest ingested', generatedAt: parsed.value.generatedAt, ...result }));
  return result;
}
