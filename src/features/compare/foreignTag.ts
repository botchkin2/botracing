import {formatDay} from '@/src/design';

const SESSION_WORD = {R: 'Race', Q: 'Qualifying', P: 'Practice'} as const;

/**
 * Names the session a lap of another session is from: "25 Sep Race". The type
 * is in it because a practice and a race on one day are two sessions with the
 * same L12.
 */
export function foreignTag(
  startedAt: string,
  sessionType: keyof typeof SESSION_WORD,
): string {
  return [formatDay(startedAt), SESSION_WORD[sessionType]]
    .filter(Boolean)
    .join(' ');
}
