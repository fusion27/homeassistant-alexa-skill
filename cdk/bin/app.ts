import * as cdk from 'aws-cdk-lib';
import { IotStack } from '../lib/iot-stack';
import { LambdaStack } from '../lib/lambda-stack';
import { CognitoStack } from '../lib/cognito-stack';

const app = new cdk.App();
const env = { account: '690063008832', region: 'us-east-1' };

const certArn = app.node.tryGetContext('certArn');
if (!certArn) {
  throw new Error('Pass --context certArn=<arn> from IoT cert creation');
}

const iotStack = new IotStack(app, 'HaAlexaIotStack', { env, certArn });
const lambdaStack = new LambdaStack(app, 'HaAlexaLambdaStack', {
  env,
  iotEndpoint: iotStack.iotEndpoint,
  topicPrefix: 'home/commands',
});
const cognitoStack = new CognitoStack(app, 'HaAlexaCognitoStack', { env });
