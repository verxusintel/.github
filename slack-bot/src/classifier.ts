import type { Classification } from "./types";

const SYSTEM_PROMPT = `You are a task classifier for the VerXus autonomous threat intelligence platform. Classify task requests into structured issues.

Available repositories:
- api: NestJS backend (REST API, auth, database, core business logic)
- frontend: React frontend (dashboard, UI components, pages)
- social-service: Next.js workers (social media monitoring, data collection)
- telegram-service: Bun + Telegram bot (Telegram integration, bot commands)

Return ONLY valid JSON with this exact schema:
{
  "repo": "api" | "frontend" | "social-service" | "telegram-service",
  "type": "bug" | "feature" | "improvement" | "security" | "performance",
  "priority": "critical" | "high" | "medium" | "low",
  "title": "<short title, under 70 characters>",
  "description": "<technical description for the issue body, 2-4 sentences>"
}

No markdown, no code fences, no explanation. Only the JSON object.`;

/**
 * Classify a Slack message into a structured issue using Claude API.
 * Uses raw fetch (no Node.js deps) for Cloudflare Worker compatibility.
 */
export async function classifyMessage(
  message: string,
  apiKey: string
): Promise<Classification> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Classify this task request:\n\n${message}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const text = data.content?.[0]?.text;
  if (!text) {
    throw new Error("Empty response from Anthropic API");
  }

  const classification = JSON.parse(text) as Classification;

  // Validate required fields
  const validRepos = ["api", "frontend", "social-service", "telegram-service"];
  const validTypes = ["bug", "feature", "improvement", "security", "performance"];
  const validPriorities = ["critical", "high", "medium", "low"];

  if (!validRepos.includes(classification.repo)) {
    throw new Error(`Invalid repo: ${classification.repo}`);
  }
  if (!validTypes.includes(classification.type)) {
    throw new Error(`Invalid type: ${classification.type}`);
  }
  if (!validPriorities.includes(classification.priority)) {
    throw new Error(`Invalid priority: ${classification.priority}`);
  }
  if (!classification.title || classification.title.length > 70) {
    throw new Error("Title missing or exceeds 70 characters");
  }
  if (!classification.description) {
    throw new Error("Description missing");
  }

  return classification;
}
