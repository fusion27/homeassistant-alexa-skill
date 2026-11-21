import { CredentialsSource, SkillMessagingCredentials } from './credentials';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/** Login with Amazon tokens that let the skill send events to the Alexa Event Gateway. */
export interface LwaTokens {
  accessToken: string;
  refreshToken: string;
  /** ISO-8601 instant the access token stops working. */
  expiresAt: string;
}

export interface LwaClient {
  /** Exchanges the AcceptGrant authorization code. */
  exchangeCode(code: string): Promise<LwaTokens>;
  refresh(refreshToken: string): Promise<LwaTokens>;
}

interface LwaTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export class HttpLwaClient implements LwaClient {
  constructor(private readonly credentials: CredentialsSource) {}

  exchangeCode(code: string): Promise<LwaTokens> {
    return this.request({ grant_type: 'authorization_code', code }, undefined);
  }

  refresh(refreshToken: string): Promise<LwaTokens> {
    return this.request({ grant_type: 'refresh_token', refresh_token: refreshToken }, refreshToken);
  }

  private async request(params: Record<string, string>, currentRefreshToken: string | undefined): Promise<LwaTokens> {
    const credentials: SkillMessagingCredentials = await this.credentials.load();
    const response = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({
        ...params,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }).toString(),
    });
    const body = (await response.json()) as LwaTokenResponse;
    if (!response.ok || body.access_token === undefined || body.expires_in === undefined) {
      // Never include the body's tokens in the error; only LWA's error code and description.
      throw new Error(`LWA ${params.grant_type} failed (${response.status}): ${body.error ?? 'unknown'} ${body.error_description ?? ''}`.trim());
    }
    const refreshToken: string | undefined = body.refresh_token ?? currentRefreshToken;
    if (refreshToken === undefined) throw new Error('LWA returned no refresh token');
    return {
      accessToken: body.access_token,
      refreshToken,
      expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
    };
  }
}
