import axios, {AxiosRequestConfig} from 'axios';
import * as admin from 'firebase-admin';
import {defineSecret} from 'firebase-functions/params';
import {onRequest} from 'firebase-functions/v2/https';
import {
  getAuthStatus,
  handleAuthCallback,
  handleAuthLogin,
  handleAuthLogout,
  handleAuthRefresh,
  resolveAccessToken,
} from './authHandlers';
import {SESSION_COOKIE_NAME} from './oauth';

export {lmuApi} from './lmuApi';

if (!admin.apps.length) {
  admin.initializeApp();
}

const garage61OauthClientId = defineSecret('GARAGE61_OAUTH_CLIENT_ID');
const garage61OauthClientSecret = defineSecret('GARAGE61_OAUTH_CLIENT_SECRET');
const sessionEncryptionKey = defineSecret('SESSION_ENCRYPTION_KEY');

type ReqLike = any;

interface Response {
  set(header: string, value: string): void;
  status(code: number): Response;
  json(data: any): void;
  send(data: any): void;
  end(): void;
}

const AUTH_PREFIX = '/api/garage61/auth/';

function parseCookies(
  cookieHeader: string | undefined,
): Record<string, string> {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((acc, part) => {
    const [key, ...v] = part.trim().split('=');
    if (key && v.length) acc[key] = decodeURIComponent(v.join('=').trim());
    return acc;
  }, {} as Record<string, string>);
}

