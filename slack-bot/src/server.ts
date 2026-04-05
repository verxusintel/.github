import type { Env, SlackEvent } from "./types";
import { verifySlackSignature, postSlackMessage } from "./slack";
import { classifyMessage } from "./classifier";
import { createGitHubIssue } from "./github";
import { createLinearIssue } from "./linear";

// Rate limiter
const DAILY_LIMIT = 10;
let issueCount = 0;
let lastResetDate = "";

// Deduplication: track processed message timestamps (Slack retries with same ts)
const processedMessages = new Set<string>();

function checkRateLimit(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastResetDate) {
    issueCount = 0;
    lastResetDate = today;
  }
  if (issueCount >= DAILY_LIMIT) return false;
  issueCount++;
  return true;
}

// Load env
const env: Env = {
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET || "",
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
  LINEAR_API_KEY: process.env.LINEAR_API_KEY || "",
  GITHUB_ORG: process.env.GITHUB_ORG || "verxusintel",
  SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID || "",
  ALLOWED_USER_IDS: process.env.ALLOWED_USER_IDS || "",
};

// Validate required secrets
for (const key of ["SLACK_SIGNING_SECRET", "SLACK_BOT_TOKEN", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"]) {
  if (!env[key as keyof Env]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

async function handleSlackEvent(event: SlackEvent): Promise<Response> {
  // url_verification challenge
  if (event.type === "url_verification") {
    return new Response(JSON.stringify({ challenge: event.challenge }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (event.type !== "event_callback" || !event.event) {
    return new Response("ok", { status: 200 });
  }

  const msg = event.event;

  // Ignore bots, edits, threads
  if (msg.type !== "message" || msg.bot_id || msg.subtype || msg.thread_ts) {
    return new Response("ok", { status: 200 });
  }

  // Deduplicate: Slack retries if response takes >3s
  const msgKey = `${msg.channel}-${msg.ts}`;
  if (processedMessages.has(msgKey)) {
    return new Response("ok", { status: 200 });
  }
  processedMessages.add(msgKey);
  // Cleanup old entries every 100 messages
  if (processedMessages.size > 100) {
    const entries = Array.from(processedMessages);
    entries.slice(0, 50).forEach(e => processedMessages.delete(e));
  }

  // User allowlist
  const allowedUsers = env.ALLOWED_USER_IDS
    ? env.ALLOWED_USER_IDS.split(",").map((id) => id.trim())
    : [];
  if (allowedUsers.length > 0 && !allowedUsers.includes(msg.user)) {
    return new Response("ok", { status: 200 });
  }

  // Channel filter
  if (env.SLACK_CHANNEL_ID && msg.channel !== env.SLACK_CHANNEL_ID) {
    return new Response("ok", { status: 200 });
  }

  // Rate limit
  if (!checkRateLimit()) {
    postSlackMessage(msg.channel, "Rate limit reached (10 issues/day).", [], env.SLACK_BOT_TOKEN).catch(console.error);
    return new Response("ok", { status: 200 });
  }

  // Respond immediately (Slack requires <3s), process in background
  const channel = msg.channel;
  const text = msg.text;
  const user = msg.user;

  queueMicrotask(async () => {
    try {
      const classification = await classifyMessage(text, env.ANTHROPIC_API_KEY);
      console.log(`Classified: ${classification.repo}/${classification.type}/${classification.priority} — ${classification.title}`);

      const ghIssue = await createGitHubIssue(
        {
          repo: classification.repo,
          title: classification.title,
          description: classification.description,
          type: classification.type,
          priority: classification.priority,
          slackUser: user,
          messageText: text,
          org: env.GITHUB_ORG,
        },
        env.GITHUB_TOKEN
      );
      console.log(`GitHub issue created: ${ghIssue.url}`);

      let linearResult: { id: string; url: string } | null = null;
      if (env.LINEAR_API_KEY) {
        try {
          linearResult = await createLinearIssue(
            { title: classification.title, description: classification.description, priority: classification.priority, type: classification.type },
            env.LINEAR_API_KEY
          );
          if (linearResult) console.log(`Linear issue created: ${linearResult.id}`);
        } catch (err) {
          console.error("Linear failed:", err);
        }
      }

      const emoji: Record<string, string> = { critical: ":rotating_light:", high: ":red_circle:", medium: ":large_yellow_circle:", low: ":white_circle:" };
      const blocks: any[] = [
        { type: "section", text: { type: "mrkdwn", text: `${emoji[classification.priority] || ":white_circle:"} *Issue created*` } },
        { type: "section", fields: [
          { type: "mrkdwn", text: `*Repo:*\n\`${classification.repo}\`` },
          { type: "mrkdwn", text: `*Type:*\n\`${classification.type}\`` },
          { type: "mrkdwn", text: `*Priority:*\n\`${classification.priority}\`` },
          { type: "mrkdwn", text: `*GitHub:*\n<${ghIssue.url}|#${ghIssue.number}>` },
        ]},
        { type: "section", text: { type: "mrkdwn", text: `*${classification.title}*\n${classification.description}` } },
      ];

      if (linearResult) {
        blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Linear: <${linearResult.url}|${linearResult.id}>` }] });
      }

      await postSlackMessage(channel, `Issue #${ghIssue.number} created in ${classification.repo}`, blocks, env.SLACK_BOT_TOKEN);
    } catch (err) {
      console.error("Error:", err);
      await postSlackMessage(channel, `Failed: ${err instanceof Error ? err.message : "Unknown error"}`, [], env.SLACK_BOT_TOKEN).catch(console.error);
    }
  });

  // Return 200 immediately so Slack doesn't retry
  return new Response("ok", { status: 200 });
}

// Bun HTTP server
const PORT = Number(process.env.PORT) || 3333;

const server = Bun.serve({
  port: PORT,
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Only POST /
    if (request.method !== "POST" || url.pathname !== "/") {
      return new Response("Not found", { status: 404 });
    }

    const body = await request.text();
    const timestamp = request.headers.get("x-slack-request-timestamp") || "";
    const signature = request.headers.get("x-slack-signature") || "";

    // Verify signature
    const valid = await verifySlackSignature(body, signature, timestamp, env.SLACK_SIGNING_SECRET);
    if (!valid) {
      return new Response("Invalid signature", { status: 401 });
    }

    let event: SlackEvent;
    try {
      event = JSON.parse(body) as SlackEvent;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    return handleSlackEvent(event);
  },
});

console.log(`Slack bot listening on port ${PORT}`);
