/*! Azion Community kit v1, session handler for Azion Functions | https://community.azion.app */

const AZION_API = 'https://api.azion.com/v4'
const SSO_ME = 'https://sso.azion.com/api/user/me'

// Cookie names are the cross-app session contract. azsid keeps the console name so existing backends that read it keep working.
export const COOKIES = {
  azsid: 'azsid',
  token: 'azc_pt',
  refresh: 'azc_rt',
  mfa: 'azc_mfa',
}

const REFRESH_FALLBACK_TTL = 7 * 24 * 3600
const MFA_TTL = 300
const TOKEN_TTL = 8 * 3600
const AZSID_TTL = 8 * 3600

// Browsers drop cookies above ~4 KB and the MFA step token is a ~5 KB JWT, so long values span numbered cookies.
const CHUNK = 3800
const MAX_CHUNKS = 3

export class UpstreamError extends Error {}

function jwtPayload(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

function jwtTtl(token, fallback) {
  const exp = jwtPayload(token)?.exp
  return typeof exp === 'number' ? Math.max(0, Math.floor(exp - Date.now() / 1000)) : fallback
}

function publicUser(raw = {}) {
  const name = [raw.first_name, raw.last_name].filter(Boolean).join(' ').trim() || raw.name || raw.username || ''
  return { name: name || raw.email || 'Azion user', email: raw.email || '', clientId: raw.client_id || null }
}

export function readCookies(request) {
  const cookies = new Map()
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) cookies.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
  }
  return cookies
}

function readCookie(cookies, name) {
  let value = cookies.get(name) || ''
  for (let i = 1; i < MAX_CHUNKS && cookies.has(`${name}${i}`); i++) value += cookies.get(`${name}${i}`)
  return value || null
}

async function azion(path, { method = 'GET', authorization, body, userAgent } = {}) {
  const headers = { accept: 'application/json', 'user-agent': userAgent }
  if (authorization) headers.authorization = authorization
  if (body) headers['content-type'] = 'application/json'
  let res
  try {
    res = await fetch(AZION_API + path, { method, headers, body: body && JSON.stringify(body) })
  } catch (error) {
    throw new UpstreamError(error.message)
  }
  if (res.status >= 500) throw new UpstreamError(`Azion API ${path} returned ${res.status}`)
  const data = await res.json().catch(() => null)
  // Auth endpoints wrap the payload in { data } while others answer with bare objects.
  return { status: res.status, ok: res.ok, body: data?.data ?? data ?? {} }
}

/**
 * Creates the session handler. cookieDomain (for example ".azion.app") shares the session with every app under that
 * domain, and allowedOrigins lists the origins that may call the auth routes cross-origin with credentials.
 */
