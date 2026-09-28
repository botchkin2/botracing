import {getJson, HttpError} from '../http';

import {type Uploader, type UploadersResponse, toUploader} from './adapters';

export async function fetchUploaders(
  signal?: AbortSignal,
): Promise<Uploader[]> {
  try {
    const body = await getJson<UploadersResponse>('/uploaders', signal);
    return body.items.map(toUploader);
  } catch (e) {
    // Until the endpoint ships (thread 30 #460), 404 means none reported.
    if (e instanceof HttpError && e.status === 404) return [];
    throw e;
  }
}
