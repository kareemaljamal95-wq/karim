/**
 * Workflow definition model.
 *
 * A workflow is a directed graph of typed nodes. The engine walks it from the
 * trigger, running one executor per node against a shared run context, so the
 * graph an operator edits in the Workflow Builder is genuinely the thing that
 * executes — not a diagram sitting next to hard-coded logic.
 */

export type NodeType = 'trigger' | 'agent' | 'tool' | 'condition' | 'approval' | 'action';

export interface WorkflowNode {
  id: string;
  type: NodeType;
  label: string;
  /** Agent key for `agent` nodes. */
  agent?: string;
  /** Tool key for `tool` nodes. */
  tool?: string;
  config?: Record<string, unknown>;
  /** Free-text explanation shown in the builder. */
  description?: string;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  /** For condition nodes: which branch this edge represents. */
  when?: 'pass' | 'fail';
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  definition: WorkflowDefinition;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConditionConfig {
  /** Path into the evaluated item, e.g. "leadScore" or "opportunityScore". */
  field: string;
  operator: '>=' | '>' | '<=' | '<' | '==' | '!=' | 'in' | 'exists';
  value: unknown;
}

/** Validates a definition before it is stored. Returns human-readable problems. */
export function validateDefinition(definition: WorkflowDefinition): string[] {
  const problems: string[] = [];
  if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) {
    problems.push('A workflow needs at least one node.');
    return problems;
  }

  const ids = new Set<string>();
  for (const node of definition.nodes) {
    if (!node.id) problems.push('Every node needs an id.');
    if (ids.has(node.id)) problems.push(`Duplicate node id "${node.id}".`);
    ids.add(node.id);
    if (!node.label) problems.push(`Node "${node.id}" needs a label.`);
    if (node.type === 'agent' && !node.agent) {
      problems.push(`Agent node "${node.id}" must name an agent.`);
    }
    if (node.type === 'condition') {
      const config = node.config as unknown as ConditionConfig | undefined;
      if (!config?.field || !config.operator) {
        problems.push(`Condition node "${node.id}" needs a field and an operator.`);
      }
    }
  }

  const triggers = definition.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) problems.push('A workflow needs exactly one trigger node.');
  if (triggers.length > 1) problems.push('A workflow can only have one trigger node.');

  for (const edge of definition.edges ?? []) {
    if (!ids.has(edge.from)) problems.push(`Edge references unknown node "${edge.from}".`);
    if (!ids.has(edge.to)) problems.push(`Edge references unknown node "${edge.to}".`);
  }

  // Reachability: a node that cannot be reached from the trigger never runs.
  if (triggers.length === 1) {
    const reachable = new Set<string>([triggers[0].id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of definition.edges ?? []) {
        if (reachable.has(edge.from) && !reachable.has(edge.to)) {
          reachable.add(edge.to);
          changed = true;
        }
      }
    }
    for (const node of definition.nodes) {
      if (!reachable.has(node.id)) {
        problems.push(`Node "${node.label || node.id}" is not reachable from the trigger.`);
      }
    }
  }

  return problems;
}

/** Linear execution order from the trigger, following `pass` edges by default. */
export function executionOrder(definition: WorkflowDefinition): WorkflowNode[] {
  const byId = new Map(definition.nodes.map((n) => [n.id, n]));
  const trigger = definition.nodes.find((n) => n.type === 'trigger');
  if (!trigger) return [];

  const ordered: WorkflowNode[] = [];
  const visited = new Set<string>();
  let current: WorkflowNode | undefined = trigger;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    ordered.push(current);
    const next = (definition.edges ?? []).find(
      (e) => e.from === current!.id && (e.when === undefined || e.when === 'pass'),
    );
    current = next ? byId.get(next.to) : undefined;
  }

  return ordered;
}
