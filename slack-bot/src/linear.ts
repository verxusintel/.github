interface CreateLinearIssueParams {
  title: string;
  description: string;
  priority: string;
  type?: string;
}

interface LinearIssueResult {
  id: string;
  url: string;
}

// VerXus Linear team config
const TEAM_ID = "3666d5d2-1362-4d0d-8fbe-6e475ec9aa6b";

const STATES: Record<string, string> = {
  backlog: "9966a83f-7172-47c1-8531-7f483d0fb8d8",
  todo: "38fb7897-2a2b-4246-8915-0e73be64268c",
  in_progress: "d2eac226-eb3a-4572-8587-a895e4930a6b",
  in_review: "271d8187-a0e4-497b-bf55-b69a1b94afe7",
  done: "526fabd3-2ec0-4baf-8a54-676ae21eafcd",
  canceled: "34bdbdac-ff05-4f13-a2c9-181a7f530e70",
};

const LABEL_MAP: Record<string, string> = {
  bug: "f8da8766-7212-4020-a3da-6d3349dab916",
  feature: "1e707294-988b-4b67-a690-f3838240bd42",
  improvement: "168224cc-2455-4978-b5c5-b0b8040214d0",
  security: "c816b836-ac13-4204-8a24-f908234f7575",
  performance: "168224cc-2455-4978-b5c5-b0b8040214d0", // maps to Improvement
};

const PRIORITY_MAP: Record<string, number> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

async function linearGraphQL(query: string, variables: Record<string, unknown>, apiKey: string) {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Linear API error (${response.status})`);
  const data = await response.json() as { data?: unknown; errors?: Array<{ message: string }> };
  if (data.errors?.length) throw new Error(`Linear: ${data.errors[0].message}`);
  return data.data;
}

/**
 * Create a Linear issue in team VER with proper state, label, and priority.
 */
export async function createLinearIssue(
  params: CreateLinearIssueParams,
  apiKey: string
): Promise<LinearIssueResult | null> {
  if (!apiKey) return null;

  const { title, description, priority, type } = params;
  const labelIds = type && LABEL_MAP[type] ? [LABEL_MAP[type]] : [];

  const data = await linearGraphQL(
    `mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }`,
    {
      input: {
        teamId: TEAM_ID,
        title,
        description,
        priority: PRIORITY_MAP[priority] ?? 3,
        stateId: STATES.todo,
        labelIds,
      },
    },
    apiKey
  ) as { issueCreate?: { issue?: { id: string; identifier: string; url: string } } };

  const issue = data?.issueCreate?.issue;
  if (!issue) throw new Error("Linear issue creation returned no issue");
  return { id: issue.identifier, url: issue.url };
}

/**
 * Update a Linear issue status. Used by PM Agent and workflows.
 */
export async function updateLinearIssueState(
  issueId: string,
  state: keyof typeof STATES,
  apiKey: string
): Promise<void> {
  if (!apiKey || !STATES[state]) return;
  await linearGraphQL(
    `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success }
    }`,
    { id: issueId, input: { stateId: STATES[state] } },
    apiKey
  );
}

/**
 * Get open issues for PM standup report.
 */
export async function getOpenIssues(apiKey: string): Promise<Array<{
  identifier: string;
  title: string;
  state: string;
  priority: number;
  assignee: string | null;
  labels: string[];
  createdAt: string;
  updatedAt: string;
}>> {
  if (!apiKey) return [];
  const data = await linearGraphQL(
    `query {
      team(id: "${TEAM_ID}") {
        issues(filter: { state: { type: { in: ["backlog", "unstarted", "started"] } } }, first: 50, orderBy: updatedAt) {
          nodes {
            identifier title priority createdAt updatedAt
            state { name }
            assignee { name }
            labels { nodes { name } }
          }
        }
      }
    }`,
    {},
    apiKey
  ) as { team?: { issues?: { nodes: Array<any> } } };

  return (data?.team?.issues?.nodes || []).map((n: any) => ({
    identifier: n.identifier,
    title: n.title,
    state: n.state?.name || "Unknown",
    priority: n.priority,
    assignee: n.assignee?.name || null,
    labels: (n.labels?.nodes || []).map((l: any) => l.name),
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  }));
}
