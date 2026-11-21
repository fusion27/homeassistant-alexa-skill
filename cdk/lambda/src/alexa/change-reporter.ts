import { DynamoDBClient, AttributeValue } from '@aws-sdk/client-dynamodb';
import { SSMClient } from '@aws-sdk/client-ssm';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';
import { buildEndpoint } from '../discovery';
import { EndpointItem, toEntry } from '../manifest/repository';
import { ManifestEntry } from '../manifest/schema';
import { StoredAccessTokenProvider } from './access-token';
import { SsmCredentialsSource } from './credentials';
import { AlexaEventGateway, HttpAlexaEventGateway } from './event-gateway';
import { DynamoGrantStore } from './grant-store';
import { HttpLwaClient } from './lwa';

export interface ReportResult {
  addedOrUpdated: string[];
  deleted: string[];
}

type FinalState = { kind: 'upsert'; entry: ManifestEntry } | { kind: 'delete'; endpointId: string };

/**
 * Collapses a batch to each endpoint's last change, in stream order, so an unlabel
 * followed by a relabel in one batch ends as an upsert, never a delete.
 */
function finalStates(records: readonly DynamoDBRecord[]): FinalState[] {
  const byEndpoint = new Map<string, FinalState>();
  for (const record of records) {
    const keys = record.dynamodb?.Keys;
    if (keys === undefined) continue;
    const endpointId: string = (unmarshall(keys as Record<string, AttributeValue>) as Pick<EndpointItem, 'sk'>).sk;
    const image = record.dynamodb?.NewImage;
    if (record.eventName === 'REMOVE') {
      byEndpoint.set(endpointId, { kind: 'delete', endpointId });
    } else if (image !== undefined) {
      byEndpoint.set(endpointId, { kind: 'upsert', entry: toEntry(unmarshall(image as Record<string, AttributeValue>) as EndpointItem) });
    }
  }
  return [...byEndpoint.values()];
}

/** Turns Exposure table changes into proactive Alexa discovery events. */
export class ChangeReporter {
  constructor(private readonly gateway: AlexaEventGateway) {}

  async report(records: readonly DynamoDBRecord[]): Promise<ReportResult> {
    const states: FinalState[] = finalStates(records);
    const upserted: ManifestEntry[] = states.flatMap((s: FinalState) => (s.kind === 'upsert' ? [s.entry] : []));
    const deleted: string[] = states.flatMap((s: FinalState) => (s.kind === 'delete' ? [s.endpointId] : []));
    if (upserted.length > 0) {
      await this.gateway.send(
        { namespace: 'Alexa.Discovery', name: 'AddOrUpdateReport' },
        { endpoints: upserted.map(buildEndpoint) },
      );
    }
    if (deleted.length > 0) {
      await this.gateway.send(
        { namespace: 'Alexa.Discovery', name: 'DeleteReport' },
        { endpoints: deleted.map((endpointId: string) => ({ endpointId })) },
      );
    }
    return {
      addedOrUpdated: upserted.map((e: ManifestEntry) => `${e.entityId} as "${e.friendlyName}"`),
      deleted,
    };
  }
}

const tableName: string = process.env.EXPOSURE_TABLE ?? '';
const reporter = new ChangeReporter(new HttpAlexaEventGateway(new StoredAccessTokenProvider(
  new DynamoGrantStore(new DynamoDBClient({}), tableName),
  new HttpLwaClient(new SsmCredentialsSource(new SSMClient({}), process.env.CONFIG_PARAMETER ?? '')),
)));

/** DynamoDB Stream target, filtered to ENDPOINT items. A throw makes the stream retry and bisect the batch. */
export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  const result: ReportResult = await reporter.report(event.Records);
  console.log(JSON.stringify({ msg: 'changes reported', records: event.Records.length, ...result }));
}
