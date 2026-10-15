import crypto from 'node:crypto';

// "Sign in with Google" using the authorization code flow with PKCE. The server talks to Google
// directly, so the browser never sees a token.
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

const base64url = (buf) => Buffer.from(buf).toString('base64url');

export function pkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  return { verifier, challenge: base64url(crypto.createHash('sha256').update(verifier).digest()) };
}

export function createGoogleAuth({ clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET, fetchImpl = fetch } = {}) {
  return {
    enabled: Boolean(clientId && clientSecret),

    authUrl({ redirectUri, state, challenge }) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return `${AUTH_URL}?${params}`;
    },

    // Exchange the code for the user's Google identity: { sub, email, emailVerified, name }.
    async profile({ code, redirectUri, verifier }) {
      const res = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.id_token) throw new Error(`Google token exchange failed: ${res.status} ${body.error ?? ''}`.trim());
      // The ID token came straight from Google over TLS, so its claims can be read without checking
      // the signature; the audience, issuer and expiry are still checked.
      const claims = JSON.parse(Buffer.from(String(body.id_token).split('.')[1] ?? '', 'base64url').toString('utf8'));
      if (claims.aud !== clientId || !ISSUERS.includes(claims.iss) || !(claims.exp * 1000 > Date.now()) || !claims.sub) {
        throw new Error('Google ID token failed its checks');
      }
      return {
        sub: String(claims.sub),
        email: claims.email ? String(claims.email).toLowerCase() : null,
        emailVerified: claims.email_verified === true || claims.email_verified === 'true',
        name: claims.name ? String(claims.name) : '',
      };
    },
  };
}
