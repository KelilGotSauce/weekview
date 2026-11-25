import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import { MongoClient } from 'mongodb';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NETWORK_EXPANSION } from './network-expansion.js';

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
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DATABASE = process.env.MONGODB_DATABASE || 'weekview';
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5173';
const GOOGLE_CACHE = new Map();
const GOOGLE_IN_FLIGHT = new Map();
const GOOGLE_TOKEN_REFRESHES = new Map();
let mongoClientPromise;
let mongoConnectionDiagnostic = 'connection check has not completed';

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

const FINANCE_INPUT_KEYS = new Set([
  ...['checking','stocks','bitcoin','ethereum','solana','inventory','owed','giftCards','savings','taxes'].map(key => `asset:${key}`),
  ...['rbcMastercard','rbcCardTwo','amex','rbcLoc'].map(key => `credit:${key}`),
  'creditScore',
  ...['TFSA','FHSA','RRSP'].flatMap(account => [`limit:${account}`, `contribution:${account}`])
]);
const NETWORK_ROLES = new Set(['artist','producer','executive','manager','media','organization','other']);
const DEFAULT_NETWORK_GRAPH = {
  nodes: [
    { id:'you', name:'You', type:'person', strength:5 },
    { id:'jeremy-hecht', name:'Jeremy Hecht', type:'person', strength:1 },
    { id:'hiphopdx', name:'HipHopDX', type:'organization', strength:1 },
    { id:'la-leakers', name:'LA Leakers', type:'organization', strength:1 },
    { id:'drake', name:'Drake', type:'person', strength:1 },
    { id:'murda-beatz', name:'Murda Beatz', type:'person', strength:1 },
    { id:'corey-lewin', name:'Corey Lewin', type:'person', strength:1 },
    { id:'one-track-mind', name:'One Track Mind', type:'person', strength:1 },
    { id:'conductor-williams', name:'Conductor Williams', type:'person', strength:1 },
    { id:'drtwrk', name:'DRTWRK (Dirtwork)', type:'person', strength:1 },
    { id:'boi-wanda', name:'Boy Wanda', type:'person', strength:1 },
    { id:'russ', name:'Russ', type:'person', strength:1 },
    { id:'ari-paris', name:'Ari Paris', type:'person', strength:1 },
    { id:'ari-publishing', name:'Ari Paris publishing company (name needed)', type:'organization', strength:1 },
    { id:'brother', name:'My brother', type:'person', strength:1 },
    { id:'boogus', name:'Boogus', type:'person', strength:1 },
    { id:'dilly-got-it-bumpin', name:'Dilly Got It Bumpin', type:'organization', strength:1 },
    { id:'jay-z', name:'Jay-Z', type:'person', strength:1 },
    { id:'boldy-james', name:'Boldy James', type:'person', strength:1 },
    { id:'nicholas-craven', name:'Nicholas Craven', type:'person', strength:1 }
  ],
  edges: [
    { id:'edge-you-jeremy', from:'you', to:'jeremy-hecht', label:'Made a documentary about him', status:'confirmed' },
    { id:'edge-jeremy-hiphopdx', from:'jeremy-hecht', to:'hiphopdx', label:'Works with HipHopDX', status:'confirmed' },
    { id:'edge-jeremy-la-leakers', from:'jeremy-hecht', to:'la-leakers', label:'Your stated bridge through his media work', status:'confirmed' },
    { id:'edge-you-one-track', from:'you', to:'one-track-mind', label:'Worked together for a couple of years', status:'confirmed' },
    { id:'edge-one-track-corey', from:'one-track-mind', to:'corey-lewin', label:'Corey manages One Track Mind', status:'confirmed' },
    { id:'edge-corey-murda', from:'corey-lewin', to:'murda-beatz', label:'Corey manages Murda Beatz', status:'confirmed' },
    { id:'edge-murda-drake', from:'murda-beatz', to:'drake', label:'Produced “Nice for What”', status:'confirmed' },
    { id:'edge-you-conductor', from:'you', to:'conductor-williams', label:'Made a lyrics visualizer for him', status:'confirmed' },
    { id:'edge-conductor-drake', from:'conductor-williams', to:'drake', label:'Produced “8AM in Charlotte”', status:'confirmed' },
    { id:'edge-you-drtwrk', from:'you', to:'drtwrk', label:'Reached out personally; you are cool', status:'confirmed' },
    { id:'edge-drtwrk-drake', from:'drtwrk', to:'drake', label:'Music collaborator', status:'confirmed' },
    { id:'edge-drake-boi-wanda', from:'drake', to:'boi-wanda', label:'Music collaborator mentioned', status:'confirmed' },
    { id:'edge-you-brother', from:'you', to:'brother', label:'Family connection', status:'confirmed' },
    { id:'edge-brother-publisher', from:'brother', to:'ari-publishing', label:'The publisher previously worked with your brother', status:'confirmed' },
    { id:'edge-publisher-ari', from:'ari-publishing', to:'ari-paris', label:'Ari Paris is signed to this publisher', status:'confirmed' },
    { id:'edge-ari-russ', from:'ari-paris', to:'russ', label:'Russ has a song with Ari Paris', status:'confirmed' },
    { id:'edge-you-boogus', from:'you', to:'boogus', label:'Made a reaction video for him', status:'confirmed' },
    { id:'edge-boogus-russ', from:'boogus', to:'russ', label:'Best friend and business manager', status:'confirmed' },
    { id:'edge-you-dilly', from:'you', to:'dilly-got-it-bumpin', label:'Potential direct outreach; smaller audience', status:'potential' },
    { id:'edge-dilly-russ', from:'dilly-got-it-bumpin', to:'russ', label:'Russ has worked with the group', status:'confirmed' },
    { id:'edge-you-nicholas', from:'you', to:'nicholas-craven', label:'Montreal connection', status:'confirmed' },
    { id:'edge-nicholas-boldy', from:'nicholas-craven', to:'boldy-james', label:'Music collaborator', status:'confirmed' },
    { id:'edge-boldy-jayz', from:'boldy-james', to:'jay-z', label:'Linked up musically', status:'confirmed' }
  ]
};
for (const node of DEFAULT_NETWORK_GRAPH.nodes) if (node.id !== 'you') node.strength = null;

