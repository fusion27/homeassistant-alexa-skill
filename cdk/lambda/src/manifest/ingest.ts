import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoExposureRepository, ExposureReader, ExposureWriter, sameEntry } from './repository';
import { ManifestEntry, ManifestSnapshot, ParseResult, parseManifestSnapshot } from './schema';

export interface IngestResult {
  put: number;
  unchanged: number;
}

/** Writes new or changed entries only, so re-publishing the same snapshot is a no-op. */
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
  return { put, unchanged: snapshot.entries.length - put };
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
