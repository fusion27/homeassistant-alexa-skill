import { GrantStore } from './grant-store';
import { LwaClient, LwaTokens } from './lwa';

export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

const REFRESH_SKEW_MS = 60_000;

/** Returns the stored access token, refreshing and re-storing it when it's about to expire. */
export class StoredAccessTokenProvider implements AccessTokenProvider {
  constructor(private readonly store: GrantStore, private readonly lwa: LwaClient) {}

  async getAccessToken(): Promise<string> {
    const current: LwaTokens | undefined = await this.store.get();
    if (current === undefined) {
      throw new Error('No Alexa grant stored; relink the skill in the Alexa app to send AcceptGrant');
    }
    if (Date.parse(current.expiresAt) - Date.now() > REFRESH_SKEW_MS) return current.accessToken;

    const refreshed: LwaTokens = await this.lwa.refresh(current.refreshToken);
    await this.store.put(refreshed);
    console.log(JSON.stringify({ msg: 'alexa access token refreshed', expiresAt: refreshed.expiresAt }));
    return refreshed.accessToken;
  }
}
