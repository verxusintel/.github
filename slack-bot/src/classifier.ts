import type { Classification } from "./types";

const SYSTEM_PROMPT = `You are a task classifier AND product engineer for the VerXus autonomous threat intelligence platform.

First, determine the MODE:
- "product" mode: if the message is about product ideas, UX improvements, business logic, user experience, flows, strategy, roadmap, specifications, "eu quero", "precisamos de", "seria legal se", "o usuario deveria", "como podemos"
- "code" mode: if the message is about bugs, errors, broken things, specific code changes, endpoint fixes, performance issues, "tá lento", "não funciona", "bug", "erro", "fix"

## For CODE mode:
Available repositories:
- api: NestJS backend — REST endpoints, database, auth, server logic
- frontend: React frontend — UI, pages, components, API call URLs
- social-service: Next.js workers — social media scraping, job queues
- telegram-service: Bun + Telegram — Telegram integration

Rules:
- Page calling wrong endpoint → frontend
- Data displays wrong → frontend
- API returns wrong data → api
- Background job fails → social-service
- When in doubt → frontend

## For PRODUCT mode:
- repo: choose the MOST affected repo, or "frontend" if it's UX/flow
- type: usually "feature" or "improvement"
- Generate user_stories: array of user stories in format "As a [user], I want [action] so that [benefit]"
- Generate acceptance_criteria: array of testable criteria

Return ONLY valid JSON:
{
  "mode": "code" | "product",
  "repo": "api" | "frontend" | "social-service" | "telegram-service",
  "type": "bug" | "feature" | "improvement" | "security" | "performance",
  "priority": "critical" | "high" | "medium" | "low",
  "title": "<short title, under 70 characters>",
  "description": "<description, 2-4 sentences>",
  "user_stories": ["As a...", "As a..."],
  "acceptance_criteria": ["Given X, when Y, then Z", "..."]
}

For code mode, user_stories and acceptance_criteria can be empty arrays.
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

  const rawText = data.content?.[0]?.text;
  if (!rawText) {
    throw new Error("Empty response from Anthropic API");
  }

  // Strip markdown code fences if present
  const text = rawText
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

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

const REVISE_SYSTEM_PROMPT = `You are revising an existing GitHub issue based on a user correction.

You will receive:
- The ORIGINAL issue (title + description)
- A CORRECTION message from the user describing what should change (fix wrong info, add context, change priority, etc.)

Produce an UPDATED version of the issue reflecting the correction. Preserve anything the user didn't ask to change.

Return ONLY valid JSON:
{
  "mode": "code" | "product",
  "repo": "api" | "frontend" | "social-service" | "telegram-service",
  "type": "bug" | "feature" | "improvement" | "security" | "performance",
  "priority": "critical" | "high" | "medium" | "low",
  "title": "<updated short title, under 70 characters>",
  "description": "<updated description, 2-4 sentences>",
  "user_stories": ["As a...", "..."],
  "acceptance_criteria": ["...", "..."]
}

No markdown, no code fences. Only the JSON object.`;

export async function reviseClassification(
  original: { title: string; description: string; repo: string; mode: "code" | "product" },
  correction: string,
  apiKey: string
): Promise<Classification> {
  const userContent = [
    `ORIGINAL ISSUE (repo: ${original.repo}, mode: ${original.mode}):`,
    `Title: ${original.title}`,
    `Description: ${original.description}`,
    ``,
    `USER CORRECTION:`,
    correction,
  ].join("\n");

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
      system: REVISE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
  const rawText = data.content?.[0]?.text;
  if (!rawText) throw new Error("Empty response from Anthropic API");

  const text = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const classification = JSON.parse(text) as Classification;

  const validRepos = ["api", "frontend", "social-service", "telegram-service"];
  const validTypes = ["bug", "feature", "improvement", "security", "performance"];
  const validPriorities = ["critical", "high", "medium", "low"];

  if (!validRepos.includes(classification.repo)) throw new Error(`Invalid repo: ${classification.repo}`);
  if (!validTypes.includes(classification.type)) throw new Error(`Invalid type: ${classification.type}`);
  if (!validPriorities.includes(classification.priority)) throw new Error(`Invalid priority: ${classification.priority}`);
  if (!classification.title || classification.title.length > 70) throw new Error("Title missing or >70 chars");
  if (!classification.description) throw new Error("Description missing");

  return classification;
}

/**
 * Detect whether the user is asking to revise a previously created issue.
 * Returns the referenced issue number, or null (use lastIssuePerUser).
 */
export function detectRevisionIntent(text: string): { isRevision: boolean; issueNumber: number | null } {
  const lower = text.toLowerCase();
  const reviseKeywords = [
    "mandei errado",
    "enviei errado",
    "revise",
    "revisa",
    "revisar",
    "corrige",
    "corrija",
    "corrigir",
    "atualize",
    "atualiza",
    "atualizar",
    "edite",
    "edita",
    "editar",
    "update the issue",
    "edit the issue",
    "fix the issue",
    "wrong issue",
  ];
  const hasKeyword = reviseKeywords.some(k => lower.includes(k));

  // Explicit #123 reference
  const match = text.match(/#(\d+)/);
  const issueNumber = match ? parseInt(match[1], 10) : null;

  return {
    isRevision: hasKeyword || (issueNumber !== null && /\b(issue|issu)\b/i.test(text)),
    issueNumber,
  };
}
