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
4. Add the service account you created in Step 1 with role `Pub/Sub Subscriber`

## Step 3: Configure Google Chat API

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select your project.
3. Enable the **Google Chat API** in the API Library.
4. Navigate to the Google Chat API configuration page.
5. Uncheck **Build this Chat app as a Workspace add-on**.
5. Provide App Information (Name, Avatar URL, Description).
6. Under **Interactive features**, optionally check **Join spaces and group conversations**.
7. Under **Connection settings**, select **Cloud Pub/Sub**.
8. Set the Pub/Sub topic to the topic you created earlier (e.g., `projects/YOUR_PROJECT_ID/topics/chat`).

## Step 4: Setup Application Default Credentials (ADC)

The adapter authenticates using Google's Application Default Credentials.

1. Run the following command in your terminal:
   ```bash
   # replace with the service account email from Step 1
   gcloud auth application-default login --impersonate-service-account=$SERVICE_ACCOUNT_EMAIL
   ```
   Or if you are not using a service account:
   ```bash
   gcloud auth application-default login
   ```
2. Follow the browser prompts to authenticate. This generates a local credentials file that the adapter will use automatically.

## Step 4: Configure the Adapter

The adapter requires a configuration file containing your GCP Project ID, Subscription Name, and authorized users. You can generate a template configuration file by running the `init` command:

```bash
npx clawmini-adapter-google-chat init
```

This will create a `config.json` file at `.clawmini/adapters/google-chat/config.json`. Open this file and replace the placeholders:

```json
{
  "projectId": "YOUR_PROJECT_ID",
  "subscriptionName": "YOUR_SUBSCRIPTION_NAME",
  "authorizedUsers": ["your.email@example.com"],
  "maxAttachmentSizeMB": 25,
  "chatId": "default"
}
```

## Step 5: Start the Adapter

Ensure the Clawmini daemon is running, then start the Google Chat adapter:

```bash
npx clawmini-adapter-google-chat
```

The adapter will now listen for authorized messages from Google Chat and forward them to your Clawmini daemon.