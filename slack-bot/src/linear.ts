interface CreateLinearIssueParams {
  title: string;
  description: string;
  priority: string;
}

interface LinearIssueResult {
  id: string;
  url: string;
}

const PRIORITY_MAP: Record<string, number> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

/**
 * Create a Linear issue. Returns null if LINEAR_API_KEY is not configured.
 */
export async function createLinearIssue(
  params: CreateLinearIssueParams,
  apiKey: string
): Promise<LinearIssueResult | null> {
  if (!apiKey) {
    console.log("LINEAR_API_KEY not set, skipping Linear issue creation");
    return null;
  }

  const { title, description, priority } = params;
  const linearPriority = PRIORITY_MAP[priority] ?? 3;

  const mutation = `
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          url
        }
      }
    }
  `;

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        input: {
          title,
          description,
          priority: linearPriority,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Linear API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    data?: {
      issueCreate?: {
        success: boolean;
        issue?: { id: string; identifier: string; url: string };
      };
    };
    errors?: Array<{ message: string }>;
  };

  if (data.errors?.length) {
    throw new Error(`Linear GraphQL error: ${data.errors[0].message}`);
  }

  const issue = data.data?.issueCreate?.issue;
  if (!issue) {
    throw new Error("Linear issue creation returned no issue");
  }

  return { id: issue.identifier, url: issue.url };
}
