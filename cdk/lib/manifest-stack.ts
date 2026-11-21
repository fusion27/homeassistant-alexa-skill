import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as iot from 'aws-cdk-lib/aws-iot';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as eventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { lambdaCode } from './lambda-asset';
import { grantAlexaGrantAccess, grantConfigRead } from './alexa-grant-access';

interface ManifestStackProps extends cdk.StackProps {
  certArn: string;
  manifestTopic: string;
  configParameter: string;
}

const MANIFEST_SYNC_CLIENT_ID = 'newcombe-manifest-sync';

/**
 * Exposure manifest: manifest-sync on Newcombe publishes a full snapshot to IoT,
 * an IoT Rule hands it to manifest-ingest, which reconciles it into the Exposure table.
 * The table's stream feeds change-reporter, which tells Alexa about the changes.
 */
export class ManifestStack extends cdk.Stack {
  public readonly exposure: dynamodb.ITable;

  constructor(scope: Construct, id: string, props: ManifestStackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'Exposure', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });
    this.exposure = table;

    const ingest = new lambda.Function(this, 'ManifestIngest', {
      functionName: 'manifest-ingest',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'manifest/ingest.handler',
      code: lambdaCode(),
      timeout: cdk.Duration.seconds(30),
      environment: { EXPOSURE_TABLE: table.tableName },
      logGroup: new logs.LogGroup(this, 'ManifestIngestLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    table.grantReadWriteData(ingest);

    const rule = new iot.CfnTopicRule(this, 'ManifestPublished', {
      topicRulePayload: {
        sql: `SELECT * FROM '${props.manifestTopic}'`,
        awsIotSqlVersion: '2016-03-23',
        ruleDisabled: false,
        actions: [{ lambda: { functionArn: ingest.functionArn } }],
      },
    });
    ingest.addPermission('IotRuleInvoke', {
      principal: new iam.ServicePrincipal('iot.amazonaws.com'),
      sourceArn: rule.attrArn,
      sourceAccount: this.account,
    });

    // Separate from the bridge's policy so the live command path is never touched by manifest changes.
    const policy = new iot.CfnPolicy(this, 'ManifestSyncPolicy', {
      policyName: MANIFEST_SYNC_CLIENT_ID,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: `arn:aws:iot:${this.region}:${this.account}:client/${MANIFEST_SYNC_CLIENT_ID}`,
          },
          {
            Effect: 'Allow',
            Action: 'iot:Publish',
            Resource: `arn:aws:iot:${this.region}:${this.account}:topic/${props.manifestTopic}`,
          },
        ],
      },
    });
    const attachment = new iot.CfnPolicyPrincipalAttachment(this, 'ManifestSyncPolicyAttachment', {
      policyName: policy.policyName!,
      principal: props.certArn,
    });
    attachment.addDependency(policy);

    const reporter = new lambda.Function(this, 'ChangeReporter', {
      functionName: 'change-reporter',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'alexa/change-reporter.handler',
      code: lambdaCode(),
      timeout: cdk.Duration.seconds(30),
      environment: { EXPOSURE_TABLE: table.tableName, CONFIG_PARAMETER: props.configParameter },
      logGroup: new logs.LogGroup(this, 'ChangeReporterLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    // Refreshing the access token rewrites the grant item.
    grantAlexaGrantAccess(reporter, table);
    grantConfigRead(this, reporter, props.configParameter);
    reporter.addEventSource(new eventSources.DynamoEventSource(table, {
      startingPosition: lambda.StartingPosition.LATEST,
      // One snapshot's writes land within milliseconds; batch them into one report.
      batchSize: 50,
      maxBatchingWindow: cdk.Duration.seconds(2),
      retryAttempts: 3,
      bisectBatchOnError: true,
      filters: [lambda.FilterCriteria.filter({
        eventName: lambda.FilterRule.or('INSERT', 'MODIFY', 'REMOVE'),
        dynamodb: { Keys: { pk: { S: lambda.FilterRule.isEqual('ENDPOINT') } } },
      })],
    }));

    new cdk.CfnOutput(this, 'ExposureTableName', { value: table.tableName });
  }
}
