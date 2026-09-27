// A page the tenant access gate refuses is answered by the server with its
// generic 403 before any route middleware runs, so a direct load of a tenant
// page never reaches the workspace-suspended middleware. Checked once the app
// is mounted instead; its "Go to home" would only lead to another refused page.
export default defineDmsPlugin((dmsApp) => {
  dmsApp.hook("app:mounted", async () => {
    const destination = await suspendedScreenRedirect(window.location.pathname);
    if (destination) await navigateDms(destination, { replace: true });
  });
});
