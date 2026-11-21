import { v4 as uuidv4 } from 'uuid';
import { AccessTokenProvider } from './access-token';

// North America Event Gateway, matching the skill's NA region and the pitangui account-link host.
const EVENT_GATEWAY_URL = 'https://api.amazonalexa.com/v3/events';

export interface EventName {
  namespace: string;
  name: string;
}

/** Sends one proactive event to Alexa. The gateway adds the envelope and the auth scope. */
export interface AlexaEventGateway {
  send(name: EventName, payload: Record<string, unknown>): Promise<void>;
}

export class HttpAlexaEventGateway implements AlexaEventGateway {
  constructor(private readonly tokens: AccessTokenProvider) {}

  async send(name: EventName, payload: Record<string, unknown>): Promise<void> {
    const token: string = await this.tokens.getAccessToken();
    const messageId: string = uuidv4();
    const response = await fetch(EVENT_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        event: {
          header: { ...name, messageId, payloadVersion: '3' },
          payload: { ...payload, scope: { type: 'BearerToken', token } },
        },
      }),
    });
    if (response.status !== 202) {
      throw new Error(`Event Gateway rejected ${name.name} ${messageId} (${response.status}): ${await response.text()}`);
    }
    console.log(JSON.stringify({ msg: 'alexa event accepted', event: name.name, messageId }));
  }
}