const NETWORK_SEED_VERSION = 1;
function mergeNetworkSeed(graph, seed) {
  const nodes = new Map(graph.nodes.map(node => [node.id, { ...node }]));
  for (const node of seed.nodes) {
    const existing = nodes.get(node.id);
    nodes.set(node.id, existing
      ? { ...node, ...existing, role: existing.role && existing.role !== 'other' ? existing.role : node.role }
      : { ...node });
  }
  const edges = new Map(graph.edges.map(edge => [edge.id, edge]));
  for (const edge of seed.edges) if (!edges.has(edge.id)) edges.set(edge.id, edge);
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function validateNetworkGraph(value) {
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || value.nodes.length > 500 || value.edges.length > 1200) {
    const error = new Error('Network graph must contain at most 500 nodes and 1,200 relationships.');
    error.status = 400;
    throw error;
  }
  const nodes = value.nodes.map(node => ({
    id: String(node.id || '').slice(0, 100),
    name: String(node.name || '').trim().slice(0, 120),
    type: node.type === 'organization' ? 'organization' : 'person',
    role: NETWORK_ROLES.has(node.role) ? node.role : (node.type === 'organization' ? 'organization' : 'other'),
    city: String(node.city || '').trim().slice(0, 100),
    instagram: String(node.instagram || '').trim().slice(0, 240),
    email: String(node.email || '').trim().slice(0, 254),
    phone: String(node.phone || '').trim().slice(0, 60),
    imageUrl: (() => {
      const imageUrl=String(node.imageUrl||'').trim().slice(0,1000);
      try { const parsed=new URL(imageUrl); return parsed.protocol==='https:'?parsed.href:''; }
      catch { return ''; }
    })(),
    strength: node.strength === null || node.strength === undefined || node.strength === ''
      ? null
      : Math.min(5, Math.max(1, Math.round(Number(node.strength) || 1)))
  }));
  const ids = new Set(nodes.map(node => node.id));
  if (ids.size !== nodes.length || !ids.has('you') || nodes.some(node => !node.id || !node.name)) {
    const error = new Error('Each network node needs a unique ID and name, including the You node.');
    error.status = 400;
    throw error;
  }
  const edges = value.edges.map(edge => ({
    id: String(edge.id || '').slice(0, 100),
    from: String(edge.from || ''),
    to: String(edge.to || ''),
    label: String(edge.label || '').trim().slice(0, 240),
    status: edge.status === 'potential' ? 'potential' : 'confirmed'
  }));
  const edgeIds = new Set(edges.map(edge => edge.id));
  if (edgeIds.size !== edges.length || edges.some(edge => !edge.id || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || !edge.label)) {
    const error = new Error('Each relationship needs a unique ID, valid endpoints, and a description.');
    error.status = 400;
    throw error;
  }
  return { nodes, edges };
}

