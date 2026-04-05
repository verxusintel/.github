interface CreateGitHubIssueParams {
  repo: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  slackUser: string;
  messageText: string;
  org: string;
}

interface GitHubIssueResult {
  number: number;
  url: string;
}

/**
 * Create a GitHub issue in the specified VerXus repository.
 */
export async function createGitHubIssue(
  params: CreateGitHubIssueParams,
  token: string
): Promise<GitHubIssueResult> {
  const { repo, title, description, type, priority, slackUser, messageText, org } = params;

  const body = [
    `## ${title}`,
    "",
    description,
    "",
    "---",
    "",
    "**Source:** Slack (VerXus Agent Bot)",
    `**Requested by:** <@${slackUser}>`,
    `**Classification:** \`${type}\` | **Priority:** \`${priority}\``,
    "",
    "<details>",
    "<summary>Original Slack message</summary>",
    "",
    `> ${messageText.replace(/\n/g, "\n> ")}`,
    "",
    "</details>",
  ].join("\n");

  const labels = ["agent", `type/${type}`, `priority/${priority}`];

  const response = await fetch(
    `https://api.github.com/repos/${org}/${repo}/issues`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "verxus-agent-bot",
      },
      body: JSON.stringify({ title, body, labels }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    number: number;
    html_url: string;
  };

  return { number: data.number, url: data.html_url };
}
