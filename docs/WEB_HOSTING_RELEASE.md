# OfflineSMS Web release

The `web` Hosting target serves the client in `apps/web/dist` from a dedicated site in the `offlinesms-prod-2027` Firebase project. The client obtains its public Firebase configuration from `/__/firebase/init.json` on that Hosting origin. Use a Firebase Web App registered in this project when creating the Hosting site. [Firebase multisite Hosting](https://firebase.google.com/docs/hosting/multisites) · [Firebase Hosting SDK configuration](https://firebase.google.com/docs/hosting/reserved-urls#sdk_auto-configuration)

## Build

From the repository root at the reviewed release commit, run these commands with Node.js 20 or newer and an authenticated Firebase CLI.

```powershell
npm --prefix apps/web ci --include=dev
if ($LASTEXITCODE -ne 0) { throw 'OfflineSMS Web dependency install failed' }
npm --prefix apps/web run build
if ($LASTEXITCODE -ne 0) { throw 'OfflineSMS Web build failed' }
```

If the backend requires App Check, register the Web App with reCAPTCHA Enterprise in Firebase App Check. Register the Firebase Hosting hostname and the custom hostname on the reCAPTCHA key, and set `$env:OFFLINESMS_WEB_APP_CHECK_SITE_KEY` to the public site key before building or deploying. The phone sign-in flow uses the existing OfflineSMS callables and their server-side availability and verification checks. [Firebase App Check for Web](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)

## Configure the dedicated Hosting target

List the project's Web Apps and Hosting sites. If the dedicated Web App or Hosting site already exists, use its existing ID.

```powershell
firebase apps:list WEB --project offlinesms-prod-2027
firebase hosting:sites:list --project offlinesms-prod-2027
```

To create a Web App for the client, run `firebase apps:create WEB 'OfflineSMS Web' --project offlinesms-prod-2027`. Assign its returned App ID to `$webAppId`. Choose a dedicated, globally unique Hosting site ID and assign it to `$webSiteId`. For a new site, create it with the Web App association, then apply the deploy target from the repository root.

```powershell
firebase hosting:sites:create $webSiteId --app $webAppId --project offlinesms-prod-2027
if ($LASTEXITCODE -ne 0) { throw 'OfflineSMS Web Hosting site creation failed' }
firebase target:apply hosting web $webSiteId --project offlinesms-prod-2027
if ($LASTEXITCODE -ne 0) { throw 'OfflineSMS Web Hosting target setup failed' }
```

For an existing dedicated site, start with `firebase target:apply`. Keep the `website` target on its current Hosting site. [Firebase CLI and deploy targets](https://firebase.google.com/docs/cli)

## Deploy and connect the domain

```powershell
firebase deploy --only hosting:web --project offlinesms-prod-2027
if ($LASTEXITCODE -ne 0) { throw 'OfflineSMS Web Hosting deployment failed' }
```

Use the Hosting URL returned by the deploy command to verify that the sign-in screen appears and `/__/firebase/init.json` reports project ID `offlinesms-prod-2027`. Check email sign-in and, when phone sign-in is available, use an authorized test account with a number in a supported country to check code delivery and verification. Verify that the correct conversations appear and that two test accounts can exchange a message. Phone sign-in availability follows the project configuration and relay coverage.

In the project's Hosting console, open the dedicated site, select **Add custom domain**, and enter `web.offlinesms.com`. Use the records Firebase supplies in the DNS provider and wait for Hosting to verify the domain and provision HTTPS. Repeat the sign-in and conversation checks on the custom domain after it becomes active. [Firebase custom-domain setup](https://firebase.google.com/docs/hosting/custom-domain)
