# auto-update setup

how marka.md will deliver auto-updates to shipped users. plan first — wire it up just before tagging v1.0 (so signed builds get an updater channel from day one).

## how it works (one paragraph)

tauri ships a built-in updater plugin. on launch (or on demand) the app fetches a `latest.json` manifest from a URL we control, compares the manifest version to the running version, and — if newer — downloads the signed `.app.tar.gz`, verifies the signature against a public key baked into the app, and prompts the user to relaunch. **the signature is what makes it safe**: even though the manifest is served over HTTPS, the user's app refuses to install anything not signed by our updater private key. losing that key means we can never push another update; leaking it means anyone can.

## one-time setup

### 1 — generate the updater keypair

```bash
bun tauri signer generate -w ~/.tauri/marka.key
```

this writes:
- `~/.tauri/marka.key` — **private** key. NEVER commit. NEVER check into the repo. keep one copy in 1Password, one offline.
- `~/.tauri/marka.key.pub` — public key. paste into `tauri.conf.json` (next step).

the command will ask for a password — pick something strong, save it next to the key in 1Password.

### 2 — wire the public key into `tauri.conf.json`

```jsonc
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/mattenarle10/markamd/releases/latest/download/latest.json"
      ],
      "dialog": false,
      "pubkey": "PASTE_CONTENT_OF_~/.tauri/marka.key.pub_HERE"
    }
  }
}
```

- `dialog: false` — we render our own toast UI instead of the default native dialog (matches the app's tone).
- the endpoint is a stable URL — github redirects `releases/latest/download/<file>` to whichever release is marked "latest", so we don't have to update the URL each version.

### 3 — add the updater plugin (rust + js)

`src-tauri/Cargo.toml`:
```toml
[dependencies]
tauri-plugin-updater = "2"
```

`src-tauri/src/lib.rs`:
```rust
let app = tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_opener::init())
    // … rest
```

`package.json`:
```bash
bun add @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

### 4 — store secrets in github actions

repo → settings → secrets and variables → actions → new secret:
- `TAURI_SIGNING_PRIVATE_KEY` — **contents** of `~/.tauri/marka.key` (the file body, not the path)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password chosen in step 1

### 5 — pass the signing env to tauri-action

edit `.github/workflows/release.yml` — add to the `build + release dmg` step's `env:` block:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

with these set, tauri-action emits **two extra artifacts** per release:
- `marka.md.app.tar.gz` — the signed bundle the updater downloads
- `latest.json` — the manifest the updater reads

both are attached automatically to the github release.

### 6 — frontend integration

minimal version — check on launch, toast if available:

```ts
// src/lib/updater.ts
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export async function checkForUpdate(onAvailable: (v: string) => void) {
  try {
    const update = await check();
    if (update?.available) {
      onAvailable(update.version);
    }
  } catch (err) {
    console.warn("marka.md: update check failed", err);
  }
}

export async function applyUpdate() {
  const update = await check();
  if (!update?.available) return;
  await update.downloadAndInstall();
  await relaunch();
}
```

call `checkForUpdate` from `App` once on mount; surface the result as a Toast with an "install" action that calls `applyUpdate()`. add a button in the AboutOverlay too so users can check on demand.

## verification checklist

before tagging the first updater-enabled release:

- [ ] `~/.tauri/marka.key` + password backed up in 1Password
- [ ] `pubkey` in `tauri.conf.json` matches the `.pub` file
- [ ] `TAURI_SIGNING_PRIVATE_KEY` + password are set as github secrets
- [ ] tag a test prerelease, confirm `latest.json` + `.app.tar.gz` appear as release assets
- [ ] install the prerelease, then tag a higher prerelease, confirm the running app detects + offers the update

## ordering vs. apple notarization

auto-update works on **unsigned** dmgs too — the updater signature is independent of Apple codesigning. but the user experience is rough: after the updater extracts the new `.app`, gatekeeper will quarantine it again, requiring the xattr workaround on every update.

**recommended order**:
1. Apple Developer enrollment lands → notarized builds
2. one release with notarized + updater-enabled (`v1.0`)
3. all subsequent releases auto-update silently

shipping the updater before notarization works mechanically but breaks the magic.

## risks / gotchas

- **private key loss** = permanent inability to push updates to existing installs. they'd need to re-download manually.
- **endpoint downtime** — github releases is the SPOF here. acceptable for a free indie app. if downtime becomes a real problem, host `latest.json` on the landing site (`markamd.vercel.app/latest.json`) and have a small script publish to it after each release.
- **rollbacks** — there's no "revert" mechanism. if a release ships a bad bug, the fix is to publish a higher version with the fix. never delete a release that users may already have updated to (it breaks delta resolution).
- **manifest schema** — tauri 2 changed the format. don't paste tauri 1 examples into the endpoint config.

## post-launch nice-to-haves

- delta updates (smaller downloads — tauri-action supports them when configured)
- channel split: stable vs. canary endpoints, opt-in toggle in settings
- "check for updates" entry in the ⌘K palette wired to `checkForUpdate` directly (next to the about panel item)
- in-app changelog snippet pulled from the release body, shown in the "update available" toast
