import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { lambdaCode } from './lambda-asset';

interface LambdaStackProps extends cdk.StackProps {
  iotEndpoint: string;
  topicPrefix: string;
  skillId: string;
  exposure: dynamodb.ITable;
}

export class LambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    const role = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    role.addToPolicy(new iam.PolicyStatement({
      actions: ['iot:Publish'],
      resources: [`arn:aws:iot:us-east-1:${this.account}:topic/${props.topicPrefix}/*`],
    }));


    const fn = new lambda.Function(this, 'AlexaSkillHandler', {
      functionName: 'ha-alexa-skill-handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambdaCode(),
      role,
      timeout: cdk.Duration.seconds(10),
      environment: {
        IOT_ENDPOINT: props.iotEndpoint,
        IOT_TOPIC_PREFIX: props.topicPrefix,
        EXPOSURE_TABLE: props.exposure.tableName,
      },
    });

    props.exposure.grantReadData(role);

    fn.addPermission('AlexaSmartHomeTrigger', {
      principal: new iam.ServicePrincipal('alexa-connectedhome.amazon.com'),
      action: 'lambda:InvokeFunction',
      eventSourceToken: props.skillId,
    });

    new cdk.CfnOutput(this, 'LambdaArn', {
      value: fn.functionArn,
      description: 'Lambda ARN — paste into Alexa Developer Console as skill endpoint',
    });
  }
}
