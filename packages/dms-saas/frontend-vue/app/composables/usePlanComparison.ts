const OPEN_STATE_KEY = "saas-plan-comparison-open";

/**
 * Open state of the plan comparison modal hosted by the plan card, shared so
 * other billing blocks (the payment method card's "add a card") can open it.
 */
export function usePlanComparison() {
  const isOpen = useDmsState<boolean>(OPEN_STATE_KEY, () => false);

  function open(): void {
    isOpen.value = true;
  }

  return { isOpen, open };
}
