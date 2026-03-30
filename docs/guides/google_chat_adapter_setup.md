# Google Chat Adapter Setup Guide

This guide describes how to set up and configure the Google Chat adapter for Clawmini.

## Prerequisites

- A Google Cloud Platform (GCP) Project.
- The Clawmini daemon running locally (the adapter communicates with it via TRPC over Unix sockets).
- Ensure you have the `gcloud` CLI installed and authenticated with your Google account.

## Step 1: Create a Service Account (Optional)

This step is optional, but recommended.

1. Navigate to **Service Accounts** in **IAM & Admin**
2. Create a new service account.
3. Set a **name** (e.g. `clawmini-adapter`)
4. In **Principals with access** add your own account with the role `Service Account Token Creator`
5. Take note of the service account email address.

## Step 2: Create a Pub/Sub Topic & Subscription

1. Go to the **Pub/Sub** / **Topics** section in the Google Cloud Console.
2. Create a new **Topic** (e.g. `chat`) and check **Add a default subscription**
3. Add `chat-api-push@system.gserviceaccount.com` with role `Pub/Sub Publisher`
4. Navigate to **Subscriptions**, select the subscription that was created (e.g. `chat-sub`)
5. Add the service account you created in Step 1 with role `Pub/Sub Subscriber`

## Step 3: Configure Google Chat API

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select your project.
3. Enable the **Google Chat API** in the API Library.
4. Navigate to the Google Chat API configuration page.
5. Uncheck **Build this Chat app as a Workspace add-on**.
6. Provide App Information (Name, Avatar URL, Description).
7. Under **Interactive features**, optionally check **Join spaces and group conversations**.
8. Under **Connection settings**, select **Cloud Pub/Sub**.
9. Set the Pub/Sub topic to the topic you created earlier (e.g., `projects/YOUR_PROJECT_ID/topics/chat`).

## Step 4: Setup Application Default Credentials (ADC)

The adapter authenticates using Google's Application Default Credentials.

### Option A: Short-lived Credentials (requires regular re-authentication)

1. Run the following command in your terminal:
   ```bash
   # replace with the service account email from Step 1
   gcloud auth application-default login --impersonate-service-account=$SERVICE_ACCOUNT_EMAIL
   ```
   Or if you are not using a service account:
   ```bash
   gcloud auth application-default login
   ```
2. Follow the browser prompts to authenticate. This generates a local credentials file that the adapter will use automatically. Note that impersonated credentials expire quickly and require re-authenticating regularly (e.g., daily).

### Option B: Long-lived Service Account JSON Key (Recommended for long-running setups)

To avoid having to re-authenticate every day, you can use a Service Account JSON Key.

1. In the Google Cloud Console, navigate to **IAM & Admin** > **Service Accounts**.
2. Select the service account you created in Step 1.
3. Go to the **Keys** tab, click **Add Key** > **Create new key**, and select **JSON**.
4. Save the downloaded `.json` file securely on your machine (ensure it is added to `.gitignore` if placed inside a code repository).
5. Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to point to the absolute path of the JSON file before starting the adapter:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/your/service-account-key.json"
   ```
   You can add this `export` command to your `.bashrc`, `.zshrc`, or include it in your service startup scripts.

## Step 5: Configure the Adapter

The adapter requires a configuration file containing your GCP Project ID, Pub/Sub Topic Name, Subscription Name, and authorized users. You can generate a template configuration file by running the `init` command:

```bash
npx clawmini-adapter-google-chat init
```

This will create a `config.json` file at `.clawmini/adapters/google-chat/config.json`. Open this file and update it with your settings.

### User Authentication (File Uploads & Space Integration)

To allow the adapter to temporarily store files in Google Drive for uploads and to manage space events (like tracking message threads in spaces and creating event subscriptions), it requires an OAuth 2.0 Client ID for user authentication:

1. In the Google Cloud Console, enable the **Google Drive API** and **Google Workspace Events API**.
2. Go to **APIs & Services > Credentials**.
3. Click **Create Credentials** and select **OAuth client ID** (you may need to configure the OAuth consent screen first).
4. Choose **Web application** as the application type.
5. Add `http://localhost:31338/oauth2callback` to the **Authorized redirect URIs**.
6. Copy the **Client ID** and **Client Secret**.

Add these to your `config.json` file along with the `topicName`:

```json
{
  "projectId": "YOUR_PROJECT_ID",
  "topicName": "YOUR_TOPIC_NAME",
  "subscriptionName": "YOUR_SUBSCRIPTION_NAME",
  "authorizedUsers": ["your.email@example.com"],
  "maxAttachmentSizeMB": 25,
  "chatId": "default",
  "requireMention": false,
  "oauthClientId": "YOUR_CLIENT_ID",
  "oauthClientSecret": "YOUR_CLIENT_SECRET"
}
```

_Note: The first time you start the adapter, you will be prompted in the terminal to visit a URL to authorize your user account. The credentials will then be saved locally. `requireMention` defaults to `false` and can be set to `true` if you only want the bot to respond when explicitly mentioned._

**Disabling User Authentication:**
If you do not want to set up user authentication and do not need file upload support or space integration, you can simply omit the OAuth properties:

```json
{
  "projectId": "YOUR_PROJECT_ID",
  "topicName": "YOUR_TOPIC_NAME",
  "subscriptionName": "YOUR_SUBSCRIPTION_NAME",
  "authorizedUsers": ["your.email@example.com"],
  "maxAttachmentSizeMB": 25,
  "chatId": "default",
  "requireMention": false
}
```

## Step 6: Start the Adapter

Ensure the Clawmini daemon is running, then start the Google Chat adapter:

```bash
npx clawmini-adapter-google-chat
```

The adapter will now listen for authorized messages from Google Chat and forward them to your Clawmini daemon.

## Routing and Creating Chats

By default, the adapter connects to a single chat (the one specified as `chatId` in your `config.json`). However, you can create new Google Chat Spaces (or use different DMs) to map to separate Clawmini chats.

1. Create a new Space in Google Chat (or open a new DM).
2. Add your bot (the App you configured) to the Space.
3. Send the command `/agent [agent-id]` to automatically create a new Clawmini chat with that agent and map it to the current Google Chat Space.
4. Alternatively, use `/chat [chat-id]` in that space to map it to an existing Clawmini chat.

_Note: Each Space/DM can only be mapped to one Clawmini chat, and each Clawmini chat can only be mapped to one channel/space across all adapters._
