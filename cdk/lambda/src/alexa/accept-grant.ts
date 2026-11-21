import { v4 as uuidv4 } from 'uuid';
import { GrantStore } from './grant-store';
import { LwaClient, LwaTokens } from './lwa';

interface AcceptGrantDirective {
  directive?: {
    header?: { messageId?: string };
    payload?: { grant?: { type?: string; code?: string } };
  };
}

function response(name: string, payload: Record<string, string>): object {
  return {
    event: {
      header: { namespace: 'Alexa.Authorization', name, messageId: uuidv4(), payloadVersion: '3' },
      payload,
    },
  };
}

/**
 * Alexa sends AcceptGrant when the skill is linked (or relinked) with Send Alexa Events enabled.
 * Exchanging its code is the only way to get the tokens the Event Gateway needs.
 */
export async function acceptGrant(event: AcceptGrantDirective, lwa: LwaClient, store: GrantStore): Promise<object> {
  const code: string | undefined = event.directive?.payload?.grant?.code;
  if (code === undefined || code === '') {
    return response('ErrorResponse', { type: 'ACCEPT_GRANT_FAILED', message: 'AcceptGrant carried no authorization code' });
  }
  try {
    const tokens: LwaTokens = await lwa.exchangeCode(code);
    await store.put(tokens);
    console.log(JSON.stringify({ msg: 'alexa grant stored', expiresAt: tokens.expiresAt }));
    return response('AcceptGrant.Response', {});
  } catch (err: unknown) {
    const message: string = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ msg: 'accept grant failed', error: message }));
    return response('ErrorResponse', { type: 'ACCEPT_GRANT_FAILED', message: 'Could not exchange the grant code' });
  }
}
