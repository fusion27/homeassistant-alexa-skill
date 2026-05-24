import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import { execSync } from 'child_process';
import { Construct } from 'constructs';

interface LambdaStackProps extends cdk.StackProps {
  iotEndpoint: string;
  topicPrefix: string;
}

export class LambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    const entityCatalogParam = new ssm.StringParameter(this, 'EntityCatalog', {
      parameterName: '/ha-alexa-skill/entity-catalog',
      description: 'JSON array of HA entities to expose to Alexa',
      stringValue: JSON.stringify([
        {
          entityId: 'light.example',
          friendlyName: 'Example Light',
          type: 'LIGHT',
          capabilities: ['PowerController', 'BrightnessController'],
        },
      ]),
    });

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

    role.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [entityCatalogParam.parameterArn],
    }));

    const fn = new lambda.Function(this, 'AlexaSkillHandler', {
      functionName: 'ha-alexa-skill-handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda'), {
        bundling: {
          local: {
            tryBundle(outputDir: string): boolean {
              const lambdaDir = path.join(__dirname, '../lambda');
              execSync(`cd ${lambdaDir} && npm install && npm run build && npm prune --omit=dev`, { stdio: 'inherit' });
              execSync(`cp -r ${lambdaDir}/dist/. ${outputDir}/`, { stdio: 'inherit' });
              execSync(`cp -r ${lambdaDir}/node_modules ${outputDir}/node_modules`, { stdio: 'inherit' });
              return true;
            },
          },
          image: lambda.Runtime.NODEJS_22_X.bundlingImage,
          command: [
            'bash', '-c',
            'npm ci && npm run build && cp -r dist/* /asset-output/ && cp -r node_modules /asset-output/node_modules',
          ],
        },
      }),
      role,
      timeout: cdk.Duration.seconds(10),
      environment: {
        IOT_ENDPOINT: props.iotEndpoint,
        IOT_TOPIC_PREFIX: props.topicPrefix,
        ENTITY_CATALOG_PARAM: entityCatalogParam.parameterName,
      },
    });

    fn.addPermission('AlexaSmartHomeTrigger', {
      principal: new iam.ServicePrincipal('alexa-connectedhome.amazon.com'),
      action: 'lambda:InvokeFunction',
      eventSourceToken: 'amzn1.ask.skill.081f3588-e829-4c0d-b282-10d0dd9ea168',
    });

    new cdk.CfnOutput(this, 'LambdaArn', {
      value: fn.functionArn,
      description: 'Lambda ARN — paste into Alexa Developer Console as skill endpoint',
    });
  }
}
