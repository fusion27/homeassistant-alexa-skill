import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

interface CognitoStackProps extends cdk.StackProps {
  accountLinkVendorId: string;
  domainPrefix: string;
}

const ALEXA_LINK_HOSTS: readonly string[] = ['pitangui.amazon.com', 'layla.amazon.com', 'alexa.amazon.co.jp'];

export class CognitoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);

    const userPool = new cognito.UserPool(this, 'AlexaUserPool', {
      userPoolName: 'ha-alexa-skill-users',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const client = userPool.addClient('AlexaClient', {
      userPoolClientName: 'alexa-skill',
      generateSecret: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: ALEXA_LINK_HOSTS.map((host: string): string => `https://${host}/api/skill/link/${props.accountLinkVendorId}`),
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      authFlows: { userPassword: true, userSrp: true },
      // Cognito maximums. Alexa holds the refresh token; a short lifetime silently breaks account linking.
      refreshTokenValidity: cdk.Duration.days(3650),
      accessTokenValidity: cdk.Duration.days(1),
      idTokenValidity: cdk.Duration.days(1),
      authSessionValidity: cdk.Duration.minutes(15),
    });

    const domain = userPool.addDomain('AlexaDomain', {
      cognitoDomain: { domainPrefix: props.domainPrefix },
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'ClientId', { value: client.userPoolClientId });
    new cdk.CfnOutput(this, 'AuthorizationEndpoint', {
      value: `${domain.baseUrl()}/oauth2/authorize`,
      description: 'Paste into Alexa Developer Console → Account Linking → Authorization URI',
    });
    new cdk.CfnOutput(this, 'TokenEndpoint', {
      value: `${domain.baseUrl()}/oauth2/token`,
      description: 'Paste into Alexa Developer Console → Account Linking → Access Token URI',
    });
    new cdk.CfnOutput(this, 'CognitoDomainBase', {
      value: domain.baseUrl(),
    });
  }
}
