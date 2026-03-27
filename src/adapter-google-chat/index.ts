#!/usr/bin/env node

import { initGoogleChatConfig, readGoogleChatConfig } from './config.js';
import { getTRPCClient, startGoogleChatIngestion } from './client.js';
import { startDaemonToGoogleChatForwarder } from './forwarder.js';
import { getDriveAuthClient } from './auth.js';

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

  if (
    config.driveUploadEnabled !== false &&
    config.driveOauthClientId &&
    config.driveOauthClientSecret
  ) {
    try {
      console.log('Initializing Google Drive Authentication...');
      await getDriveAuthClient(config);
    } catch (err) {
      console.error('Failed to initialize Google Drive authentication:', err);
      process.exit(1);
    }
  }

  const trpc = getTRPCClient();

  // Start ingestion from Pub/Sub
  startGoogleChatIngestion(config, trpc);
  console.log(`Listening to Pub/Sub subscription: ${config.subscriptionName}`);

  // Start forwarding from daemon to Google Chat API
  startDaemonToGoogleChatForwarder(trpc, config).catch((error) => {
    console.error('Error in daemon-to-google-chat forwarder:', error);
  });
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error('Unhandled error in Google Chat Adapter:', error);
    process.exit(1);
  });
}
