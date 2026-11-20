import * as cdk from 'aws-cdk-lib';
import { SSMClient } from '@aws-sdk/client-ssm';
import { IotStack } from '../lib/iot-stack';
import { LambdaStack } from '../lib/lambda-stack';
import { CognitoStack } from '../lib/cognito-stack';
import { AppConfig, CONFIG_PARAMETER, CONFIG_REGION, SsmConfigSource } from '../lib/config';

async function main(): Promise<void> {
  const config: AppConfig = await new SsmConfigSource(new SSMClient({ region: CONFIG_REGION }), CONFIG_PARAMETER).load();

  const app = new cdk.App();
  const env: cdk.Environment = { account: config.account, region: CONFIG_REGION };

  const iotStack = new IotStack(app, 'HaAlexaIotStack', { env, certArn: config.iot.certArn });
  new LambdaStack(app, 'HaAlexaLambdaStack', {
    env,
    iotEndpoint: iotStack.iotEndpoint,
    topicPrefix: config.iot.commandTopicPrefix,
    skillId: config.alexa.skillId,
  });
  new CognitoStack(app, 'HaAlexaCognitoStack', {
    env,
    accountLinkVendorId: config.alexa.accountLinkVendorId,
    domainPrefix: config.cognito.domainPrefix,
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
