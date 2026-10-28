import {useQuery} from '@tanstack/react-query';

import {retryUnlessClientError} from '../http';

import {type AccountFlags} from './adapters';
import {fetchAccountFlags} from './client';
import {accountKeys} from './keys';

const OFF: AccountFlags = {canSendNote: false};

/**
 * What the account may see. A flag changes by an admin's write, so it is read
 * once an hour. A read that failed or has not answered is off: no row and no
 * error banner (the link is a convenience, never a reason to show a failure).
 */
export function useAccountFlags(): AccountFlags {
  const q = useQuery({
    queryKey: accountKeys.all,
    queryFn: ({signal}) => fetchAccountFlags(signal),
    staleTime: 3_600_000,
    retry: retryUnlessClientError,
  });
  return q.data ?? OFF;
}