async function financeCollection() {
  if (!MONGODB_URI) {
    mongoConnectionDiagnostic = 'MONGODB_URI is not configured';
    const error = new Error('MongoDB Atlas is not configured. Add MONGODB_URI to your local .env file.');
    error.status = 503;
    throw error;
  }
  if (!mongoClientPromise) {
    try {
      const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
      mongoClientPromise = client.connect().catch(error => {
        mongoClientPromise = null;
        const chain = [];
        for (let current = error; current && chain.length < 5; current = current.cause) chain.push(current);
        const codes = chain.map(item => String(item.code || '').toUpperCase());
        const names = chain.map(item => String(item.name || '').toLowerCase());
        const messages = chain.map(item => String(item.message || '').toLowerCase());
        if (codes.some(code => ['18','8000'].includes(code)) || messages.some(message => /authentication failed|bad auth|auth failed/.test(message))) {
          mongoConnectionDiagnostic = 'authentication failed; check the Atlas database user and URL-encoded password';
        } else if (codes.some(code => ['ENOTFOUND','ENODATA','EAI_AGAIN'].includes(code)) || names.some(name => name.includes('mongoparse'))) {
          mongoConnectionDiagnostic = 'DNS or URI format error; check the cluster hostname and URI encoding';
        } else if (messages.some(message => /ip address|not authorized|access list|whitelist|not allowed/.test(message))) {
          mongoConnectionDiagnostic = 'Atlas denied network access; check Network Access and the database user permissions';
        } else if (codes.some(code => ['ETIMEDOUT','ECONNREFUSED','ENETUNREACH'].includes(code)) || names.some(name => name.includes('mongoserverselection'))) {
          mongoConnectionDiagnostic = 'server selection timed out; check the Atlas IP access list, cluster status, and network';
        } else {
          mongoConnectionDiagnostic = 'connection failed; check the Atlas URI, database user, cluster status, and Network Access';
        }
        const safeError = new Error(`Could not connect to MongoDB Atlas: ${mongoConnectionDiagnostic}.`);
        safeError.status = 503;
        throw safeError;
      });
    } catch (error) {
      mongoConnectionDiagnostic = 'invalid or unreadable MongoDB URI format';
      mongoClientPromise = null;
      const safeError = new Error(`Could not connect to MongoDB Atlas: ${mongoConnectionDiagnostic}.`);
      safeError.status = 503;
      throw safeError;
    }
  }
  const client = await mongoClientPromise;
  return client.db(MONGODB_DATABASE).collection('finance_settings');
}

