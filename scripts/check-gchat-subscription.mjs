#!/usr/bin/env node
// Usage:
//   node /path/to/check-gchat-subscription.mjs                    # LIST
//   node /path/to/check-gchat-subscription.mjs <channelKey>       # LIST + state entry + GET stored id
//   node /path/to/check-gchat-subscription.mjs --get <resource>   # GET arbitrary resource
//     e.g. --get subscriptions/chat-spaces-czpBQVFB...
//          --get operations/ClgK...
//
// Run from the directory containing state.json + config.json
// (typically .clawmini/adapters/google-chat/).

import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const getIdx = args.indexOf('--get');
const explicitGet = getIdx >= 0 ? args[getIdx + 1] : null;
const channelKey = getIdx >= 0 ? null : args[0];
const cwd = process.cwd();

const [stateRaw, configRaw] = await Promise.all([
  fs.readFile(path.join(cwd, 'state.json'), 'utf-8'),
  fs.readFile(path.join(cwd, 'config.json'), 'utf-8'),
]);
const state = JSON.parse(stateRaw);
const config = JSON.parse(configRaw);

const refreshToken = state.oauthTokens?.refresh_token;
if (!refreshToken) {
  console.error('No refresh_token in state.oauthTokens. Cannot mint access token.');
  process.exit(1);
}
if (!config.oauthClientId || !config.oauthClientSecret) {
  console.error('Missing oauthClientId/oauthClientSecret in config.json.');
  process.exit(1);
}

console.log('--- Refreshing access token ---');
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: config.oauthClientId,
    client_secret: config.oauthClientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }).toString(),
});
if (!tokenRes.ok) {
  console.error(`Token refresh failed: HTTP ${tokenRes.status}`);
  console.error(await tokenRes.text());
  process.exit(1);
}
const { access_token: accessToken } = await tokenRes.json();
console.log('OK');

async function getJson(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = body;
  }
  return { status: res.status, body: parsed };
}

console.log('\n--- LIST https://workspaceevents.googleapis.com/v1/subscriptions ---');
// The List endpoint requires a filter scoped to one Workspace app's event
// types. Restrict to chat message-created events.
const listFilter = 'event_types:"google.workspace.chat.message.v1.created"';
const listUrl =
  'https://workspaceevents.googleapis.com/v1/subscriptions?filter=' +
  encodeURIComponent(listFilter);
const listed = await getJson(listUrl);
console.log(`HTTP ${listed.status}`);
console.log(JSON.stringify(listed.body, null, 2));

if (explicitGet) {
  console.log(`\n--- GET https://workspaceevents.googleapis.com/v1/${explicitGet} ---`);
  const r = await getJson(`https://workspaceevents.googleapis.com/v1/${explicitGet}`);
  console.log(`HTTP ${r.status}`);
  console.log(JSON.stringify(r.body, null, 2));
}

if (channelKey) {
  console.log(`\n--- State entry for ${channelKey} ---`);
  const entry = state.channelChatMap?.[channelKey];
  if (!entry) {
    const keys = Object.keys(state.channelChatMap ?? {});
    console.error(`No entry. Available keys (${keys.length}): ${keys.join(', ') || '<none>'}`);
  } else {
    console.log(JSON.stringify(entry, null, 2));
    if (entry.subscriptionId) {
      console.log(
        `\n--- GET https://workspaceevents.googleapis.com/v1/${entry.subscriptionId} ---`
      );
      const r = await getJson(`https://workspaceevents.googleapis.com/v1/${entry.subscriptionId}`);
      console.log(`HTTP ${r.status}`);
      console.log(JSON.stringify(r.body, null, 2));
    }
  }
}
