import type { Env, SlackEvent } from "./types";
import { verifySlackSignature, postSlackMessage } from "./slack";
import { classifyMessage } from "./classifier";
import { createGitHubIssue } from "./github";
import { createLinearIssue } from "./linear";

// Simple in-memory rate limiter: max issues per day
const DAILY_LIMIT = 10;
let issueCount = 0;
let lastResetDate = "";

function checkRateLimit(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastResetDate) {
    issueCount = 0;
    lastResetDate = today;
  }
  if (issueCount >= DAILY_LIMIT) {
    return false;
  }
  issueCount++;
  return true;
}

async function handleSlackEvent(
  event: SlackEvent,
  env: Env
): Promise<Response> {
  // Handle url_verification challenge
  if (event.type === "url_verification") {
    return new Response(JSON.stringify({ challenge: event.challenge }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only handle event_callback with message events
  if (event.type !== "event_callback" || !event.event) {
    return new Response("ok", { status: 200 });
  }

  const msg = event.event;

  // Ignore bot messages, edits, and thread replies
  if (msg.type !== "message" || msg.bot_id || msg.subtype || msg.thread_ts) {
    return new Response("ok", { status: 200 });
  }

  // Filter by allowed user IDs
  const allowedUsers = env.ALLOWED_USER_IDS
    ? env.ALLOWED_USER_IDS.split(",").map((id) => id.trim())
    : [];
  if (allowedUsers.length > 0 && !allowedUsers.includes(msg.user)) {
    return new Response("ok", { status: 200 });
  }

  // Filter by channel if configured
  if (env.SLACK_CHANNEL_ID && msg.channel !== env.SLACK_CHANNEL_ID) {
    return new Response("ok", { status: 200 });
  }

  // Rate limit check
  if (!checkRateLimit()) {
    await postSlackMessage(
      msg.channel,
      "Rate limit reached (10 issues/day). Try again tomorrow.",
      [],
      env.SLACK_BOT_TOKEN
    );
    return new Response("ok", { status: 200 });
  }

  // Process the message asynchronously
  try {
    // 1. Classify the message
    const classification = await classifyMessage(msg.text, env.ANTHROPIC_API_KEY);

    // 2. Create GitHub issue
    const ghIssue = await createGitHubIssue(
      {
        repo: classification.repo,
        title: classification.title,
        description: classification.description,
        type: classification.type,
        priority: classification.priority,
        slackUser: msg.user,
        messageText: msg.text,
        org: env.GITHUB_ORG,
      },
      env.GITHUB_TOKEN
    );

    // 3. Create Linear issue (optional)
    let linearResult: { id: string; url: string } | null = null;
    try {
      linearResult = await createLinearIssue(
        {
          title: classification.title,
          description: classification.description,
          priority: classification.priority,
        },
        env.LINEAR_API_KEY
      );
    } catch (err) {
      console.error("Linear issue creation failed:", err);
    }

    // 4. Post confirmation to Slack
    const priorityEmoji: Record<string, string> = {
      critical: ":rotating_light:",
      high: ":red_circle:",
      medium: ":large_yellow_circle:",
      low: ":white_circle:",
    };

    const blocks: unknown[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${priorityEmoji[classification.priority] || ":white_circle:"} *Issue created from your message*`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Repo:*\n\`${classification.repo}\``,
          },
          {
            type: "mrkdwn",
            text: `*Type:*\n\`${classification.type}\``,
          },
          {
            type: "mrkdwn",
            text: `*Priority:*\n\`${classification.priority}\``,
          },
          {
            type: "mrkdwn",
            text: `*GitHub:*\n<${ghIssue.url}|#${ghIssue.number}>`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${classification.title}*\n${classification.description}`,
        },
      },
    ];

    if (linearResult) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Linear: <${linearResult.url}|${linearResult.id}>`,
          },
        ],
      });
    }

    const fallbackText = `Issue #${ghIssue.number} created in ${classification.repo}: ${classification.title}`;

    await postSlackMessage(
      msg.channel,
      fallbackText,
      blocks,
      env.SLACK_BOT_TOKEN
    );
  } catch (err) {
    console.error("Error processing message:", err);
    await postSlackMessage(
      msg.channel,
      `Failed to process message: ${err instanceof Error ? err.message : "Unknown error"}`,
      [],
      env.SLACK_BOT_TOKEN
    );
  }

  return new Response("ok", { status: 200 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only accept POST requests
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await request.text();
    const timestamp = request.headers.get("x-slack-request-timestamp") || "";
    const signature = request.headers.get("x-slack-signature") || "";

    // Verify Slack signature
    const valid = await verifySlackSignature(
      body,
      signature,
      timestamp,
      env.SLACK_SIGNING_SECRET
    );
    if (!valid) {
      return new Response("Invalid signature", { status: 401 });
    }

    let event: SlackEvent;
    try {
      event = JSON.parse(body) as SlackEvent;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    return handleSlackEvent(event, env);
  },
};
