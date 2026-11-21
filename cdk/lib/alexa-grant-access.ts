import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

// Must match GRANT_PK in cdk/lambda/src/alexa/grant-store.ts.
const GRANT_PARTITION = 'GRANT';

/**
 * Lets a function read and write the Alexa Event Gateway grant, and nothing else in its partition:
 * dynamodb:LeadingKeys keeps it out of the ENDPOINT items that manifest-ingest owns.
 */
export function grantAlexaGrantAccess(grantee: iam.IGrantable, table: dynamodb.ITable): void {
  grantee.grantPrincipal.addToPrincipalPolicy(new iam.PolicyStatement({
    actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
    resources: [table.tableArn],
    conditions: { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': [GRANT_PARTITION] } },
  }));
}

/**
 * Lets a function decrypt the config parameter, for the Skill Messaging secret.
 * The parameter uses the aws/ssm key, whose key policy already allows Decrypt via SSM within the account.
 */
export function grantConfigRead(scope: Construct, grantee: iam.IGrantable, parameterName: string): void {
  ssm.StringParameter.fromSecureStringParameterAttributes(scope, 'ConfigParameter', { parameterName }).grantRead(grantee);
}
