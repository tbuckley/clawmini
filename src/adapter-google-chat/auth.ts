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
let driveAuthPromise: Promise<InstanceType<typeof google.auth.OAuth2>> | null = null;

export async function getDriveAuthClient(config: GoogleChatConfig) {
  if (driveAuthClient) return driveAuthClient;
  if (driveAuthPromise) return driveAuthPromise;

  if (!config.driveOauthClientId || !config.driveOauthClientSecret) {
    throw new Error(
      'driveOauthClientId and driveOauthClientSecret are required in config.json for Drive uploads.'
    );
  }

  driveAuthPromise = (async () => {
    const oauth2Client = new google.auth.OAuth2(
      config.driveOauthClientId,
      config.driveOauthClientSecret,
      'http://localhost:31337/oauth2callback'
    );

    oauth2Client.on('tokens', async (tokens) => {
      try {
        const currentState = await readGoogleChatState();
        currentState.driveOauthTokens = {
          ...currentState.driveOauthTokens,
          ...tokens,
        };
        await writeGoogleChatState(currentState);
      } catch (err) {
        console.error('Failed to save refreshed Google Drive tokens', err);
      }
    });

    const state = await readGoogleChatState();
    if (state.driveOauthTokens) {
      oauth2Client.setCredentials(state.driveOauthTokens);
      driveAuthClient = oauth2Client;
      driveAuthPromise = null;
      return oauth2Client;
    }

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/drive.file'],
    });

    console.log('\n======================================================');
    console.log('Google Drive Authorization Required!');
    console.log('Please visit the following URL to authorize this bot:');
    console.log(authUrl);
    console.log('======================================================\n');

    return new Promise<typeof oauth2Client>((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;

      const server = http.createServer(async (req, res) => {
        if (req.url?.startsWith('/oauth2callback')) {
          const url = new URL(req.url, 'http://localhost:31337');
          const code = url.searchParams.get('code');
          if (code) {
            res.end('Authentication successful! You can close this window.');
            clearTimeout(timeoutId);
            server.close();
            try {
              const { tokens } = await oauth2Client.getToken(code);
              oauth2Client.setCredentials(tokens);

              const currentState = await readGoogleChatState();
              currentState.driveOauthTokens = tokens;
              await writeGoogleChatState(currentState);

              console.log('Google Drive authorization successful!');
              driveAuthClient = oauth2Client;
              driveAuthPromise = null;
              resolve(oauth2Client);
            } catch (err) {
              console.error('Failed to get token', err);
              driveAuthPromise = null;
              reject(err);
            }
          } else {
            res.end('Authentication failed!');
            clearTimeout(timeoutId);
            server.close();
            driveAuthPromise = null;
            reject(new Error('No code provided in OAuth callback'));
          }
        }
      });

      server.on('error', (err) => {
        console.error('Failed to start local OAuth server on port 31337', err);
        clearTimeout(timeoutId);
        driveAuthPromise = null;
        reject(err);
      });

      server.listen(31337, '127.0.0.1', () => {
        timeoutId = setTimeout(
          () => {
            server.close();
            driveAuthPromise = null;
            console.error('Google Drive authorization timed out after 5 minutes.');
            reject(new Error('Google Drive authorization timed out.'));
          },
          5 * 60 * 1000
        );
      });
    });
  })();

  return driveAuthPromise;
}
