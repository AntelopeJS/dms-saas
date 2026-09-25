export type WorkspaceOperatorAction =
  | "workspace.suspend"
  | "workspace.unsuspend"
  | "subscription.upgrade"
  | "customer_balance.credit"
  | "invitation.resend"
  | "invitation.link_copy";

export type OperatorActionStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "reconciliation_required";

export type OperatorActionDetailValue =
  | null
  | boolean
  | number
  | string
  | OperatorActionDetailValue[]
  | OperatorActionDetails;

export interface OperatorActionDetails {
  [key: string]: OperatorActionDetailValue;
}

export interface OperatorCommandResult {
  operationId: string;
  status: OperatorActionStatus;
  effectiveAt: Date | null;
}
