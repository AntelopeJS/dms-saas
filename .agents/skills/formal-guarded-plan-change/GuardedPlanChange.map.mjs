/**
 * Reader's view of GuardedPlanChange.tla for /statechart: one region for the
 * plan change on the subscription, one for the inventory barrier, and one for
 * Stripe.
 */

/**
 * @typedef {{
 *   sub: { phase: string; plan: string };
 *   life: { barrier: string; closed: boolean; active: string[] };
 *   stripe: { cancelAtEnd: boolean; status: string; renewed: boolean };
 *   deadline: boolean;
 * }} State
 */

const PHASE = new Map([
  ["none", "No plan change"],
  ["preparing", "Target published, draining writers"],
  ["aborting", "Aborting"],
  ["provider_pending", "Stripe request admitted"],
  ["scheduled", "Downgrade scheduled"],
  ["cancel_pending", "Cancellation admitted"],
  ["effective", "Landing, validating inventory"],
  ["blocked", "Blocked, needs attention"],
  ["activating", "Free plan written, activating"],
]);

/** @param {State} v */
export const state = (v) => ({
  "Plan change": `${PHASE.get(v.sub.phase) ?? v.sub.phase}${v.sub.plan === "free" && v.sub.phase === "none" ? " (on Free)" : ""}`,
  Inventory: v.life.closed ? "Closed by deletion" : v.life.barrier === "none" ? "Writers admitted" : "Writers paused",
  Stripe: v.stripe.status === "canceled" ? "Cancelled" : v.stripe.cancelAtEnd ? "Cancels at period end" : v.stripe.renewed ? "Renewed" : "Active",
});

/** @param {State} v */
export const group = (v) => (v.deadline ? "past deadline" : "before deadline");

export const colors = { "before deadline": "blue", "past deadline": "orange" };

export const title = "Guarded paid-to-Free plan change";
