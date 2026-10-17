# Selection Explainer

Selection Explainer is a dependency-free Chrome Manifest V3 extension that explains text you select on ordinary webpages by calling an OpenAI-compatible LiteLLM endpoint. User-managed prompt profiles control each explanation style. Ordinary explanations use Chat Completions; optional internet search uses the Responses API with the native web-search tool. It has no build step, hosted backend, analytics, or remote UI dependency.

## Install

1. Keep the complete `chrome-extension` directory together; `manifest.json` must remain directly inside it.
2. In Google Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** in the upper-right corner.
4. Click **Load unpacked**.
5. In the folder picker, select the `chrome-extension` folder itself, not its parent folder and not an individual file.
6. Chrome should list **Selection Explainer**. On an incomplete first install, the extension opens its Settings page automatically.
7. If Chrome reports a manifest, service-worker, or content-script error, use the extension card's **Errors** link, fix the reported package problem, and reload the extension before continuing.

Chrome 102 or newer is required because the service worker restricts local storage to trusted extension contexts. No `npm install` or build command is required to load the extension. Node.js and Python are needed only for the verification commands in [Test](#test).

## Configure LiteLLM

Open Settings from the extension popup, the first-install page, or the panel's **Settings** action.

1. Enter a LiteLLM endpoint in one of these forms:
   - Base URL: `https://litellm.example.com`
   - API root: `https://litellm.example.com/v1`
   - Complete endpoint: `https://litellm.example.com/v1/chat/completions`

   The first two forms are normalized to the complete `/v1/chat/completions` endpoint. A deployment path prefix is preserved. Do not include URL credentials, a query string, or a fragment.
2. Enter the API key accepted by that LiteLLM server.
3. Enter an editable model name or LiteLLM alias, such as `gpt-4o-mini`. The alias must exist and be permitted by your server; the extension does not perform model discovery.
4. In **Prompt profiles**, edit the title and complete prompt for each explanation style. The initial **10-year-old** and **Engineer** profiles are ordinary editable seed profiles, not hardcoded modes.
5. Use **Set as default** on the profile that should be selected first in the floating panel.
6. **Internet search is off by default.** Enable it only if the configured model supports native web search. Search uses the Responses API, may use substantially more time, tokens, and cost, and includes source citations when the provider returns them. The panel toggle can override this default for each explanation.
7. Click **Save and grant access**. Chrome asks for access only to the normalized endpoint's origin. Granting is required before the background service worker can contact it. If access is denied, the earlier saved configuration is preserved.
8. Click **Test connection**. This uses the active default prompt profile with internet search disabled and sends a small test statement through the ordinary explanation path. Success requires a valid assistant message in an OpenAI-compatible Chat Completions response.

Remote endpoints must use HTTPS. Plain HTTP is accepted only for loopback development endpoints using `localhost`, `127.0.0.1`, or `[::1]`, for example `http://localhost:4000`.

### Manage prompt profiles

Prompt profiles pair a selector title with one complete editable prompt. Settings keeps profiles in the order shown in the floating selector.

- Click **Add prompt profile** to append a new profile with a generated ID, a unique title, and a useful starter prompt.
- Rename a profile by editing its title. Titles must be unique, non-empty, and no longer than 60 characters.
- Click **Duplicate** to insert a copy after the source profile. The copied title and generated ID are made unique automatically.
- Click **Set as default** to choose the profile selected when the panel has no still-valid current choice.
- Click **Delete** to remove a profile. If the deleted profile was the default, the next profile becomes default, or the previous profile when the deleted item was last.

At least one profile must remain, so the final profile cannot be deleted. Settings accepts 1–20 profiles, and each prompt must be non-empty. There is no extension prompt-length cap: unusually large prompts are preserved and are not silently lost, but they may increase token cost or exceed the provider context window. Add, rename, duplicate, delete, and default changes are saved together only after **Save and grant access** succeeds.

### Existing-installation migration

Settings from schema versions 1 and 2 automatically migrate to prompt profiles the next time the background service worker normalizes stored settings. The former editable prompt becomes the base of both **10-year-old** and **Engineer** profiles, with the former audience instructions added to the corresponding profile. The former explanation level chooses the default profile. Endpoint, API key, model, enabled state, and internet-search preference are preserved.

Lossless schema versions 1 and 2 migration duplicates the complete legacy prompt into the two initial profiles, so the expanded version-3 settings can be nearly twice as large. The manifest requests `unlimitedStorage` so this v1/v2 migration can persist without Chrome's ordinary local-storage quota blocking the expanded object. Settings still use `chrome.storage.local`, access remains restricted to trusted extension contexts, and all writes remain serialized in the background service worker.

Migration is deterministic and idempotent: already-migrated settings keep their profile IDs and are not duplicated. Legacy prompt text and complete audience instructions are never truncated during migration and are not silently lost. If legacy profile data is invalid, the extension falls back to the two valid initial profiles rather than exposing partial private settings.

## Use

1. Visit an ordinary `http://` or `https://` webpage.
2. Select text with the mouse or keyboard. Standard text selections inside an `input` or `textarea` are also supported.
3. Click the **Explain** button at the bottom-right of the page.
4. Choose a **Prompt profile** in the panel. Profile titles appear in Settings order. A status refresh retains the current selection while that profile still exists; if it was removed, the panel falls back to the default profile.
5. The selected profile ID is captured when **Explain** or **Retry** begins, and the selector is disabled while the request is loading. Changing the selector affects the next request only.
6. Turn on **Internet search** only when current information or external sources are needed. The search choice is captured with the profile for the next Explain or Retry request.
7. Use **Copy** to copy the current explanation, **Retry** to request it again, **Settings** to open configuration, and **Close** or `Escape` to close the panel.
8. Use the extension popup's **Extension enabled** toggle to show or hide the Explain button globally. Open pages update without a page reload.

**Selecting or highlighting text alone sends nothing.** Selected text is transmitted only after an explicit **Explain** or **Retry** action.

Selections are normalized before sending and are limited to 20,000 characters. Requests time out after 25 seconds. With Internet search off, the extension sends one non-streaming Chat Completions request. With Internet search on, it converts the configured route to `/v1/responses`, enables the native `web_search` tool, and renders the answer with safe source citations. The returned explanation is rendered as safe Markdown using locally created DOM nodes, never by executing model-provided HTML.

## Privacy and security

- The configured LiteLLM server receives the selected text, the selected profile's full prompt, the chosen model alias, and the API credential. Use only an endpoint you trust and prefer a limited-purpose key.
- The API key is stored in `chrome.storage.local` in the current Chrome profile. It is not placed in webpage DOM, popup output, content-script messages, logs, or Chrome sync storage. Chrome local storage is not a dedicated encrypted secret vault; a person or process with access to the browser profile may be able to recover it.
- Full profile prompts stay in trusted extension storage and the background service worker; they are never included in settings or status data sent to webpage/content contexts.
- Only each profile ID and title cross the public status boundary. The panel sends the selected profile ID with the request, and the worker validates it against the latest settings before resolving the full prompt.
- The bearer key is added only by the background service worker and is sent only to the normalized configured endpoint after exact-origin permission is present.
- The manifest-derived content executable graph cannot access private settings or `chrome.storage.local` and cannot use `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, or Authorization handling. The extension includes no telemetry, analytics, advertisements, remote scripts, remote fonts, or remote stylesheets.
- Selected webpage text is treated as untrusted quoted data. A non-editable safety wrapper tells the model not to follow instructions found inside the selection, even when a user edits the selected profile prompt.
- Model responses are parsed into a safe local Markdown subset using `createElement` and `textContent`. Model-provided HTML is displayed as text and is never executed as markup or script.
- Error messages are normalized and do not echo credentials, selected text, or provider response bodies.
- HTTPS is required for every non-loopback endpoint. HTTP is limited to `localhost`, `127.0.0.1`, and `[::1]` development servers.
- The extension does not provide a credential proxy. If your LiteLLM server is unavailable, blocked, or misconfigured, the extension cannot route around it.

## Typography

Selection Explainer uses the bundled local Inter variable font as its primary font, with local system fallbacks if font loading fails. It does not load remote fonts. Body and explanations use weight 400; secondary labels and metadata use 500; controls use 550–600; Markdown strong text uses 600; and headings and primary titles use 650–700. Product styles do not use the former 750–850 weights. Code blocks retain the existing monospace stack.

## Protected pages

Chrome does not allow the content script to run on browser-protected locations such as `chrome://` pages, the Chrome Web Store, extension pages, and some browser-owned viewers. The Explain button will not appear there. Open an ordinary HTTP or HTTPS webpage to use the extension.

The extension intentionally runs only in the top-level page. It does not capture selections inside cross-origin iframes. It also does not interpret PDF canvas content, images, screenshots, audio, or video. A selection exposed as normal text on a supported top-level webpage can still work.

## Troubleshooting

### The Explain button is missing

- Confirm the page is an ordinary HTTP or HTTPS page, not a protected page described above.
- Open the popup and turn on **Extension enabled**.
- Reload the extension on `chrome://extensions`, then reload the webpage if the extension was just installed or reloaded.
- Check the extension card, service-worker console, and webpage console for an extension-context or content-script error.
- A selection inside a cross-origin iframe is not supported; select text in the top-level page instead.

### The API key is invalid or access is forbidden

A 401 or 403 response appears as **Check the API key and LiteLLM permissions.** Verify the key, the selected model/alias, and server-side authorization, then save and test again. Do not paste the key into webpage developer tools or console logs.

### Endpoint permission was denied

Return to Settings and click **Save and grant access** again. Approve the exact origin shown by Chrome. A denial does not replace previously saved settings.

### The service reports 429

The configured service is rate limited. Wait, reduce request frequency, or ask the LiteLLM administrator about quotas before retrying.

### The request times out

The extension cancels requests after 25 seconds. Check LiteLLM and provider latency, server logs, network reachability, and any reverse-proxy timeout, then retry.

### The response is incompatible

For ordinary explanations, the endpoint must return valid Chat Completions JSON with a non-empty assistant message at `choices[0].message`. For Internet search, the same configured base must expose `/v1/responses` and return `output_text` content; the configured model must support the native `web_search` tool.

### Internet search fails

Turn Internet search off and retry to confirm the ordinary Chat Completions route still works. Then verify that the model supports `/v1/responses` and the native `web_search` tool. Search requests can be slower and substantially more expensive than ordinary explanations.

### The proxy is offline or unavailable

A connection failure reports that the configured LiteLLM endpoint could not be reached. Confirm the server is running, DNS and TLS are valid, localhost is listening on the expected port, and firewalls or VPN rules allow access. HTTP 5xx responses indicate that LiteLLM or its upstream provider reported a server error; inspect those server logs without exposing the key.

## Test

Run all commands from the `chrome-extension` directory in Windows Command Prompt (`cmd.exe`). The test suite uses Node's built-in test runner and has no package dependencies.

```bat
npm test
for /r %F in (*.js) do @node --check "%F" || exit /b 1
python -m json.tool manifest.json > nul
python -m json.tool tests\helpers\approved-product-hashes.json > nul
node tests\helpers\update-product-hashes.js --check
node --test tests\package-scanners.test.js tests\package-mutations.test.js tests\package.test.js tests\manifest.test.js
```

`tests\package.test.js` enforces an explicit top-level manifest policy, root-contained recursive HTML/CSS/JavaScript references, parsed remote runtime-resource checks, empty inline script bodies, package path/type and UTF-8 hygiene, all-text secret scanning, the manifest-derived content private-settings boundary, the background-only request architecture, PNG signatures and IHDR dimensions, and deterministic icon bytes. `tests\package-mutations.test.js` copies the package into temporary directories and proves those checks reject focused security and packaging mutations without changing the real package.

### Maintain the approved product hashes

The package verifiers attest every product file outside `tests`: `manifest.json`, `background.js`, all `content`, `options`, `popup`, `shared`, `icons`, and `scripts` files, plus `package.json` and this README. The approved inventory records the exact sorted path set and SHA-256 bytes, so a changed, missing, or unexpected product file fails before semantic package checks run. Test files and verifier helpers are intentionally excluded and remain code-review-controlled. Root `.git` and `.gitattributes` entries are VCS-only metadata: they are excluded from product inventory and package traversal, and runtime references into them are rejected.

Before either updater mode generates an inventory, the runtime-reference policy rejects manifest entries and local JavaScript, HTML, or CSS dependency edges that resolve into `tests/**`. The same policy runs through product attestation in every top-level package verifier, so manually approving regenerated hashes cannot make verifier-only files runtime-reachable. Test files and verifier helpers may remain excluded only while no product runtime reference points at them.

After an intentional product change, review the changed product bytes first, then regenerate and check the inventory from this directory in Command Prompt:

```bat
node tests\helpers\update-product-hashes.js --write
node tests\helpers\update-product-hashes.js --check
node --test tests\package-scanners.test.js tests\package-mutations.test.js tests\package.test.js tests\manifest.test.js
```

Do not regenerate the inventory merely to make an unexplained verifier failure pass. The inventory change must be reviewed together with the intentional product change. The helper uses only Node.js built-ins, writes paths in deterministic ordinal order with lowercase SHA-256 values, and is not a runtime dependency or build step.

To regenerate the checked-in icons intentionally, run:

```bat
python scripts\generate_icons.py
node --test tests\package.test.js
```

### Delivery verification status (2026-10-17)

| Verification area | Status |
| --- | --- |
| Dependency-free Node test suite, syntax checks, JSON validation, icon checks, package policy, and approved-product hash inventory | Automated pass |
| Unpacked Chrome smoke test | Not executed |
| Live LiteLLM connection success | Not executed |

No unpacked Chrome smoke test was performed for this package, and no live LiteLLM success was performed because no live endpoint and credentials were available. These limitations must not be read as live-browser or live-model validation.

### Manual acceptance checklist

Record **Pass**, **Fail**, or **Not executed** for each item. Without a live LiteLLM endpoint and key, mark only the live-network cases as **Not executed**; still complete local, static, mocked, and UI checks.

1. [ ] A first install with incomplete settings opens Settings.
2. [ ] Invalid form fields show errors and move focus to the validation summary.
3. [ ] Denying endpoint permission preserves the earlier saved settings.
4. [ ] Valid configuration and **Test connection** succeed against the provided LiteLLM server.
5. [ ] Selecting text alone creates no request.
6. [ ] Mouse, keyboard, `input`, and `textarea` selections work.
7. [ ] Empty and over-20,000-character selections show local errors without a network request.
8. [ ] Add, rename, duplicate, delete, and **Set as default** work; the final remaining profile cannot be deleted.
9. [ ] Saved profile titles appear in Settings order, and each selected profile produces its configured explanation style.
10. [ ] **Copy**, **Retry**, **Settings**, **Close**, and `Escape` work.
11. [ ] Enabling or disabling the extension changes button visibility on open pages without a reload.
12. [ ] Long output scrolls inside the panel on desktop and in a narrow viewport.
13. [ ] Invalid key, 429, timeout, offline, 5xx, invalid JSON, and incompatible responses show sanitized actionable errors.
14. [ ] Reloading the extension preserves saved prompt profiles and other settings.
15. [ ] `chrome://` pages and the Chrome Web Store behave as documented.
16. [ ] No API key or full profile prompt appears in page DOM, popup output, content messages, or console logs.
