# OfflineSMS Web release

## DigitalOcean App Platform

Deploy `apps/web` as a Static Site component in `offlinesms-dashboard-app`. In Firebase project `offlinesms-prod-2027`, register an app named **OfflineSMS Web** if it does not exist yet. Open **Project settings → Your apps → SDK setup and configuration → Config** and put the public SDK config object in `OFFLINESMS_WEB_FIREBASE_CONFIG` as valid JSON. The build checks the production project ID and includes only public Firebase SDK fields. [Firebase Web setup](https://firebase.google.com/docs/web/setup)

Add the following entry under `static_sites` in the existing App Spec. Set the JSON as a build-time environment variable on this component, and use a branch containing the DigitalOcean build script.

```yaml
- name: offlinesms-web
  github:
    repo: raedrasheed/offlinesms-2027
    branch: main
    deploy_on_push: true
  source_dir: apps/web
  environment_slug: node-js
  build_command: npm ci --include=dev && npm run build:digitalocean
  output_dir: dist
```

Add `web.offlinesms.com` to the app and create the `web` CNAME in Cloudflare using the alias shown by DigitalOcean. In **Networking → Component routing rules**, route `web.offlinesms.com` and `/` to `offlinesms-web` with **Preserve Full Path**. When editing the App Spec, insert this entry under `ingress.rules` before the existing `/` fallback. [Static Site components](https://docs.digitalocean.com/products/app-platform/how-to/manage-static-sites/) · [Domain and component routing](https://docs.digitalocean.com/products/app-platform/how-to/manage-domains/#use-subdomain-routing)

```yaml
- match:
    authority:
      exact: web.offlinesms.com
    path:
      prefix: /
  component:
    name: offlinesms-web
    preserve_path_prefix: true
```

If App Check or phone sign-in policy requires attestation, register the same Firebase Web App in App Check with a reCAPTCHA Enterprise key that allows `web.offlinesms.com`. Add its public site key as `OFFLINESMS_WEB_APP_CHECK_SITE_KEY` at build time. If the Firebase API key uses website restrictions, include the web hostname in its allowed referrers. [Firebase App Check for Web](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider) · [Firebase API keys](https://firebase.google.com/docs/projects/api-keys)

After deployment, confirm HTTPS, verify that the web sign-in screen loads, and check email and phone verification with authorized test accounts. Check that the correct conversations appear and that two test accounts can exchange a message. Verify `dash.offlinesms.com` and `business.offlinesms.com` still reach their existing login pages.

## Firebase Hosting

The `web` Hosting target serves the client in `apps/web/dist` from a dedicated site in the `offlinesms-prod-2027` Firebase project. The client obtains its public Firebase configuration from `/__/firebase/init.json` on that Hosting origin. Use a Firebase Web App registered in this project when creating the Hosting site. [Firebase multisite Hosting](https://firebase.google.com/docs/hosting/multisites) · [Firebase Hosting SDK configuration](https://firebase.google.com/docs/hosting/reserved-urls#sdk_auto-configuration)

### Build

From the repository root at the reviewed release commit, run these commands with Node.js 20 or newer and an authenticated Firebase CLI.

```powershell
npm --prefix apps/web ci --include=dev
if ($LASTEXITCODE -ne 0) { throw 'OfflineSMS Web dependency install failed' }
npm --prefix apps/web run build
if ($LASTEXITCODE -ne 0) { throw 'OfflineSMS Web build failed' }
```

If the backend requires App Check, register the Web App with reCAPTCHA Enterprise in Firebase App Check. Register the Firebase Hosting hostname and the custom hostname on the reCAPTCHA key, and set `$env:OFFLINESMS_WEB_APP_CHECK_SITE_KEY` to the public site key before building or deploying. The phone sign-in flow uses the existing OfflineSMS callables and their server-side availability and verification checks. [Firebase App Check for Web](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)

### Configure the dedicated Hosting target

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

### Deploy and connect the domain

```powershell
firebase deploy --only hosting:web --project offlinesms-prod-2027
if ($LASTEXITCODE -ne 0) { throw 'OfflineSMS Web Hosting deployment failed' }
```

Use the Hosting URL returned by the deploy command to verify that the sign-in screen appears and `/__/firebase/init.json` reports project ID `offlinesms-prod-2027`. Check email sign-in and, when phone sign-in is available, use an authorized test account with a number in a supported country to check code delivery and verification. Verify that the correct conversations appear and that two test accounts can exchange a message. Phone sign-in availability follows the project configuration and relay coverage.

In the project's Hosting console, open the dedicated site, select **Add custom domain**, and enter `web.offlinesms.com`. Use the records Firebase supplies in the DNS provider and wait for Hosting to verify the domain and provision HTTPS. Repeat the sign-in and conversation checks on the custom domain after it becomes active. [Firebase custom-domain setup](https://firebase.google.com/docs/hosting/custom-domain)
