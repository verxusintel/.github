export interface Env {
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  GITHUB_TOKEN: string;
  LINEAR_API_KEY: string;
  GITHUB_ORG: string;
  SLACK_CHANNEL_ID: string;
  ALLOWED_USER_IDS: string;
}

export interface Classification {
  repo: string;
  type: "bug" | "feature" | "improvement" | "security" | "performance";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
}

export interface SlackEvent {
  type: string;
  token?: string;
  challenge?: string;
  event?: {
    type: string;
    text: string;
    user: string;
    channel: string;
    ts: string;
    bot_id?: string;
    subtype?: string;
    thread_ts?: string;
  };
}
