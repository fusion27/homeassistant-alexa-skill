import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class CognitoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
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
        callbackUrls: [
          'https://pitangui.amazon.com/api/skill/link/M3OPTMKMOBL62Y',
          'https://layla.amazon.com/api/skill/link/M3OPTMKMOBL62Y',
          'https://alexa.amazon.co.jp/api/skill/link/M3OPTMKMOBL62Y',
        ],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      authFlows: { userPassword: true, userSrp: true },
    });

    const domain = userPool.addDomain('AlexaDomain', {
      cognitoDomain: { domainPrefix: 'ha-alexa-skill-690063008832' },
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
