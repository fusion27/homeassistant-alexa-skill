import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Capability, EndpointType, ManifestEntry } from './schema';

/** Read side, used by Discovery and controllers. */
export interface ExposureReader {
  listEndpoints(): Promise<ManifestEntry[]>;
  getEndpoint(endpointId: string): Promise<ManifestEntry | undefined>;
}

/** Write side, used by manifest ingest. */
export interface ExposureWriter {
  putEndpoint(entry: ManifestEntry): Promise<void>;
  deleteEndpoint(endpointId: string): Promise<void>;
}

const ENDPOINT_PK = 'ENDPOINT';

interface EndpointItem {
  pk: typeof ENDPOINT_PK;
  sk: string;
  entityId: string;
  friendlyName: string;
  type: EndpointType;
  capabilities: Capability[];
  updatedAt: string;
}

function toEntry(item: EndpointItem): ManifestEntry {
  return {
    endpointId: item.sk,
    entityId: item.entityId,
    friendlyName: item.friendlyName,
    type: item.type,
    capabilities: item.capabilities,
  };
}

/**
 * Single-table layout: pk=ENDPOINT, sk=<endpointId>. Listing is a Query on the partition, never a Scan.
 */
export class DynamoExposureRepository implements ExposureReader, ExposureWriter {
  private readonly doc: DynamoDBDocumentClient;

  constructor(client: DynamoDBClient, private readonly tableName: string) {
    this.doc = DynamoDBDocumentClient.from(client);
  }

  async listEndpoints(): Promise<ManifestEntry[]> {
    const entries: ManifestEntry[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.doc.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': ENDPOINT_PK },
        ExclusiveStartKey: startKey,
      }));
      for (const item of (page.Items ?? []) as EndpointItem[]) entries.push(toEntry(item));
      startKey = page.LastEvaluatedKey;
    } while (startKey !== undefined);
    return entries;
  }

  async getEndpoint(endpointId: string): Promise<ManifestEntry | undefined> {
    const result = await this.doc.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: ENDPOINT_PK, sk: endpointId },
    }));
    return result.Item === undefined ? undefined : toEntry(result.Item as EndpointItem);
  }

  async putEndpoint(entry: ManifestEntry): Promise<void> {
    const item: EndpointItem = {
      pk: ENDPOINT_PK,
      sk: entry.endpointId,
      entityId: entry.entityId,
      friendlyName: entry.friendlyName,
      type: entry.type,
      capabilities: entry.capabilities,
      updatedAt: new Date().toISOString(),
    };
    await this.doc.send(new PutCommand({ TableName: this.tableName, Item: item }));
  }

  async deleteEndpoint(endpointId: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.tableName, Key: { pk: ENDPOINT_PK, sk: endpointId } }));
  }
}

export function sameEntry(a: ManifestEntry, b: ManifestEntry): boolean {
  return a.endpointId === b.endpointId
    && a.entityId === b.entityId
    && a.friendlyName === b.friendlyName
    && a.type === b.type
    && a.capabilities.length === b.capabilities.length
    && a.capabilities.every((c: Capability, i: number) => c === b.capabilities[i]);
}
