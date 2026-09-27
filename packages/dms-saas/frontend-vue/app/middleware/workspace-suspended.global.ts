export default defineDmsMiddleware(async (to) => {
  if (import.meta.env.SSR) return;
  // An active→blocked transition is enforced server-side by the tenant access
  // gate (typed 403s) until the next reload.
  return suspendedScreenRedirect(to.path);
});