async function getJsonBody(req: ReqLike): Promise<Record<string, any>> {
  // Cloud Run / v2: body is often in rawBody; prefer parsing it so we get the POST payload
  if (req?.rawBody && req.rawBody.length > 0) {
    try {
      const parsed = JSON.parse(req.rawBody.toString());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // fall through
    }
  }
  if (req?.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  return {};
}

export const garage61Proxy = onRequest(
  {
    secrets: [
      garage61OauthClientId,
      garage61OauthClientSecret,
      sessionEncryptionKey,
    ],
  },
  async (req: ReqLike, res: Response) => {
    // With credentials (cookies), browser requires a specific origin; * is invalid
    const origin = req.headers.origin;
    const allowedOrigins = [
      'https://botracing-61.web.app',
      'https://botracing-61.firebaseapp.com',
      'http://localhost:8080',
      'http://localhost:8081',
      'http://localhost:19006',
    ];
    const allowOrigin =
      origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
    res.set('Access-Control-Allow-Origin', allowOrigin);
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Credentials', 'true');
    // Required when using __session: responses must not be cached across users (Hosting uses __session in cache key)
    res.set('Cache-Control', 'private');

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    // Path: Hosting/Cloud Run may send full URL, path+query, or path only; normalize to pathname
    let path =
      req.path ||
      (typeof req.url === 'string' ? req.url.split('?')[0] : '') ||
      '';
    if (path.startsWith('http://') || path.startsWith('https://')) {
      try {
        path = new URL(path).pathname;
      } catch {
        path = '';
      }
    }
    if (path.startsWith('/auth/') && !path.startsWith('/api/garage61/')) {
      path = '/api/garage61' + path;
    }

    // Health check: if this returns 200, the Hosting rewrite is working
    if (
      (path === '/api/garage61' || path === '/api/garage61/') &&
      req.method === 'GET'
    ) {
      res.status(200).json({ok: true, path, message: 'garage61Proxy reached'});
      return;
    }

    const isAuthRoute =
      path === `${AUTH_PREFIX}login` ||
      path === `${AUTH_PREFIX}callback` ||
      path === `${AUTH_PREFIX}refresh` ||
      path === `${AUTH_PREFIX}logout` ||
      path === `${AUTH_PREFIX}status`;

    if (isAuthRoute) {
      // GET /auth/status: no secrets needed; tells client if they have an OAuth session (cookie)
      if (path === `${AUTH_PREFIX}status` && req.method === 'GET') {
        try {
          const status = await getAuthStatus(req.headers.cookie);
          res.status(200).json(status);
        } catch {
          res.status(200).json({hasSession: false});
        }
        return;
      }

      let clientId: string;
      let clientSecret: string;
      try {
        clientId = garage61OauthClientId.value() ?? '';
        clientSecret = garage61OauthClientSecret.value() ?? '';
      } catch (secretErr: any) {
        console.error(
          'Auth route: secrets unavailable',
          secretErr?.message || secretErr,
        );
        res.status(500).json({
          error: 'OAuth not configured',
          message:
            'Secrets unavailable. Set GARAGE61_OAUTH_CLIENT_ID and GARAGE61_OAUTH_CLIENT_SECRET with firebase functions:secrets:set, then redeploy.',
          detail: secretErr?.message || String(secretErr),
        });
        return;
      }
      if (!clientId || !clientSecret) {
        res.status(500).json({
          error: 'OAuth not configured',
          message:
            'GARAGE61_OAUTH_CLIENT_ID and GARAGE61_OAUTH_CLIENT_SECRET must be set',
        });
        return;
      }

      let encKey: string;
      try {
        encKey = sessionEncryptionKey.value() ?? '';
      } catch (secretErr: any) {
        console.error(
          'Auth route: SESSION_ENCRYPTION_KEY unavailable',
          secretErr?.message || secretErr,
        );
        res.status(500).json({
          error: 'Session encryption not configured',
          message:
            'SESSION_ENCRYPTION_KEY must be set. Run: firebase functions:secrets:set SESSION_ENCRYPTION_KEY',
        });
        return;
      }
      if (!encKey || encKey.length === 0) {
        res.status(500).json({
          error: 'Session encryption not configured',
          message: 'SESSION_ENCRYPTION_KEY must be non-empty',
        });
        return;
      }

      try {
        const cookies = parseCookies(req.headers.cookie);

        if (path === `${AUTH_PREFIX}login` && req.method === 'GET') {
          const redirectUri =
            (Array.isArray(req.query.redirect_uri)
              ? req.query.redirect_uri[0]
              : req.query.redirect_uri) || '';
          const result = await handleAuthLogin(redirectUri, clientId);
          res.status(200).json(result);
          return;
        }

        if (path === `${AUTH_PREFIX}callback` && req.method === 'POST') {
          const body = await getJsonBody(req);
          const result = await handleAuthCallback(
            body,
            clientId,
            clientSecret,
            cookies,
            encKey,
          );
          if (result.setCookie) {
            res.set('Set-Cookie', result.setCookie);
          }
          if (result.redirect) {
            res.status(200).json({success: true, redirect: result.redirect});
          } else if (result.access_token) {
            res.status(200).json({
              access_token: result.access_token,
              refresh_token: result.refresh_token,
              expires_in: result.expires_in,
            });
          } else {
            res.status(200).json({success: true});
          }
          return;
        }

        if (path === `${AUTH_PREFIX}refresh` && req.method === 'POST') {
          const body = await getJsonBody(req);
          const result = await handleAuthRefresh(
            body,
            clientId,
            clientSecret,
            cookies,
            encKey,
          );
          if (result === null) {
            res.status(204).end();
          } else {
            res.status(200).json(result);
          }
          return;
        }

        if (path === `${AUTH_PREFIX}logout` && req.method === 'POST') {
          await handleAuthLogout(cookies);
          res.set(
            'Set-Cookie',
            `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`,
          );
          res.status(204).end();
          return;
        }
      } catch (err: any) {
        if (err?.status) {
          if (err.status === 400) {
            console.warn('Auth callback 400:', err.body || err.message);
          }
          res.status(err.status).json(err.body || {error: err.message});
        } else {
          console.error('Auth error:', err?.message || err, err?.stack);
          res.status(500).json({
            error: 'Auth failed',
            message: err?.message || String(err),
            hint:
              err?.message?.includes('Firestore') || err?.code === 7
                ? 'Ensure Firestore is enabled in Firebase Console (Build → Firestore).'
                : undefined,
          });
        }
        return;
      }
    }

    // Proxy: resolve token then forward to Garage 61 API (OAuth only; no fallback token)
    const apiPath = path.replace(/^\/api\/garage61/, '');
    const targetUrl = `https://garage61.net/api/v1${apiPath}`;

    const cookieHeader = req.headers.cookie ?? req.headers.Cookie;
    console.log('[garage61Proxy] API request', {
      path: apiPath,
      cookiePresent: !!cookieHeader,
      cookieLength: cookieHeader ? String(cookieHeader).length : 0,
      authHeaderPresent: !!(
        req.headers.authorization ?? req.headers.Authorization
      ),
    });

    let clientId: string | undefined;
    let clientSecret: string | undefined;
    let encKey: string | undefined;
    try {
      clientId = garage61OauthClientId.value() || undefined;
      clientSecret = garage61OauthClientSecret.value() || undefined;
      encKey = sessionEncryptionKey.value() ?? undefined;
    } catch {
      clientId = undefined;
      clientSecret = undefined;
      encKey = undefined;
    }
    const token = await resolveAccessToken(
      (req.headers.authorization ?? req.headers.Authorization) as
        | string
        | undefined,
      cookieHeader as string | undefined,
      null, // no fallback: require OAuth (session cookie or Bearer)
      clientId,
      clientSecret,
      encKey,
    );

    if (!token) {
      console.warn('[garage61Proxy] 401 Unauthorized', {
        path: apiPath,
        reason: 'resolveAccessToken returned null',
      });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Sign in with Garage 61 to access this resource.',
      });
      return;
    }

    const axiosConfig: AxiosRequestConfig = {
      method: req.method as any,
      url: targetUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...Object.fromEntries(
          Object.entries(req.headers).filter(
            ([key]) =>
              ![
                'host',
                'connection',
                'keep-alive',
                'proxy-authenticate',
                'proxy-authorization',
                'te',
                'trailers',
                'transfer-encoding',
                'upgrade',
                'authorization',
                'cookie',
              ].includes(key.toLowerCase()),
          ),
        ),
      },
      params: req.query,
      timeout: 30000,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.rawBody && req.rawBody.length) {
        axiosConfig.data = req.rawBody;
      } else if (
        req.body &&
        typeof req.body === 'object' &&
        !Buffer.isBuffer(req.body)
      ) {
        axiosConfig.data = req.body;
      }
    }

    try {
      const response = await axios(axiosConfig);
      const contentType = response.headers['content-type'] || '';
      if (
        contentType.includes('text/csv') ||
        contentType.includes('application/csv')
      ) {
        res.set('Content-Type', contentType);
        res.status(response.status).send(response.data);
      } else {
        res.status(response.status).json(response.data);
      }
    } catch (error: any) {
      if (error.response) {
        res.status(error.response.status).json(error.response.data);
      } else if (error.request) {
        res.status(502).json({
          error: 'Bad Gateway',
          message: 'No response from Garage 61 API',
        });
      } else {
        res
          .status(500)
          .json({error: 'Internal Server Error', message: error.message});
      }
    }
  },
);