export function createCommunityAuth({ prefix = '/api/auth', cookieDomain = '', allowedOrigins = [], userAgent = 'azion-community/1' } = {}) {
  const call = (path, opts = {}) => azion(path, { ...opts, userAgent })

  function cookieLine(name, value, maxAge) {
    const domain = cookieDomain ? `; Domain=${cookieDomain}` : ''
    return `${name}=${value}; Max-Age=${maxAge}; Path=/${domain}; Secure; HttpOnly; SameSite=Lax`
  }

  function setCookie(name, value, maxAge) {
    if (value.length > CHUNK * MAX_CHUNKS) throw new UpstreamError(`Cookie ${name} is too large`)
    const lines = []
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const chunk = value.slice(i * CHUNK, (i + 1) * CHUNK)
      lines.push(cookieLine(i ? `${name}${i}` : name, chunk, chunk ? maxAge : 0))
    }
    return lines
  }

  const clear = (...names) => names.flatMap((name) => setCookie(name, '', 0))
  const others = (keep) => Object.values(COOKIES).filter((name) => name !== keep)

  function corsHeaders(request) {
    const origin = request.headers.get('origin')
    if (!origin || !allowedOrigins.includes(origin)) return {}
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, accept',
      'access-control-max-age': '86400',
      vary: 'Origin',
    }
  }

  function reply(request, body, status = 200, cookies = []) {
    const headers = new Headers({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...corsHeaders(request),
    })
    for (const cookie of cookies) headers.append('set-cookie', cookie)
    return new Response(JSON.stringify(body), { status, headers })
  }

  const fail = (request, status, error, message, cookies) => reply(request, { error, message }, status, cookies)

  async function userByToken(token) {
    const res = await call('/iam/user', { authorization: `Token ${token}` })
    if (res.status === 401 || res.status === 403) return null
    if (!res.ok) throw new UpstreamError(`Azion API /iam/user returned ${res.status}`)
    return publicUser(res.body)
  }

  async function userByAzsid(azsid) {
    let res
    try {
      res = await fetch(SSO_ME, {
        headers: { accept: 'application/json', cookie: `azsid=${azsid}`, referer: 'https://console.azion.com/', 'user-agent': userAgent },
        redirect: 'manual',
      })
    } catch (error) {
      throw new UpstreamError(error.message)
    }
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) return null
    if (!res.ok) throw new UpstreamError(`SSO /api/user/me returned ${res.status}`)
    const body = await res.json().catch(() => ({}))
    return publicUser(body.results || body.data || body)
  }

  // Access JWTs last ~10 minutes, so each function instance reuses them instead of exchanging the refresh token per call.
  const accessCache = new Map()

  async function accessFromRefresh(refresh) {
    const cached = accessCache.get(refresh)
    if (cached && cached.expiresAt > Date.now() / 1000) return cached.access
    accessCache.delete(refresh)
    const res = await call('/account/auth/token', { method: 'POST', authorization: `Bearer ${refresh}`, body: {} })
    const access = res.ok && res.body.access_token ? res.body.access_token : null
    if (access) {
      if (accessCache.size >= 500) accessCache.delete(accessCache.keys().next().value)
      const exp = jwtPayload(access)?.exp
      accessCache.set(refresh, { access, expiresAt: typeof exp === 'number' ? exp - 60 : Date.now() / 1000 + 240 })
    }
    return access
  }

  // Only used on tokens Azion returned over TLS to this function, so the claims are trusted without checking the signature.
  function userFromAccess(access) {
    const user = jwtPayload(access)?.user
    if (!user) throw new UpstreamError('Azion access token has no user claim')
    return publicUser(user)
  }

  /**
   * Resolves the caller's session from its cookies. Returns { method, user, headers } where headers authenticate a call
   * to the Azion API on the user's behalf, or { stale } with the cookie names to clear.
   */
  async function resolve(request) {
    const cookies = readCookies(request)

    const token = readCookie(cookies, COOKIES.token)
    if (token) {
      const user = await userByToken(token)
      return user ? { method: 'token', user, headers: { authorization: `Token ${token}` } } : { stale: [COOKIES.token] }
    }

    const azsid = readCookie(cookies, COOKIES.azsid)
    if (azsid) {
      const user = await userByAzsid(azsid)
      return user ? { method: 'azsid', user, headers: { cookie: `azsid=${azsid}`, referer: 'https://console.azion.com/' } } : { stale: [COOKIES.azsid] }
    }

    const refresh = readCookie(cookies, COOKIES.refresh)
    if (refresh) {
      const access = await accessFromRefresh(refresh)
      return access ? { method: 'password', user: userFromAccess(access), headers: { authorization: `Bearer ${access}` } } : { stale: [COOKIES.refresh] }
    }

    return { stale: [] }
  }

  /** Headers that authenticate an Azion API call as the caller, or null. Unlike resolve, it skips the identity lookup. */
  async function credentials(request) {
    const cookies = readCookies(request)
    const token = readCookie(cookies, COOKIES.token)
    if (token) return { authorization: `Token ${token}` }
    const azsid = readCookie(cookies, COOKIES.azsid)
    if (azsid) return { cookie: `azsid=${azsid}`, referer: 'https://console.azion.com/' }
    const refresh = readCookie(cookies, COOKIES.refresh)
    const access = refresh && (await accessFromRefresh(refresh))
    return access ? { authorization: `Bearer ${access}` } : null
  }

  async function readBody(request) {
    return request.json().catch(() => null)
  }

  function startPasswordSession(request, { access_token: access, refresh_token: refresh } = {}) {
    if (!access || !refresh) throw new UpstreamError('Azion API did not return a token pair')
    return reply(request, { authenticated: true, method: 'password', user: userFromAccess(access) }, 200, [
      ...setCookie(COOKIES.refresh, refresh, jwtTtl(refresh, REFRESH_FALLBACK_TTL)),
      ...clear(...others(COOKIES.refresh)),
    ])
  }

  async function login(request) {
    const body = await readBody(request)
    const email = typeof body?.email === 'string' ? body.email.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!email.includes('@') || !password) return fail(request, 400, 'invalid_request', 'Enter your email and password.')

    const method = await call(`/account/auth/login/method?email=${encodeURIComponent(email)}`).catch(() => null)
    if (method?.ok && method.body.method && method.body.method !== 'login') {
      return fail(request, 409, 'sso_required', 'This account signs in through SSO. Use a Personal token instead.')
    }

    const res = await call('/account/auth/login', { method: 'POST', body: { email, password } })
    if (res.status === 429) return fail(request, 429, 'rate_limited', 'Too many attempts. Wait a moment and try again.')
    if (!res.ok) return fail(request, 401, 'invalid_credentials', 'Invalid email or password.')
    if (!res.body.two_factor_required) return startPasswordSession(request, res.body)

    if (!res.body.has_active_device) {
      return fail(request, 403, 'mfa_setup_required', 'Your account requires MFA. Set up an authenticator in Azion Console first.')
    }
    if (!res.body.access_token) throw new UpstreamError('Azion API did not return an MFA token')
    return reply(request, { authenticated: false, mfaRequired: true }, 200, setCookie(COOKIES.mfa, res.body.access_token, MFA_TTL))
  }

  async function mfa(request) {
    const mfaToken = readCookie(readCookies(request), COOKIES.mfa)
    if (!mfaToken) return fail(request, 401, 'mfa_expired', 'Your sign-in expired. Start again.')

    const body = await readBody(request)
    const code = String(body?.code ?? '').replace(/\s/g, '')
    if (!/^\d{6}$/.test(code)) return fail(request, 400, 'invalid_request', 'Enter the 6-digit code.')

    const res = await call('/account/auth/mfa/totp/verify', { method: 'POST', authorization: `Bearer ${mfaToken}`, body: { code } })
    if (res.status === 429) return fail(request, 429, 'rate_limited', 'Too many attempts. Wait a moment and try again.')
    if (!res.ok) return fail(request, 401, 'invalid_code', 'Invalid or expired code.')
    return startPasswordSession(request, res.body)
  }

  async function token(request) {
    const body = await readBody(request)
    const value = typeof body?.token === 'string' ? body.token.trim() : ''
    if (!/^[\x21-\x7e]{16,512}$/.test(value)) return fail(request, 400, 'invalid_request', 'Enter a valid Personal token.')

    const user = await userByToken(value)
    if (!user) return fail(request, 401, 'invalid_token', 'This Personal token is invalid or expired.')
    return reply(request, { authenticated: true, method: 'token', user }, 200, [
      ...setCookie(COOKIES.token, value, TOKEN_TTL),
      ...clear(...others(COOKIES.token)),
    ])
  }

  async function azsid(request) {
    const body = await readBody(request)
    const value = typeof body?.azsid === 'string' ? body.azsid.trim() : ''
    if (!/^[A-Za-z0-9._~%-]{8,1024}$/.test(value)) return fail(request, 400, 'invalid_request', 'Enter a valid azsid value.')

    const user = await userByAzsid(value)
    if (!user) return fail(request, 401, 'invalid_azsid', 'This azsid is invalid or expired. Sign in to Azion Console again.')
    return reply(request, { authenticated: true, method: 'azsid', user }, 200, [
      ...setCookie(COOKIES.azsid, value, AZSID_TTL),
      ...clear(...others(COOKIES.azsid)),
    ])
  }

  async function session(request) {
    const { method, user, stale } = await resolve(request)
    return user ? reply(request, { authenticated: true, method, user }) : reply(request, { authenticated: false }, 200, clear(...stale))
  }

  async function logout(request) {
    const refresh = readCookie(readCookies(request), COOKIES.refresh)
    if (refresh) {
      accessCache.delete(refresh)
      await call('/account/auth/revoke', { method: 'POST', authorization: `Bearer ${refresh}`, body: {} }).catch((error) =>
        console.error('refresh token revoke failed', error),
      )
    }
    return reply(request, { authenticated: false }, 200, clear(...Object.values(COOKIES)))
  }

  const routes = {
    'POST /login': login,
    'POST /mfa': mfa,
    'POST /token': token,
    'POST /azsid': azsid,
    'POST /logout': logout,
    'GET /session': session,
  }

  /** Handles a request under prefix and returns a Response, or null when the path is not an auth route. */
  async function handle(request) {
    const pathname = new URL(request.url).pathname.replace(/\/+$/, '')
    if (!pathname.startsWith(prefix + '/')) return null
    const sub = pathname.slice(prefix.length)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) })

    const route = routes[`${request.method} ${sub}`]
    if (!route) {
      const known = Object.keys(routes).some((key) => key.endsWith(` ${sub}`))
      return known ? fail(request, 405, 'method_not_allowed', 'Method not allowed.') : fail(request, 404, 'not_found', 'Not found.')
    }

    // A JSON body forces a CORS preflight, so other sites cannot post these forms with the user's cookies.
    if (request.method === 'POST' && !(request.headers.get('content-type') || '').startsWith('application/json')) {
      return fail(request, 415, 'unsupported_media_type', 'Send a JSON body.')
    }

    try {
      return await route(request)
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error
      console.error(error)
      return fail(request, 502, 'upstream_error', 'Azion API is unavailable. Try again in a moment.')
    }
  }

  return { handle, resolve, credentials, prefix }
}

/** Forwards prefix/* to base (Azion API v4 by default) as the signed-in caller, or answers 401 without a session. */
export function createAzionProxy(auth, { prefix = '/api/azion', base = AZION_API } = {}) {
  return async function handle(request) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(prefix + '/')) return null

    const json = (body, status) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

    let creds
    try {
      creds = await auth.credentials(request)
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error
      return json({ error: 'upstream_error', message: 'Azion API is unavailable. Try again in a moment.' }, 502)
    }
    if (!creds) return json({ error: 'unauthenticated', message: 'Sign in to continue.' }, 401)

    const headers = new Headers({ accept: request.headers.get('accept') || 'application/json', ...creds })
    const type = request.headers.get('content-type')
    if (type) headers.set('content-type', type)
    const hasBody = !['GET', 'HEAD'].includes(request.method)

    let upstream
    try {
      upstream = await fetch(base + url.pathname.slice(prefix.length) + url.search, {
        method: request.method,
        headers,
        body: hasBody ? await request.arrayBuffer() : undefined,
      })
    } catch {
      return json({ error: 'upstream_error', message: 'Azion API is unavailable. Try again in a moment.' }, 502)
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' },
    })
  }
}
