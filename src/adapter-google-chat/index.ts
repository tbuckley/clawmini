#!/usr/bin/env node

import { initGoogleChatConfig, readGoogleChatConfig } from './config.js';
import { readGoogleChatState } from './state.js';
import { getTRPCClient, startGoogleChatIngestion } from './client.js';
import { startDaemonToGoogleChatForwarder } from './forwarder.js';
import { getUserAuthClient } from './auth.js';
import type { FilteringConfig } from '../shared/adapters/filtering.js';

export async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'init') {
    await initGoogleChatConfig();
    return;
  }

  console.log('Google Chat Adapter starting...');

  const config = await readGoogleChatConfig();
  if (!config) {
    console.error(
      'Failed to load Google Chat configuration. Please ensure .clawmini/adapters/google-chat/config.json exists and is valid.'
    );
    process.exit(1);
  }

  if (config.oauthClientId && config.oauthClientSecret) {
    try {
      console.log('Initializing Google User Authentication...');
      await getUserAuthClient(config);
    } catch (err) {
      console.error('Failed to initialize Google User authentication:', err);
      process.exit(1);
    }
  }

  const trpc = getTRPCClient();
  const state = await readGoogleChatState();
  const filteringConfig: FilteringConfig = { filters: state.filters };

  // Start ingestion from Pub/Sub
  startGoogleChatIngestion(config, trpc, filteringConfig);
  console.log(`Listening to Pub/Sub subscription: ${config.subscriptionName}`);

  // Start forwarding from daemon to Google Chat API
  startDaemonToGoogleChatForwarder(trpc, config, filteringConfig).catch((error) => {
    console.error('Error in daemon-to-google-chat forwarder:', error);
  });
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error('Unhandled error in Google Chat Adapter:', error);
    process.exit(1);
  });
}