function validateFinanceInputs(inputs) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    const error = new Error('Finance inputs must be an object.');
    error.status = 400;
    throw error;
  }
  const clean = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (!FINANCE_INPUT_KEYS.has(key)) continue;
    if (value === '' || value === null) { clean[key] = ''; continue; }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || (key === 'creditScore' && number > 999)) {
      const error = new Error(`Invalid numeric value for ${key}.`);
      error.status = 400;
      throw error;
    }
    clean[key] = String(number);
  }
  return clean;
}

app.get('/api/finance/inputs', async (_req, res) => {
  try {
    const collection = await financeCollection();
    const saved = await collection.findOne({ _id: 'personal-finance-2026' }, { projection: { inputs: 1 } });
    const inputs = { ...(saved?.inputs || {}) };
    if (inputs['asset:savings'] === undefined) {
      inputs['asset:savings'] = '25';
      await collection.updateOne(
        { _id: 'personal-finance-2026' },
        { $set: { inputs, updatedAt: new Date() } },
        { upsert: true }
      );
    }
    res.json({ inputs, configured: true });
  } catch (error) { sendError(res, error); }
});

app.put('/api/finance/inputs', async (req, res) => {
  try {
    const inputs = validateFinanceInputs(req.body?.inputs);
    const collection = await financeCollection();
    await collection.updateOne(
      { _id: 'personal-finance-2026' },
      { $set: { inputs, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true, updatedAt: new Date().toISOString() });
  } catch (error) { sendError(res, error); }
});

function validateFinanceAnnotations(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('Finance annotations must be an object.');
    error.status = 400;
    throw error;
  }
  for (const key of ['expenseCategories','expenseBudgets','expenseBudgetsByYear','assetAccounts']) {
    if (value[key] !== undefined && (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key]))) {
      const error = new Error(`${key} must be an object.`);
      error.status = 400;
      throw error;
    }
  }
  const expenseCategories = {};
  const expenseBudgets = {};
  const expenseBudgetsByYear = {};
  const assetAccounts = {};
  const assetKeys = new Set(['checking','stocks','bitcoin','ethereum','solana','inventory','owed','giftCards','savings']);
  const cleanBudgetMap = source => {
    const budgets = {};
    for (const [categoryValue, amountValue] of Object.entries(source || {}).slice(0, 500)) {
      const category = String(categoryValue).trim().slice(0, 120);
      if (!category) continue;
      if (amountValue === '' || amountValue === null) { budgets[category] = ''; continue; }
      const amount = Number(amountValue);
      if (!Number.isFinite(amount) || amount < 0) {
        const error = new Error(`Invalid annual budget for ${category}.`);
        error.status = 400;
        throw error;
      }
      budgets[category] = String(amount);
    }
    return budgets;
  };
  for (const [pageId, categoryValue] of Object.entries(value.expenseCategories || {}).slice(0, 5000)) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(pageId)) continue;
    expenseCategories[pageId] = String(categoryValue ?? '').trim().slice(0, 120);
  }
  Object.assign(expenseBudgets, cleanBudgetMap(value.expenseBudgets));
  for (const [yearValue, budgetValues] of Object.entries(value.expenseBudgetsByYear || {}).slice(0, 10)) {
    if (!/^20\d{2}$/.test(yearValue) || Number(yearValue) < 2022 || Number(yearValue) > 2026) continue;
    if (!budgetValues || typeof budgetValues !== 'object' || Array.isArray(budgetValues)) continue;
    expenseBudgetsByYear[yearValue] = cleanBudgetMap(budgetValues);
  }
  for (const [assetKey, accountsValue] of Object.entries(value.assetAccounts || {}).slice(0, 20)) {
    if (!assetKeys.has(assetKey) || !accountsValue || typeof accountsValue !== 'object' || Array.isArray(accountsValue)) continue;
    const accounts = {};
    for (const [accountValue, amountValue] of Object.entries(accountsValue).slice(0, 100)) {
      const account = String(accountValue).trim().slice(0, 100);
      if (!account) continue;
      if (amountValue === '' || amountValue === null) { accounts[account] = ''; continue; }
      const amount = Number(amountValue);
      if (!Number.isFinite(amount) || amount < 0) {
        const error = new Error(`Invalid balance for ${account}.`);
        error.status = 400;
        throw error;
      }
      accounts[account] = String(amount);
    }
    assetAccounts[assetKey] = accounts;
  }
  const taxFormula = String(value.taxFormula ?? 'income * 0.25').trim().slice(0, 120) || 'income * 0.25';
  return { expenseCategories, expenseBudgets, expenseBudgetsByYear, assetAccounts, taxFormula };
}

