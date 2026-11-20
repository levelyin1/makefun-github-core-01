// Satu proses HTTP yang menyatukan REST, GraphQL, MCP, dan Git smart HTTP.
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {Store, Failure} from './store.ts';
import * as restModule from './rest.ts';
import * as graphqlModule from './graphql.ts';
import * as mcpModule from './mcp.ts';
import * as gitModule from './git.ts';

const rest = restModule.rest;
const graphql = graphqlModule.graphql;
const mcp = mcpModule.mcp;
const git = gitModule.git;

const MAX_BODY = 64 * 1024 * 1024;

type Outcome = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: Buffer;
};

function requestId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

async function collect(req, limit = MAX_BODY) {
  const parts = [];
  let total = 0;
  for await (const part of req) {
    const chunk = Buffer.from(part);
    total += chunk.length;
    if (total > limit) throw new Failure(413, 'Payload too large');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

async function jsonBody(req) {
  const raw = await collect(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Failure(400, 'Malformed JSON');
  }
}

function reply(res, outcome = {}) {
  const extra = outcome.headers || {};
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-GitHub-Request-Id': requestId(),
    ...extra,
  };
  res.writeHead(outcome.status ?? 200, headers);
  if (outcome.raw !== undefined) return res.end(outcome.raw);
  if (outcome.body === undefined) return res.end();
  res.end(JSON.stringify(outcome.body));
}

export function createForge(token) {
  const store = new Store();
  const originOf = (req) => 'http://' + (req.headers.host || '127.0.0.1');
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', originOf(req));
      const path = url.pathname;
      if (path === '/healthz') {
        reply(res, {body: {ok: true, status: 'up'}});
        return;
      }
      if (req.headers.authorization !== 'Bearer ' + token) {
        reply(res, {status: 401, body: {message: 'Unauthorized'}});
        return;
      }
      const method = req.method || 'GET';
      let outcome;
      const gitPath = path.match(/^\/([^/]+)\/([^/]+)\.git(?:\/.*)?$/);
      if (gitPath) {
        const r = store.repo(decodeURIComponent(gitPath[1]), decodeURIComponent(gitPath[2]));
        outcome = git(store, r, method, url, req.headers, await collect(req));
      } else if (path === '/api/graphql') {
        outcome = {body: graphql(store, await jsonBody(req))};
      } else if (path === '/mcp') {
        const rpc = mcp(store, await jsonBody(req));
        outcome = {body: rpc === undefined ? null : rpc};
      } else if (path === '/api/v3' || path.startsWith('/api/v3/')) {
        outcome = rest(store, method, url, await jsonBody(req), originOf(req));
      } else {
        outcome = {status: 404, body: {message: 'Not Found'}};
      }
      reply(res, outcome);
    } catch (err) {
      const status = err instanceof Failure ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      if (status >= 500) console.error(err);
      reply(res, {status, body: {message}});
    }
  });
  return {server, store};
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function lifecycle(env = process.env) {
  const base = env.MAKEFUN_ENV_URL;
  if (!base) throw new Error('MAKEFUN_ENV_URL is required');
  const token = env.MAKEFUN_SHOP_TOKEN || env.MAKEFUN_TOKEN || 'forge-token';
  const deadline = Date.now() + (Number(env.MAKEFUN_LIFECYCLE_TIMEOUT) || 60_000);
  const origin = String(base).replace(/\/+$/, '');
  const {server} = createForge(token);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    let attempt = 0;
    for (;;) {
      if (Date.now() > deadline) throw new Error('registration timed out');
      try {
        const response = await fetch(origin + '/register', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({port}),
        });
        if (!response.ok) throw new Error('register status ' + response.status);
        await response.arrayBuffer();
        break;
      } catch (err) {
        attempt += 1;
        if (Date.now() > deadline) throw err;
        await pause(Math.min(100 * 2 ** Math.min(attempt, 5), 2000));
      }
    }
    let polls = 0;
    for (;;) {
      if (Date.now() > deadline) throw new Error('completion timed out');
      const method = polls % 2 === 0 ? 'PUT' : 'GET';
      polls += 1;
      try {
        const response = await fetch(origin + '/done', {
          method,
          headers: {'Content-Type': 'application/json'},
          body: method === 'PUT' ? JSON.stringify({port}) : undefined,
        });
        if (!response.ok) throw new Error('done status ' + response.status);
        const signal = JSON.parse(await response.text());
        if (signal && signal.done === true) return {port, polls};
      } catch {
        // sementara: jaringan, status, atau JSON rusak tidak mengakhiri sesi; lanjut polling.
      }
      await pause(120);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  lifecycle().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
