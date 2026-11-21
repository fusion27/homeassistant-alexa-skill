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
}

/** Turns Exposure table changes into proactive Alexa discovery events. */
export class ChangeReporter {
  constructor(private readonly gateway: AlexaEventGateway) {}

  async report(records: readonly DynamoDBRecord[]): Promise<ReportResult> {
    const upserted: ManifestEntry[] = records
      .filter((r: DynamoDBRecord) => r.eventName === 'INSERT' || r.eventName === 'MODIFY')
      .flatMap((r: DynamoDBRecord) => {
        const image = r.dynamodb?.NewImage;
        return image === undefined ? [] : [toEntry(unmarshall(image as Record<string, AttributeValue>) as EndpointItem)];
      });
    if (upserted.length > 0) {
      await this.gateway.send(
        { namespace: 'Alexa.Discovery', name: 'AddOrUpdateReport' },
        { endpoints: upserted.map(buildEndpoint) },
      );
    }
    return { addedOrUpdated: upserted.map((e: ManifestEntry) => `${e.entityId} as "${e.friendlyName}"`) };
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
