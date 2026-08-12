# Moving Out Giveaway — standalone page backed by Notion

This is a standalone webpage that mirrors your four Notion databases
(Electronics, Living, Kitchenware, Ingredients). Whenever you add, edit, or
photograph a new item in Notion, it shows up here automatically (within
about a minute). Visitors can claim an item by typing their name into a box
under it — that name is written straight back into the Notion page's
"Claimed By" field, so you always see claims in Notion too.

## How it's built

- **Frontend** (`index.html`, `styles.css`, `app.js`) — plain static files,
  no build step. Deployed to GitHub Pages.
- **API** (`worker/worker.js`) — a small Cloudflare Worker that holds your
  Notion integration token as a secret and talks to the Notion API on the
  frontend's behalf. GitHub Pages can't run server code, so this piece keeps
  your token safe and handles writing claims back to Notion.

## One-time setup

### 1. Deploy the Cloudflare Worker

You don't need Node or the `wrangler` CLI — the dashboard editor works fine:

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → sign up free if
   you don't have an account → **Workers & Pages** → **Create** → **Create
   Worker**.
2. Give it a name, e.g. `moving-out-giveaway-api`, and deploy the default
   "Hello World" template.
3. Click **Edit code**, delete everything in the editor, and paste in the
   full contents of [`worker/worker.js`](worker/worker.js). Click **Deploy**.
4. Go to the Worker's **Settings → Variables and Secrets**:
   - Add a secret named `NOTION_TOKEN` — paste in your Notion integration
     token (the one starting `ntn_...`). Mark it as **Secret** (encrypted),
     not plain text.
   - Leave `ALLOWED_ORIGIN` unset for now — it defaults to allowing anyone
     to call the API, which is fine for a low-stakes giveaway page and lets
     you test by just double-clicking `index.html` on your own computer.
     Once the page is live on GitHub Pages, you can optionally add
     `ALLOWED_ORIGIN` = `https://yourusername.github.io` to restrict the API
     to only your page (see step 3 below).
5. Note your Worker's URL — it looks like
   `https://moving-out-giveaway-api.your-subdomain.workers.dev`.

### 2. Point the frontend at your Worker

Open `config.js` and replace the placeholder with your real Worker URL:

```js
window.APP_CONFIG = {
  API_BASE_URL: "https://moving-out-giveaway-api.your-subdomain.workers.dev",
};
```

### 3. Publish to GitHub Pages

Push this folder to a GitHub repo, then in the repo's **Settings → Pages**,
set the source to your default branch (root folder). Your page will be live
at `https://yourusername.github.io/your-repo-name/`.

Once you know that URL, go back to the Worker's `ALLOWED_ORIGIN` setting and
update it to match (this restricts who can call your claim API).

### 4. Optional: add your own banner photo

The header currently uses a plain gradient placeholder. To use a real photo,
drop an image into `assets/banner.jpg` and update `.banner` in `styles.css`
to `background-image: url("assets/banner.jpg"); background-size: cover;`.

## How claiming works

Each of the four Notion databases has a "Claimed By" text property (added
automatically when this was set up). The claim box on the page reads and
writes that property directly. Once someone types a name and presses Enter,
it's locked in — nobody else can overwrite it from the page. To undo a claim,
just clear that field in Notion directly.

## Notes

- Card data refreshes automatically every 60 seconds, and immediately after
  you personally submit a claim.
- Clicking a photo or item name opens an expanded view that also pulls in
  any extra photos/notes you've added inside that item's Notion page (not
  just the database columns).
- The Worker caches the item list for ~45 seconds to stay fast and avoid
  hitting Notion's rate limits; a claim immediately invalidates that cache.
