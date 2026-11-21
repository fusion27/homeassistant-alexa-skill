import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LwaTokens } from './lwa';

/** Where the skill's Event Gateway tokens live between invocations. */
export interface GrantStore {
  get(): Promise<LwaTokens | undefined>;
  put(tokens: LwaTokens): Promise<void>;
}

/** Item key in the Exposure table. IAM limits the Lambdas that write it to this partition. */
export const GRANT_PK = 'GRANT';
// One household, one linked account: a later AcceptGrant replaces the grant.
const GRANT_SK = 'ALEXA';

interface GrantItem extends LwaTokens {
  pk: typeof GRANT_PK;
  sk: typeof GRANT_SK;
  updatedAt: string;
}

export class DynamoGrantStore implements GrantStore {
  private readonly doc: DynamoDBDocumentClient;

  constructor(client: DynamoDBClient, private readonly tableName: string) {
    this.doc = DynamoDBDocumentClient.from(client);
  }

  async get(): Promise<LwaTokens | undefined> {
    const result = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: { pk: GRANT_PK, sk: GRANT_SK } }));
    if (result.Item === undefined) return undefined;
    const item = result.Item as GrantItem;
    return { accessToken: item.accessToken, refreshToken: item.refreshToken, expiresAt: item.expiresAt };
  }

  async put(tokens: LwaTokens): Promise<void> {
    const item: GrantItem = { pk: GRANT_PK, sk: GRANT_SK, ...tokens, updatedAt: new Date().toISOString() };
    await this.doc.send(new PutCommand({ TableName: this.tableName, Item: item }));
  }
}
