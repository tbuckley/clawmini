import { google } from 'googleapis';
import http from 'node:http';
import type { GoogleChatConfig } from './config.js';
import { readGoogleChatState, writeGoogleChatState } from './state.js';

let authClient: Awaited<ReturnType<typeof google.auth.getClient>> | null = null;
export async function getAuthClient() {
  if (!authClient) {
    authClient = await google.auth.getClient({
      scopes: ['https://www.googleapis.com/auth/chat.bot'],
    });
  }
  return authClient;
}

let driveAuthClient: InstanceType<typeof google.auth.OAuth2> | null = null;
export async function getDriveAuthClient(config: GoogleChatConfig) {
  if (driveAuthClient) return driveAuthClient;
  if (!config.driveOauthClientId || !config.driveOauthClientSecret) {
    throw new Error(
      'driveOauthClientId and driveOauthClientSecret are required in config.json for Drive uploads.'
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    config.driveOauthClientId,
    config.driveOauthClientSecret,
    'http://localhost:31337/oauth2callback'
  );

  const state = await readGoogleChatState();
  if (state.driveOauthTokens) {
    oauth2Client.setCredentials(state.driveOauthTokens);
    driveAuthClient = oauth2Client;
    return oauth2Client;
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive'],
  });

  console.log('\n======================================================');
  console.log('Google Drive Authorization Required!');
  console.log('Please visit the following URL to authorize this bot:');
  console.log(authUrl);
  console.log('======================================================\n');

  return new Promise<typeof oauth2Client>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.url?.startsWith('/oauth2callback')) {
        const url = new URL(req.url, 'http://localhost:31337');
        const code = url.searchParams.get('code');
        if (code) {
          res.end('Authentication successful! You can close this window.');
          server.close();
          try {
            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);

            const currentState = await readGoogleChatState();
            currentState.driveOauthTokens = tokens;
            await writeGoogleChatState(currentState);

            console.log('Google Drive authorization successful!');
            driveAuthClient = oauth2Client;
            resolve(oauth2Client);
          } catch (err) {
            console.error('Failed to get token', err);
            reject(err);
          }
        } else {
          res.end('Authentication failed!');
          reject(new Error('No code provided in OAuth callback'));
        }
      }
    });
    server.on('error', (err) => {
      console.error('Failed to start local OAuth server on port 31337', err);
      reject(err);
    });
    server.listen(31337);
  });
}
