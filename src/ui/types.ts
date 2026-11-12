// Shapes of the structured results of the Wiro MCP tools the plugin calls
// (search_models, get_model_schema, run_model, wait_for_task, get_task,
// get_account). They follow @wiro-ai/wiro-mcp.

export interface ModelSummary {
  slug: string;
  title: string;
  description?: string;
  categories: string[];
  pricing?: string;
  estimatedCostUsd?: number | null;
  discountPercent?: number;
}

export interface ModelOption {
  label: string;
  value: string;
}

export interface ModelParameter {
  id: string;
  type: string;
  label: string;
  description?: string;
  default?: string;
  sample?: string;
  required: boolean;
  placeholder?: string;
  note?: string;
  options: ModelOption[];
  min?: number;
  max?: number;
  step?: number;
  advanced: boolean;
}

export interface ModelDetail extends ModelSummary {
  parameters: Array<{ title: string; items: ModelParameter[] }>;
}

export type TaskState = 'submitted' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskOutput {
  name?: string;
  mimeType: string;
  sizeBytes: number | null;
  url?: string;
  kind: 'image' | 'video' | 'audio' | 'text' | 'file';
  text?: string;
}

export interface TaskReference {
  id?: string;
  token?: string;
  model?: string;
  status?: string;
  exitCode?: string;
  durationSeconds?: number | null;
  costUsd?: number | null;
  chargedUsd?: number | null;
}

export interface NextAction {
  tool: string;
  arguments: Record<string, unknown>;
  reason?: string;
}

export interface TaskResult {
  state: TaskState;
  task: TaskReference;
  outputs: TaskOutput[];
  response?: string;
  error?: string;
  nextAction?: NextAction;
}

export interface Account {
  workspace?: { kind?: string; teamName?: string; organizationName?: string; role?: string };
  balance?: { currency?: string; totalUsd?: number } | null;
}

export interface ModelPage {
  models: ModelSummary[];
  total: number;
  nextStart: number | null;
}
