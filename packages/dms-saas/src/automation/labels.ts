const AUTOMATION_LABEL_NAMESPACE = "$saas.automation";
const NODE_ID_PREFIX = "saas.";

export type AutomationNodeKind = "trigger" | "action" | "data";

export interface AutomationNodeLabels {
  name: string;
  description: string;
}

/**
 * Catalog labels as `$`-prefixed locale keys, which the automation frontend
 * resolves in the reader's language: `saas.trial-ending` reads its name from
 * `saas.automation.trigger.trial_ending.name`.
 */
export function automationNodeLabels(
  kind: AutomationNodeKind,
  id: string,
): AutomationNodeLabels {
  const key = id.slice(NODE_ID_PREFIX.length).replaceAll("-", "_");
  const prefix = `${AUTOMATION_LABEL_NAMESPACE}.${kind}.${key}`;
  return { name: `${prefix}.name`, description: `${prefix}.description` };
}
