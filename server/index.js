import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 8787);
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = normalizeNotionId(process.env.NOTION_DATABASE_ID || '');
const NOTION_VERSION = '2025-09-03';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/api/auth/google/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5173';

const FileStore = FileStoreFactory(session);
app.use(express.json());
app.use(session({
  name: 'weekview.sid',
  store: new FileStore({
    path: path.join(__dirname, '..', '.sessions'),
    ttl: 60 * 60 * 24 * 30,
    retries: 0,
    reapInterval: -1
  }),
  secret: SESSION_SECRET || 'development-only-change-this-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

function normalizeNotionId(value) {
  const compact = String(value).replace(/-/g, '');
  const match = compact.match(/[0-9a-fA-F]{32}/);
  return match ? match[0] : '';
}
function sendError(res, error) {
  res.status(error.status || 500).json({ error: error.message || 'Unexpected server error', code: error.code });
}
function googleConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}
function notionConfigured() {
  return Boolean(NOTION_API_KEY && NOTION_DATABASE_ID);
}

async function notionRequest(apiPath, options = {}) {
  if (!NOTION_API_KEY) {
    const error = new Error('Missing NOTION_API_KEY in the server .env file.');
    error.status = 503;
    throw error;
  }
  const response = await fetch(`https://api.notion.com/v1${apiPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `Notion API returned ${response.status}`);
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return body;
}

async function googleTokenRequest(params) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error_description || data.error || 'Google token request failed.');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function getGoogleAccessToken(req) {
  const google = req.session.google;
  if (!google?.refresh_token) {
    const error = new Error('Google is not connected. Please connect Google Calendar.');
    error.status = 401;
    throw error;
  }
  if (google.access_token && google.expires_at && Date.now() < google.expires_at - 60_000) {
    return google.access_token;
  }
  const refreshed = await googleTokenRequest({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: google.refresh_token,
    grant_type: 'refresh_token'
  });
  req.session.google = {
    ...google,
    access_token: refreshed.access_token,
    expires_at: Date.now() + (Number(refreshed.expires_in || 3600) * 1000)
  };
  await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
  return refreshed.access_token;
}

async function googleApi(req, apiPath) {
  const accessToken = await getGoogleAccessToken(req);
  const response = await fetch(`https://www.googleapis.com/calendar/v3${apiPath}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || `Google Calendar API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    notionConfigured: notionConfigured(),
    googleConfigured: googleConfigured()
  });
});

app.get('/api/auth/status', async (req, res) => {
  const connected = Boolean(req.session.google?.refresh_token);
  res.json({ connected, email: req.session.google?.email || null });
});

app.get('/api/auth/google', (req, res) => {
  if (!googleConfigured()) {
    return res.status(503).send('Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.');
  }
  const state = cryptoRandomState();
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    access_type: 'offline',
    include_granted_scopes: 'true',
    state
  });
  if (!req.session.google?.refresh_token) params.set('prompt', 'consent');
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

function cryptoRandomState() {
  return [...crypto.getRandomValues(new Uint8Array(24))].map(x => x.toString(16).padStart(2, '0')).join('');
}
import { webcrypto as crypto } from 'node:crypto';

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    if (req.query.error) throw new Error(`Google sign-in was not completed: ${req.query.error}`);
    if (!req.query.code || !req.query.state || req.query.state !== req.session.oauthState) {
      const error = new Error('Google sign-in could not be verified. Please try again.');
      error.status = 400;
      throw error;
    }
    const tokens = await googleTokenRequest({
      code: String(req.query.code),
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    });
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = profileResponse.ok ? await profileResponse.json() : {};
    req.session.google = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || req.session.google?.refresh_token || null,
      expires_at: Date.now() + (Number(tokens.expires_in || 3600) * 1000),
      email: profile.email || null
    };
    delete req.session.oauthState;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    res.redirect(APP_ORIGIN);
  } catch (error) {
    console.error('Google OAuth callback:', error.message);
    res.redirect(`${APP_ORIGIN}/?googleError=${encodeURIComponent(error.message)}`);
  }
});

