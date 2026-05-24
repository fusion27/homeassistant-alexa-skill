import * as cdk from 'aws-cdk-lib';
import * as iot from 'aws-cdk-lib/aws-iot';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface IotStackProps extends cdk.StackProps {
  certArn: string;
}

export class IotStack extends cdk.Stack {
  public readonly iotEndpoint: string;

  constructor(scope: Construct, id: string, props: IotStackProps) {
    super(scope, id, props);

    const thing = new iot.CfnThing(this, 'NewcombeBridge', {
      thingName: 'newcombe-ha-bridge',
    });

    const policy = new iot.CfnPolicy(this, 'BridgePolicy', {
      policyName: 'newcombe-ha-bridge-policy',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: `arn:aws:iot:us-east-1:${this.account}:client/newcombe-ha-bridge`,
          },
          {
            Effect: 'Allow',
            Action: ['iot:Subscribe'],
            Resource: `arn:aws:iot:us-east-1:${this.account}:topicfilter/home/commands/#`,
          },
          {
            Effect: 'Allow',
            Action: ['iot:Receive'],
            Resource: `arn:aws:iot:us-east-1:${this.account}:topic/home/commands/*`,
          },
          {
            Effect: 'Allow',
            Action: 'iot:Publish',
            Resource: `arn:aws:iot:us-east-1:${this.account}:topic/$aws/things/newcombe-ha-bridge/*`,
          },
        ],
      },
    });

    const policyAttachment = new iot.CfnPolicyPrincipalAttachment(this, 'PolicyAttachment', {
      policyName: policy.policyName!,
      principal: props.certArn,
    });
    policyAttachment.addDependency(policy);

    const thingAttachment = new iot.CfnThingPrincipalAttachment(this, 'ThingAttachment', {
      thingName: thing.thingName!,
      principal: props.certArn,
    });
    thingAttachment.addDependency(thing);

    const endpointResource = new cr.AwsCustomResource(this, 'IotEndpoint', {
      onCreate: {
        service: 'Iot',
        action: 'describeEndpoint',
        parameters: { endpointType: 'iot:Data-ATS' },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('endpointAddress'),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    this.iotEndpoint = endpointResource.getResponseField('endpointAddress');

    new cdk.CfnOutput(this, 'IotEndpointOutput', {
      value: this.iotEndpoint,
      description: 'IoT Core ATS endpoint — use as IOT_ENDPOINT in bridge.env',
    });

    new cdk.CfnOutput(this, 'CertArnOutput', {
      value: props.certArn,
      description: 'IoT certificate ARN',
    });
  }
}
