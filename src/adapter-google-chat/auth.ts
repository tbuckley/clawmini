import { google } from 'googleapis';
import http from 'node:http';
import type { GoogleChatConfig } from './config.js';
import { readGoogleChatState, updateGoogleChatState } from './state.js';

let authClient: Awaited<ReturnType<typeof google.auth.getClient>> | null = null;
export async function getAuthClient() {
  if (!authClient) {
    authClient = await google.auth.getClient({
      scopes: ['https://www.googleapis.com/auth/chat.bot'],
    });
  }
  return authClient;
}

const userAuthClients = new Map<string, InstanceType<typeof google.auth.OAuth2>>();
const userAuthPromises = new Map<string, Promise<InstanceType<typeof google.auth.OAuth2>>>();

export async function getUserAuthClient(config: GoogleChatConfig, startDir = process.cwd()) {
  const cached = userAuthClients.get(startDir);
  if (cached) return cached;
  const pending = userAuthPromises.get(startDir);
  if (pending) return pending;

  if (!config.oauthClientId || !config.oauthClientSecret) {
    console.error('DEBUG config:', config);
    throw new Error(
      'oauthClientId and oauthClientSecret are required in config.json for user authentication.'
    );
  }

  const promise = (async () => {
    const oauth2Client = new google.auth.OAuth2(
      config.oauthClientId,
      config.oauthClientSecret,
      'http://localhost:31338/oauth2callback'
    );

    oauth2Client.on('tokens', async (tokens) => {
      try {
        const currentState = await readGoogleChatState(startDir);
        await updateGoogleChatState(
          {
            oauthTokens: {
              ...currentState.oauthTokens,
              ...tokens,
            },
          },
          startDir
        );
      } catch (err) {
        console.error('Failed to save refreshed Google User tokens', err);
      }
    });

    const state = await readGoogleChatState(startDir);
    if (state.oauthTokens) {
      oauth2Client.setCredentials(state.oauthTokens);
      userAuthClients.set(startDir, oauth2Client);
      userAuthPromises.delete(startDir);
      return oauth2Client;
    }

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/chat.messages.readonly',
      ],
      prompt: 'consent',
    });

    console.log('\n======================================================');
    console.log('Google User Authorization Required!');
    console.log('Please visit the following URL to authorize this bot:');
    console.log(authUrl);
    console.log('======================================================\n');

    return new Promise<typeof oauth2Client>((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;

      const server = http.createServer(async (req, res) => {
        if (req.url?.startsWith('/oauth2callback')) {
          const url = new URL(req.url, 'http://localhost:31338');
          const code = url.searchParams.get('code');
          if (code) {
            res.end('Authentication successful! You can close this window.');
            clearTimeout(timeoutId);
            server.close();
            try {
              const { tokens } = await oauth2Client.getToken(code);
              oauth2Client.setCredentials(tokens);

              await updateGoogleChatState({ oauthTokens: tokens }, startDir);

              console.log('Google User authorization successful!');
              userAuthClients.set(startDir, oauth2Client);
              userAuthPromises.delete(startDir);
              resolve(oauth2Client);
            } catch (err) {
              console.error('Failed to get token', err);
              userAuthPromises.delete(startDir);
              reject(err);
            }
          } else {
            res.end('Authentication failed!');
            clearTimeout(timeoutId);
            server.close();
            userAuthPromises.delete(startDir);
            reject(new Error('No code provided in OAuth callback'));
          }
        }
      });

      server.on('error', (err) => {
        console.error('Failed to start local OAuth server on port 31338', err);
        clearTimeout(timeoutId);
        userAuthPromises.delete(startDir);
        reject(err);
      });

      server.listen(31338, '127.0.0.1', () => {
        timeoutId = setTimeout(
          () => {
            server.close();
            userAuthPromises.delete(startDir);
            console.error('Google User authorization timed out after 5 minutes.');
            reject(new Error('Google User authorization timed out.'));
          },
          5 * 60 * 1000
        );
      });
    });
  })();

  userAuthPromises.set(startDir, promise);
  return promise;
}