app.post('/api/auth/logout', (req, res) => {
  delete req.session.google;
  req.session.save(err => {
    if (err) return res.status(500).json({ error: 'Could not clear the Google session.' });
    res.json({ ok: true });
  });
});

app.get('/api/google/calendars', async (req, res) => {
  try {
    const data = await googleApi(req, '/users/me/calendarList?minAccessRole=reader&maxResults=250');
    res.json({ calendars: (data.items || []).filter(c => c.selected !== false).map(c => ({
      id: c.id, name: c.summary || 'Calendar', color: c.backgroundColor || '#777777',
      primary: Boolean(c.primary), accessRole: c.accessRole
    })) });
  } catch (error) { sendError(res, error); }
});

app.get('/api/google/week', async (req, res) => {
  try {
    const weekStart = new Date(String(req.query.weekStart || ''));
    if (Number.isNaN(weekStart.getTime())) {
      return res.status(400).json({ error: 'A valid weekStart date is required.' });
    }
    const timeMin = new Date(weekStart);
    const timeMax = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const calendars = await googleApi(req, '/users/me/calendarList?minAccessRole=reader&maxResults=250');
    const available = (calendars.items || []).filter(c => c.selected !== false);
    const requested = req.query.calendarIds
      ? (Array.isArray(req.query.calendarIds) ? req.query.calendarIds : [req.query.calendarIds]).map(String)
      : available.map(c => c.id);
    const chosen = available.filter(c => requested.includes(c.id));
    const resultSets = await Promise.all(chosen.map(async calendar => {
      const params = new URLSearchParams({
        timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '250'
      });
      const data = await googleApi(req, `/calendars/${encodeURIComponent(calendar.id)}/events?${params}`);
      return (data.items || []).map(event => ({
        ...event, calendarId: calendar.id, calendarName: calendar.summary || 'Calendar',
        calendarColor: calendar.backgroundColor || '#777777'
      }));
    }));
    res.json({ events: resultSets.flat(), calendars: chosen });
  } catch (error) { sendError(res, error); }
});

app.get('/api/notion/database', async (_req, res) => {
  try {
    if (!NOTION_DATABASE_ID) return res.status(503).json({ error: 'Add NOTION_DATABASE_ID to the server .env file.' });
    const database = await notionRequest(`/databases/${NOTION_DATABASE_ID}`);
    const selected = (database.data_sources || [])[0];
    if (!selected) return res.status(422).json({ error: 'No accessible data source was found in this Notion database.' });
    const schema = await notionRequest(`/data_sources/${selected.id}`);
    res.json({
      databaseId: database.id,
      databaseTitle: (database.title || []).map(x => x.plain_text).join('') || 'Habits',
      dataSourceId: selected.id,
      properties: schema.properties || {}
    });
  } catch (error) { sendError(res, error); }
});

app.get('/api/notion/pages', async (req, res) => {
  try {
    if (!NOTION_DATABASE_ID) return res.status(503).json({ error: 'Add NOTION_DATABASE_ID to the server .env file.' });
    const database = await notionRequest(`/databases/${NOTION_DATABASE_ID}`);
    const sources = database.data_sources || [];
    const source = req.query.dataSourceId ? sources.find(x => x.id === req.query.dataSourceId) : sources[0];
    if (!source) return res.status(404).json({ error: 'Could not find an accessible data source.' });
    const pages = await notionRequest(`/data_sources/${source.id}/query`, {
      method: 'POST', body: JSON.stringify({ page_size: 100, sorts: [{ property: 'Date', direction: 'descending' }] })
    });
    res.json({ results: pages.results || [], hasMore: Boolean(pages.has_more), nextCursor: pages.next_cursor || null });
  } catch (error) { sendError(res, error); }
});

app.listen(PORT, () => console.log(`Weekview server listening on http://localhost:${PORT}`));
