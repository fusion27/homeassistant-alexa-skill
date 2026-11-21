import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// Bootstrap pointer: the only config values in source. Everything else lives in the parameter.
export const CONFIG_REGION = 'us-east-1';
export const CONFIG_PARAMETER = '/ha-alexa-skill/config';

/**
 * All AWS-side configuration, stored as one SecureString JSON parameter.
 * Only non-sensitive fields may be passed into stacks; secrets are read by Lambdas at runtime.
 */
export interface IotConfig {
  certArn: string;
  commandTopicPrefix: string;
  manifestTopic: string;
}

export interface AlexaConfig {
  skillId: string;
  accountLinkVendorId: string;
}

export interface CognitoConfig {
  domainPrefix: string;
}

/** Sensitive. Never pass into a stack; Lambdas read it from the parameter at runtime. */
export interface SkillMessagingConfig {
  clientId: string;
  clientSecret: string;
}

export interface AppConfig {
  account: string;
  iot: IotConfig;
  alexa: AlexaConfig;
  cognito: CognitoConfig;
  skillMessaging: SkillMessagingConfig;
}

export interface ConfigSource {
  load(): Promise<AppConfig>;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(parent: JsonObject, key: string, path: string): JsonObject {
  const value: unknown = parent[key];
  if (!isObject(value)) throw new Error(`Config: ${path}${key} must be an object`);
  return value;
}

function requireString(parent: JsonObject, key: string, path: string): string {
  const value: unknown = parent[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Config: ${path}${key} must be a non-empty string`);
  }
  return value;
}

export function parseAppConfig(raw: unknown): AppConfig {
  if (!isObject(raw)) throw new Error('Config: root must be a JSON object');
  const iot: JsonObject = requireObject(raw, 'iot', '');
  const alexa: JsonObject = requireObject(raw, 'alexa', '');
  const cognito: JsonObject = requireObject(raw, 'cognito', '');
  const skillMessaging: JsonObject = requireObject(raw, 'skillMessaging', '');
  return {
    account: requireString(raw, 'account', ''),
    iot: {
      certArn: requireString(iot, 'certArn', 'iot.'),
      commandTopicPrefix: requireString(iot, 'commandTopicPrefix', 'iot.'),
      manifestTopic: requireString(iot, 'manifestTopic', 'iot.'),
    },
    alexa: {
      skillId: requireString(alexa, 'skillId', 'alexa.'),
      accountLinkVendorId: requireString(alexa, 'accountLinkVendorId', 'alexa.'),
    },
    cognito: {
      domainPrefix: requireString(cognito, 'domainPrefix', 'cognito.'),
    },
    skillMessaging: {
      clientId: requireString(skillMessaging, 'clientId', 'skillMessaging.'),
      clientSecret: requireString(skillMessaging, 'clientSecret', 'skillMessaging.'),
    },
  };
}

export class SsmConfigSource implements ConfigSource {
  constructor(private readonly client: SSMClient, private readonly parameterName: string) {}

  async load(): Promise<AppConfig> {
    const result = await this.client.send(
      new GetParameterCommand({ Name: this.parameterName, WithDecryption: true }),
    );
    const value: string | undefined = result.Parameter?.Value;
    if (value === undefined) throw new Error(`Config: ${this.parameterName} has no value`);
    return parseAppConfig(JSON.parse(value) as unknown);
  }
}
