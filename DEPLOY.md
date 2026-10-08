# Stash — update 2

Two things are new, plus the deploy method changes permanently for the better.

## What changed

**A visible Save button.** The Paste button now turns green and says **Save** the
moment what is in the box looks like a link. Committing a pasted URL used to
require the Enter key, which is effectively invisible on a phone keyboard.

**`/api/save` — one request that saves *and* enriches.** The existing
`/api/links` returns immediately and relies on the open web page to kick off
enrichment separately. A Shortcut has no page sitting there to do that, so a
link shared from iOS would have stayed `pending` forever. This endpoint closes
that gap and is what the Shortcut calls.

**Self-healing pending links.** Whenever the app opens, anything still stuck on
`pending` gets picked up once automatically. So even if a share fails halfway,
or your phone drops signal mid-save, the link repairs itself next time you look.

**Share-sheet setup built into the app.** Menu (⋯) → *iPhone share sheet* shows
the exact address to paste into Shortcuts, with a Copy button.

---

## Deploying this — one time only, then it is easy forever

The Vercel connector I have been using can create a project but can **never
deploy to it a second time**. That is why the URL kept changing and why you had
to re-enter keys. Linking the folder to your existing `stash-cyatra` project
fixes that permanently: same URL, same environment variables, unlimited
redeploys.

Open Terminal and paste this whole block:

```sh
cd ~/Downloads/stash-v2        # or wherever you unzipped it
npx vercel login               # pick the same login as cyberyatraa@gmail.com
npx vercel link                # answer: Link to existing project? Y  →  stash-cyatra
npx vercel --prod              # deploys to https://stash-cyatra.vercel.app
```

`vercel link` is the important step — it ties this folder to the project that
already holds your three environment variables, so nothing needs re-entering.

From then on, any future change is just `npx vercel --prod` from that folder.

If Node is not installed on your Mac, `npx` will fail. Say so and we will import
the folder into a GitHub repo instead, which gives Vercel automatic deploys on
every change and needs no terminal at all.

---

## Building the iOS Shortcut

Do this once. Afterwards **Stash** appears in the share sheet of every app —
Twitter, Reddit, LinkedIn, Instagram, Safari.

1. Open the **Shortcuts** app → **+** to create a new shortcut.
2. Tap the ⓘ (info) button at the bottom → turn on **Show in Share Sheet**.
3. Just under it, set the accepted input to **URLs** only. Turn the rest off.
4. Tap **+ Add Action**, search for **Get Contents of URL**, add it.
5. In its URL field, paste:

   ```
   https://stash-cyatra.vercel.app/api/save?text=1&url=
   ```

6. With the cursor still at the very end of that address, tap the **Shortcut
   Input** variable so it is appended right after `url=`.

   The field should read `…/api/save?text=1&url=[Shortcut Input]`.

   **`url=` must be the last thing in the address.** Shared links often carry
   their own `?s=20&t=9`, and the server reads everything after `url=` verbatim
   so those extra parameters do not truncate the link.

7. Add one more action: **Show Notification**, and set its content to the
   **Contents of URL** variable. This makes the phone tell you what got saved,
   for example `Kap — Screenshots & Screen Recording`.
8. Rename the shortcut to **Stash** and pick an icon.

### Using it

In Twitter, tap Share → **Stash**. You get a notification with the title and
category a few seconds later. The link is already summarised, categorised and
tagged by the time you next open the app.

The request takes a few seconds because it scrapes the page and calls DeepSeek
before replying. That is deliberate — it means the notification can tell you
what it actually found rather than just "saved".

---

## A note on access

There is no login, by your choice. Anyone who knows the URL can read or add
links, and `/api/save` is reachable by anyone who knows the address. For a
personal bookmark list of public tools that is a reasonable trade. If you ever
want it locked down, the cheapest fix is a secret token in the query string that
the Shortcut sends and the server checks — ask and I will add it.
