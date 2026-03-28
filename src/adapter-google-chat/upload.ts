import { google } from 'googleapis';
import path from 'node:path';
import fs from 'node:fs';
import mime from 'mime-types';
import type { GoogleChatConfig } from './config.js';
import { getDriveAuthClient } from './auth.js';
import { getWorkspaceRoot } from '../shared/workspace.js';

export async function uploadFilesToDrive(
  files: string[],
  config: GoogleChatConfig
): Promise<string[]> {
  const driveClient = await getDriveAuthClient(config);
  const driveApi = google.drive({ version: 'v3', auth: driveClient });
  const workspaceRoot = getWorkspaceRoot(process.cwd());

  let folderId: string | undefined;
  try {
    const queryRes = await driveApi.files.list({
      q: "mimeType='application/vnd.google-apps.folder' and name='Clawmini Uploads' and trashed=false",
      fields: 'files(id)',
    });
    if (queryRes.data.files && queryRes.data.files.length > 0) {
      folderId = queryRes.data.files[0]!.id!;
    } else {
      const folderRes = await driveApi.files.create({
        requestBody: {
          name: 'Clawmini Uploads',
          mimeType: 'application/vnd.google-apps.folder',
        },
        fields: 'id',
      });
      if (folderRes.data.id) {
        folderId = folderRes.data.id;
      }
    }
  } catch (err) {
    console.error('Failed to create or find Clawmini Uploads folder', err);
  }

  const uploadPromises = files.map(async (fileRelPath) => {
    const filePath = path.resolve(workspaceRoot, fileRelPath);
    if (!fs.existsSync(filePath)) return null;

    const fileName = path.basename(filePath);
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';

    try {
      const driveRes = await driveApi.files.create({
        requestBody: {
          name: fileName,
          ...(folderId ? { parents: [folderId] } : {}),
        },
        media: { mimeType, body: fs.createReadStream(filePath) },
        fields: 'id, webViewLink',
      });

      if (driveRes.data.id && driveRes.data.webViewLink) {
        const fileId = driveRes.data.id;
        try {
          await Promise.all(
            config.authorizedUsers.map((email) =>
              driveApi.permissions.create({
                fileId,
                requestBody: {
                  type: 'user',
                  role: 'reader',
                  emailAddress: email,
                },
                sendNotificationEmail: false,
              })
            )
          );
        } catch (err) {
          console.error(`Failed to grant permissions for ${fileName}`, err);
        }
        return driveRes.data.webViewLink;
      }
      return null;
    } catch (err) {
      console.error(`Failed to upload file ${fileName} to Google Drive`, err);
      return `*(Failed to upload to Drive: ${fileName})*`;
    }
  });

  const uploadResults = await Promise.all(uploadPromises);
  return uploadResults.filter((r) => r !== null) as string[];
}
