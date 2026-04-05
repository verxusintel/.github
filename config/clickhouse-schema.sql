-- Agent Metrics Table
-- Deploy to the ClickHouse instance used by verxus-services
-- Connect via: clickhouse-client --host $CLICKHOUSE_HOST --user $CLICKHOUSE_USER

CREATE TABLE IF NOT EXISTS agent_metrics (
  timestamp DateTime DEFAULT now(),
  repo String,
  issue_number UInt32 DEFAULT 0,
  pr_number UInt32 DEFAULT 0,
  event_type Enum8(
    'task_start' = 1,
    'task_complete' = 2,
    'task_fail' = 3,
    'plan_ambiguous' = 4,
    'plan_decompose' = 5,
    'review_pass' = 6,
    'review_fail' = 7,
    'qa_pass' = 8,
    'qa_fail' = 9,
    'ci_fix' = 10,
    'escalation' = 11,
    'improve' = 12,
    'specs_update' = 13,
    'rollback' = 14
  ),
  model String DEFAULT '',
  tokens_in UInt32 DEFAULT 0,
  tokens_out UInt32 DEFAULT 0,
  cost_usd Float32 DEFAULT 0,
  duration_seconds UInt32 DEFAULT 0,
  complexity Enum8('L1' = 1, 'L2' = 2, 'L3' = 3) DEFAULT 'L2',
  task_type String DEFAULT '',
  success UInt8 DEFAULT 1,
  metadata String DEFAULT '{}'
) ENGINE = MergeTree()
ORDER BY (timestamp, repo)
TTL timestamp + INTERVAL 365 DAY;

-- Agent Lessons View (for PM reports)
CREATE VIEW IF NOT EXISTS agent_success_rates AS
SELECT
  repo,
  task_type,
  count() as total,
  countIf(success = 1) as successes,
  round(countIf(success = 1) / count() * 100, 1) as success_rate,
  round(avg(cost_usd), 3) as avg_cost,
  round(avg(duration_seconds), 0) as avg_duration_s
FROM agent_metrics
WHERE event_type IN ('task_complete', 'task_fail')
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY repo, task_type
ORDER BY total DESC;
