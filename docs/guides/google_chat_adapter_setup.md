# Google Chat Adapter Setup Guide

This guide describes how to set up and configure the Google Chat adapter for Clawmini.

## Prerequisites

- A Google Cloud Platform (GCP) Project.
- The Clawmini daemon running locally (the adapter communicates with it via TRPC over Unix sockets).
- Ensure you have the `gcloud` CLI installed and authenticated with your Google account.

## Step 1: Configure Google Chat API

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select your project.
3. Enable the **Google Chat API** in the API Library.
4. Navigate to the Google Chat API configuration page.
5. Provide App Information (Name, Avatar URL, Description).
6. Under **Interactive features**, check **Receive 1:1 messages** (and optionally **Join spaces and group conversations**).
7. Under **Connection settings**, select **Cloud Pub/Sub**.
8. Set the Pub/Sub topic to a new topic (e.g., `projects/YOUR_PROJECT_ID/topics/clawmini-chat-topic`). If it doesn't exist, Google Chat will create it.

## Step 2: Create a Pub/Sub Subscription

1. Go to the **Pub/Sub** section in the Google Cloud Console.
2. Find the topic you used in Step 1.
3. Create a **Pull** subscription for this topic (e.g., `clawmini-chat-sub`).
4. Note your **Project ID** and **Subscription Name**.

## Step 3: Setup Application Default Credentials (ADC)

The adapter authenticates using Google's Application Default Credentials.

1. Run the following command in your terminal:
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