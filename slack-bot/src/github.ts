import type { Classification } from "./types";

interface CreateGitHubIssueParams {
  repo: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  slackUser: string;
  messageText: string;
  org: string;
  mode: "code" | "product";
  user_stories?: string[];
  acceptance_criteria?: string[];
}

interface GitHubIssueResult {
  number: number;
  url: string;
}

function buildCodeBody(params: CreateGitHubIssueParams): string {
  return [
    `## ${params.title}`,
    "",
    params.description,
    "",
    "---",
    "",
    "**Source:** Slack (VerXus Agent Bot)",
    `**Requested by:** <@${params.slackUser}>`,
    `**Classification:** \`${params.type}\` | **Priority:** \`${params.priority}\``,
    "",
    "<details>",
    "<summary>Original Slack message</summary>",
    "",
    `> ${params.messageText.replace(/\n/g, "\n> ")}`,
    "",
    "</details>",
  ].join("\n");
}

function buildProductBody(params: CreateGitHubIssueParams): string {
  const stories = (params.user_stories || []).map(s => `- ${s}`).join("\n") || "- TBD";
  const criteria = (params.acceptance_criteria || []).map(c => `- [ ] ${c}`).join("\n") || "- [ ] TBD";

  return [
    `## Product Spec: ${params.title}`,
    "",
    params.description,
    "",
    "## User Stories",
    stories,
    "",
    "## Acceptance Criteria",
    criteria,
    "",
    "---",
    "",
    `**Source:** Slack (VerXus Agent Bot) — Product Mode`,
    `**Requested by:** <@${params.slackUser}>`,
    `**Priority:** \`${params.priority}\``,
    "",
    "<details>",
    "<summary>Original request</summary>",
    "",
    `> ${params.messageText.replace(/\n/g, "\n> ")}`,
    "",
    "</details>",
  ].join("\n");
}

export async function getGitHubIssue(
  org: string,
  repo: string,
  number: number,
  token: string
): Promise<{ title: string; body: string; labels: string[]; html_url: string }> {
  const response = await fetch(
    `https://api.github.com/repos/${org}/${repo}/issues/${number}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "verxus-agent-bot",
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error (${response.status}) fetching #${number}: ${errorText}`);
  }

  const data = (await response.json()) as {
    title: string;
    body: string | null;
    labels: Array<string | { name: string }>;
    html_url: string;
  };

  return {
    title: data.title,
    body: data.body || "",
    labels: data.labels.map(l => typeof l === "string" ? l : l.name),
    html_url: data.html_url,
  };
}

interface UpdateGitHubIssueParams {
  org: string;
  repo: string;
  number: number;
  title: string;
  description: string;
  type: string;
  priority: string;
  slackUser: string;
  messageText: string;
  mode: "code" | "product";
  user_stories?: string[];
  acceptance_criteria?: string[];
  previousLabels: string[];
}

export async function updateGitHubIssue(
  params: UpdateGitHubIssueParams,
  token: string
): Promise<GitHubIssueResult> {
  const isProduct = params.mode === "product";
  const buildParams: CreateGitHubIssueParams = {
    org: params.org,
    repo: params.repo,
    title: params.title,
    description: params.description,
    type: params.type,
    priority: params.priority,
    slackUser: params.slackUser,
    messageText: params.messageText,
    mode: params.mode,
    user_stories: params.user_stories,
    acceptance_criteria: params.acceptance_criteria,
  };
  const body = isProduct ? buildProductBody(buildParams) : buildCodeBody(buildParams);

  // Preserve non-type/priority labels, replace type/* and priority/*
  const preserved = params.previousLabels.filter(
    l => !l.startsWith("type/") && !l.startsWith("priority/")
  );
  const labels = Array.from(new Set([
    ...preserved,
    `type/${params.type}`,
    `priority/${params.priority}`,
  ]));

  const response = await fetch(
    `https://api.github.com/repos/${params.org}/${params.repo}/issues/${params.number}`,
    {
      method: "PATCH",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "verxus-agent-bot",
      },
      body: JSON.stringify({ title: params.title, body, labels }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error (${response.status}) updating #${params.number}: ${errorText}`);
  }

  const data = (await response.json()) as { number: number; html_url: string };

  // Post a comment announcing the revision, for audit trail
  await fetch(
    `https://api.github.com/repos/${params.org}/${params.repo}/issues/${params.number}/comments`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "verxus-agent-bot",
      },
      body: JSON.stringify({
        body: [
          `:pencil2: **Issue revised via Slack by <@${params.slackUser}>**`,
          "",
          "<details><summary>Correction message</summary>",
          "",
          `> ${params.messageText.replace(/\n/g, "\n> ")}`,
          "",
          "</details>",
        ].join("\n"),
      }),
    }
  ).catch(err => console.error("Failed to post revision comment:", err));

  return { number: data.number, url: data.html_url };
}

export async function createGitHubIssue(
  params: CreateGitHubIssueParams,
  token: string
): Promise<GitHubIssueResult> {
  const isProduct = params.mode === "product";

  const body = isProduct ? buildProductBody(params) : buildCodeBody(params);

  // Product issues: NO "agent" label (don't trigger coding pipeline)
  // Instead: "product-spec" label for tracking
  const labels = isProduct
    ? [`type/${params.type}`, `priority/${params.priority}`, "pm/needs-triage"]
    : ["agent", `type/${params.type}`, `priority/${params.priority}`];

  const response = await fetch(
    `https://api.github.com/repos/${params.org}/${params.repo}/issues`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "verxus-agent-bot",
      },
      body: JSON.stringify({ title: params.title, body, labels }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { number: number; html_url: string };
  return { number: data.number, url: data.html_url };
}
