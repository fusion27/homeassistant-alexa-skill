import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

/** Skill Messaging credentials from the Alexa console (Build → Permissions → Send Alexa Events). */
export interface SkillMessagingCredentials {
  clientId: string;
  clientSecret: string;
}

export interface CredentialsSource {
  load(): Promise<SkillMessagingCredentials>;
}

/**
 * Reads `skillMessaging` from the SecureString config parameter, once per container.
 * A failed read isn't cached, so the next invocation retries.
 */
export class SsmCredentialsSource implements CredentialsSource {
  private cached: Promise<SkillMessagingCredentials> | undefined;

  constructor(private readonly client: SSMClient, private readonly parameterName: string) {}

  load(): Promise<SkillMessagingCredentials> {
    this.cached ??= this.fetch().catch((err: unknown) => {
      this.cached = undefined;
      throw err;
    });
    return this.cached;
  }

  private async fetch(): Promise<SkillMessagingCredentials> {
    const result = await this.client.send(new GetParameterCommand({ Name: this.parameterName, WithDecryption: true }));
    const config = JSON.parse(result.Parameter?.Value ?? '{}') as { skillMessaging?: Partial<SkillMessagingCredentials> };
    const clientId: string | undefined = config.skillMessaging?.clientId;
    const clientSecret: string | undefined = config.skillMessaging?.clientSecret;
    if (clientId === undefined || clientSecret === undefined) {
      throw new Error(`${this.parameterName} has no skillMessaging.clientId/clientSecret`);
    }
    return { clientId, clientSecret };
  }
}
