import {getJson} from '../http';

import {type AccountFlags, toAccountFlags} from './adapters';

export async function fetchAccountFlags(
  signal?: AbortSignal,
): Promise<AccountFlags> {
  return toAccountFlags(await getJson<unknown>('/me', signal));
}