app.get('/api/finance/annotations', async (_req, res) => {
  try {
    const collection = await financeCollection();
    const saved = await collection.findOne({ _id: 'personal-finance-2026' }, { projection: { annotations: 1 } });
    res.json({ annotations: saved?.annotations || { expenseCategories: {}, expenseBudgets: {}, expenseBudgetsByYear: {}, assetAccounts: {}, taxFormula: 'income * 0.25' } });
  } catch (error) { sendError(res, error); }
});

app.put('/api/finance/annotations', async (req, res) => {
  try {
    const annotations = validateFinanceAnnotations(req.body?.annotations);
    const collection = await financeCollection();
    await collection.updateOne(
      { _id: 'personal-finance-2026' },
      { $set: { annotations, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true, updatedAt: new Date().toISOString() });
  } catch (error) { sendError(res, error); }
});

async function networkCollection() {
  await financeCollection();
  const client = await mongoClientPromise;
  return client.db(MONGODB_DATABASE).collection('network_graphs');
}

app.get('/api/network/graph', async (_req, res) => {
  try {
    const collection = await networkCollection();
    const saved = await collection.findOne({ _id: 'personal-network-v1' }, { projection: { graph: 1, seedVersion: 1 } });
    let graph = saved?.graph || DEFAULT_NETWORK_GRAPH;
    if ((saved?.seedVersion || 0) < NETWORK_SEED_VERSION) {
      graph = mergeNetworkSeed(graph, NETWORK_EXPANSION);
      await collection.updateOne(
        { _id: 'personal-network-v1' },
        { $set: { graph, seedVersion: NETWORK_SEED_VERSION, updatedAt: new Date() } },
        { upsert: true }
      );
    }
    res.json({ graph });
  } catch (error) { sendError(res, error); }
});

app.put('/api/network/graph', async (req, res) => {
  try {
    const graph = validateNetworkGraph(req.body?.graph);
    const collection = await networkCollection();
    await collection.updateOne(
      { _id: 'personal-network-v1' },
      { $set: { graph, seedVersion: NETWORK_SEED_VERSION, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true, updatedAt: new Date().toISOString() });
  } catch (error) { sendError(res, error); }
});

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
  const sessionKey = req.sessionID || req.session?.google?.email || 'anonymous';
  let pending = GOOGLE_TOKEN_REFRESHES.get(sessionKey);
  if (!pending) {
    pending = (async () => {
      const refreshed = await googleTokenRequest({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: google.refresh_token,
        grant_type: 'refresh_token'
      });
      const tokenData = {
        access_token: refreshed.access_token,
        expires_at: Date.now() + (Number(refreshed.expires_in || 3600) * 1000)
      };
      req.session.google = { ...google, ...tokenData };
      await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
      return tokenData;
    })();
    GOOGLE_TOKEN_REFRESHES.set(sessionKey, pending);
  }
  try {
    const tokenData = await pending;
    req.session.google = { ...google, ...tokenData };
    return tokenData.access_token;
  } finally {
    if (GOOGLE_TOKEN_REFRESHES.get(sessionKey) === pending) GOOGLE_TOKEN_REFRESHES.delete(sessionKey);
  }
}

async function googleApi(req, apiPath) {
  const sessionKey = req.sessionID || req.session?.google?.email || 'anonymous';
  const cacheKey = `${sessionKey}:${apiPath}`;
  const cached = GOOGLE_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) GOOGLE_CACHE.delete(cacheKey);
  if (GOOGLE_IN_FLIGHT.has(cacheKey)) return GOOGLE_IN_FLIGHT.get(cacheKey);

  const pending = (async () => {
    const accessToken = await getGoogleAccessToken(req);
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`https://www.googleapis.com/calendar/v3${apiPath}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        const ttlMs = apiPath.includes('/calendarList') ? 5 * 60 * 1000 : 60 * 1000;
        GOOGLE_CACHE.set(cacheKey, { value: body, expiresAt: Date.now() + ttlMs });
        return body;
      }

      const message = body.error?.message || `Google Calendar API returned ${response.status}`;
      const reasons = (body.error?.errors || []).map(error => String(error.reason || '').toLowerCase());
      const isRateLimit = response.status === 429 || (response.status === 403 && (
        reasons.some(reason => ['ratelimitexceeded', 'userratelimitexceeded', 'backenderror'].includes(reason))
        || /rate.?limit|per minute per user/i.test(message)
      ));
      if (!isRateLimit || attempt >= 3) {
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }

      const retryAfter = Number(response.headers.get('retry-after'));
      const retryDelay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : Math.min(500 * (2 ** attempt) + Math.random() * 250, 8000);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  })();
  GOOGLE_IN_FLIGHT.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    GOOGLE_IN_FLIGHT.delete(cacheKey);
    const now = Date.now();
    for (const [key, entry] of GOOGLE_CACHE) if (entry.expiresAt <= now) GOOGLE_CACHE.delete(key);
  }
}

function clearGoogleCacheForSession(sessionId) {
  const prefix = `${sessionId}:`;
  for (const key of GOOGLE_CACHE.keys()) if (key.startsWith(prefix)) GOOGLE_CACHE.delete(key);
}
function clearGoogleEventCacheForSession(sessionId) {
  const prefix = `${sessionId}:`;
  for (const key of GOOGLE_CACHE.keys()) {
    if (key.startsWith(prefix) && key.includes('/events?')) GOOGLE_CACHE.delete(key);
  }
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
  clearGoogleCacheForSession(req.sessionID);
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
    if (req.query.refresh === '1') clearGoogleEventCacheForSession(req.sessionID);
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

async function resolveFinanceDatabase(databaseId, viewId) {
  const candidateIds = [databaseId];
  if (viewId && viewId !== databaseId) candidateIds.push(viewId);
  let originalError;
  for (const candidateId of candidateIds) {
    try {
      const database = await notionRequest(`/databases/${candidateId}`);
      const source = (database.data_sources || [])[0];
      const schema = source ? await notionRequest(`/data_sources/${source.id}`) : database;
      return { database, source, schema };
    } catch (error) {
      originalError ||= error;
    }
  }

  try {
    const page = await notionRequest(`/pages/${databaseId}`);
    const parentDatabaseId = page.parent?.database_id || page.parent?.data_source_id;
    if (!parentDatabaseId) {
      const error = new Error('The supplied Notion page is accessible, but it is not inside a database.');
      error.status = 422;
      throw error;
    }
    const database = await notionRequest(`/databases/${parentDatabaseId}`);
    const source = (database.data_sources || [])[0];
    const schema = source ? await notionRequest(`/data_sources/${source.id}`) : database;
    return { database, source, schema };
  } catch (pageError) {
    throw originalError || pageError;
  }
}

function financeDatabaseSummary({ database, source, schema }) {
  const properties = schema.properties || {};
  return {
    databaseId: database.id,
    databaseTitle: (database.title || []).map(part => part.plain_text).join('') || 'Master transactions',
    dataSourceId: source?.id || null,
    propertyCount: Object.keys(properties).length,
    properties: Object.entries(properties).map(([name, property]) => ({
      name,
      type: property.type,
      options: property.type === 'select' ? (property.select?.options || []).map(option => option.name)
        : property.type === 'status' ? (property.status?.options || []).map(option => option.name) : []
    }))
  };
}

app.get('/api/notion/finance/database', async (req, res) => {
  const databaseId = normalizeNotionId(String(req.query.databaseId || ''));
  const viewId = normalizeNotionId(String(req.query.viewId || ''));
  if (!databaseId) return res.status(400).json({ error: 'A valid Notion database ID is required.' });
  try {
    const resolved = await resolveFinanceDatabase(databaseId, viewId);
    res.json(financeDatabaseSummary(resolved));
  } catch (error) { sendError(res, error); }
});

app.get('/api/notion/finance/pages', async (req, res) => {
  const databaseId = normalizeNotionId(String(req.query.databaseId || ''));
  const viewId = normalizeNotionId(String(req.query.viewId || ''));
  if (!databaseId) return res.status(400).json({ error: 'A valid Notion database ID is required.' });
  try {
    const resolved = await resolveFinanceDatabase(databaseId, viewId);
    if (!resolved.source?.id) return res.status(422).json({ error: 'No accessible data source was found in the selected finance database.' });
    const sortableProperty = Object.entries(resolved.schema.properties || {}).find(([, property]) => property.type === 'date')?.[0]
      || Object.entries(resolved.schema.properties || {}).find(([, property]) => property.type === 'title')?.[0];
    const results = [];
    const seenCursors = new Set();
    let cursor = null;
    while (true) {
      const page = await notionRequest(`/data_sources/${resolved.source.id}/query`, {
        method: 'POST', body: JSON.stringify({
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
          ...(sortableProperty ? { sorts: [{ property: sortableProperty, direction: 'descending' }] } : {})
        })
      });
      results.push(...(page.results || []));
      const nextCursor = page.has_more ? page.next_cursor : null;
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    res.json({ results, total: results.length });
  } catch (error) { sendError(res, error); }
});

app.get('/api/notion/pages', async (req, res) => {
  try {
    if (!NOTION_DATABASE_ID) return res.status(503).json({ error: 'Add NOTION_DATABASE_ID to the server .env file.' });
    const database = await notionRequest(`/databases/${NOTION_DATABASE_ID}`);
    const sources = database.data_sources || [];
    const source = req.query.dataSourceId ? sources.find(x => x.id === req.query.dataSourceId) : sources[0];
    if (!source) return res.status(404).json({ error: 'Could not find an accessible data source.' });
    const schema = await notionRequest(`/data_sources/${source.id}`);
    const sortableProperty = Object.entries(schema.properties || {}).find(([, property]) => property.type === 'date')?.[0]
      || Object.entries(schema.properties || {}).find(([, property]) => property.type === 'title')?.[0];
    const results = [];
    const seenCursors = new Set();
    let cursor = null;
    while (true) {
      const page = await notionRequest(`/data_sources/${source.id}/query`, {
        method: 'POST', body: JSON.stringify({
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
          ...(sortableProperty ? { sorts: [{ property: sortableProperty, direction: 'descending' }] } : {})
        })
      });
      results.push(...(page.results || []));
      const nextCursor = page.has_more ? page.next_cursor : null;
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    res.json({ results, hasMore: false, nextCursor: null, total: results.length });
  } catch (error) { sendError(res, error); }
});

app.listen(PORT, () => {
  console.log(`Weekview server listening on http://localhost:${PORT}`);
  void financeCollection()
    .then(() => console.log('[Weekview] MongoDB Atlas connection: YES'))
    .catch(() => console.log(`[Weekview] MongoDB Atlas connection: NO (${mongoConnectionDiagnostic})`));
});
