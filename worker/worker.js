/**
 * Moving Out Giveaway — Cloudflare Worker API
 *
 * Proxies the four Notion databases (Electronics, Living, Kitchenware,
 * Ingredients) to the static frontend, and lets visitors claim an item by
 * writing their name into the "Claimed By" property on the Notion page.
 *
 * Deploy: paste this whole file into a Cloudflare Worker (dashboard "Edit
 * Code" view works fine — no build step needed), then set:
 *   - Secret:      NOTION_TOKEN     = your Notion integration token
 *   - Env var:      ALLOWED_ORIGIN   = your GitHub Pages origin
 *                    (e.g. https://yourname.github.io) — used for CORS.
 *                    Defaults to "*" if unset.
 *
 * Routes:
 *   GET  /api/items         -> { categories: [...] }  (lightweight card data)
 *   GET  /api/item?id=<id>  -> full page detail incl. body photos/text
 *   POST /api/claim         -> { id, name } writes the claim (once only)
 */

const NOTION_VERSION = "2025-09-03";

const CATEGORIES = [
  {
    key: "electronics",
    name: "Electronics",
    dsId: "3ba7e302-69df-803f-8f52-000b3ac91c32",
    dbId: "3ba7e302-69df-8063-940f-e460533c9fc0",
    fileProp: "Files & media",
    textProps: ["text"],
    cover: "contain",
  },
  {
    key: "living",
    name: "Living",
    dsId: "3b97e302-69df-80ef-84e6-000b024bcdf3",
    dbId: "3b97e302-69df-801e-9e37-cac9dcf304c3",
    fileProp: "Files & media",
    textProps: ["text"],
    cover: "contain",
  },
  {
    key: "kitchenware",
    name: "Kitchenware",
    dsId: "3ba7e302-69df-806b-b1f3-000ba661505a",
    dbId: "3ba7e302-69df-80bc-9c5c-e0ccb671ca96",
    fileProp: "media",
    textProps: ["text"],
    cover: "cover",
  },
  {
    key: "ingredients",
    name: "Ingredients",
    dsId: "3b97e302-69df-80a9-ad6a-000bbd0df0e2",
    dbId: "3b97e302-69df-8047-9f31-d18c4e3ed014",
    fileProp: "media",
    textProps: ["text", "text 2"],
    cover: "cover",
  },
];

function findCategory(page) {
  const parent = page.parent || {};
  const dsId = parent.data_source_id;
  const dbId = parent.database_id;
  return CATEGORIES.find((c) => c.dsId === dsId || c.dbId === dbId);
}

const ITEMS_CACHE_KEY = "https://moving-out-giveaway.internal/cache/api/items";

function notionHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION };
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(obj, status, origin, cacheSeconds) {
  const headers = {
    "Content-Type": "application/json",
    ...corsHeaders(origin),
  };
  if (cacheSeconds) headers["Cache-Control"] = `public, max-age=${cacheSeconds}`;
  return new Response(JSON.stringify(obj), { status, headers });
}

function getTitle(props) {
  for (const key in props) {
    if (props[key].type === "title") {
      return props[key].title.map((t) => t.plain_text).join("") || "Untitled";
    }
  }
  return "Untitled";
}

function getFiles(props, propName) {
  const p = props[propName];
  if (!p || p.type !== "files") return [];
  return p.files
    .map((f) => (f.type === "file" ? f.file.url : f.external ? f.external.url : null))
    .filter(Boolean);
}

function getRichText(props, propName) {
  const p = props[propName];
  if (!p) return "";
  if (p.type === "rich_text") return p.rich_text.map((t) => t.plain_text).join("");
  return "";
}

function getIcon(icon) {
  if (!icon) return null;
  if (icon.type === "emoji") return { type: "emoji", value: icon.emoji };
  if (icon.type === "external") return { type: "image", value: icon.external.url };
  if (icon.type === "file") return { type: "image", value: icon.file.url };
  return null;
}

async function queryDataSource(dsId, token) {
  let results = [];
  let cursor;
  do {
    const body = { page_size: 100, sorts: [{ property: "Order", direction: "ascending" }] };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`https://api.notion.com/v1/data_sources/${dsId}/query`, {
      method: "POST",
      headers: { ...notionHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`data source query failed (${res.status}): ${t}`);
    }
    const data = await res.json();
    results = results.concat(data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

const TEXT_BLOCK_TYPES = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "quote",
  "callout",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
]);

async function getPageExtras(pageId, token) {
  const images = [];
  const textLines = [];

  async function walk(blockId, depth) {
    if (depth > 5) return;
    let cursor;
    do {
      const qs = cursor ? `?page_size=100&start_cursor=${cursor}` : "?page_size=100";
      const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children${qs}`, {
        headers: notionHeaders(token),
      });
      if (!res.ok) return;
      const data = await res.json();
      for (const b of data.results) {
        if (b.type === "image") {
          const img = b.image;
          const url = img.type === "file" ? img.file.url : img.external && img.external.url;
          if (url) images.push(url);
        } else if (TEXT_BLOCK_TYPES.has(b.type)) {
          const rt = (b[b.type] && b[b.type].rich_text) || [];
          const t = rt.map((r) => r.plain_text).join("").trim();
          if (t) textLines.push(t);
        }
        if (b.has_children) await walk(b.id, depth + 1);
      }
      cursor = data.has_more ? data.next_cursor : null;
    } while (cursor);
  }

  await walk(pageId, 0);
  return { images, textLines };
}

async function handleItems(env, ctx) {
  const origin = env.ALLOWED_ORIGIN || "*";
  const cache = caches.default;
  const cacheReq = new Request(ITEMS_CACHE_KEY);
  const cached = await cache.match(cacheReq);
  if (cached) {
    const resp = new Response(cached.body, cached);
    resp.headers.set("Access-Control-Allow-Origin", origin);
    return resp;
  }

  const token = env.NOTION_TOKEN;
  const categories = [];
  for (const cat of CATEGORIES) {
    const pages = await queryDataSource(cat.dsId, token);
    const items = pages.map((p) => ({
      id: p.id,
      icon: getIcon(p.icon),
      name: getTitle(p.properties),
      images: getFiles(p.properties, cat.fileProp),
      lines: cat.textProps.map((tp) => getRichText(p.properties, tp)).filter(Boolean),
      claimedBy: getRichText(p.properties, "Claimed By").trim() || null,
    }));
    categories.push({ key: cat.key, name: cat.name, cover: cat.cover, items });
  }

  const payload = { categories, generatedAt: new Date().toISOString() };
  const response = json(payload, 200, origin, 45);
  ctx.waitUntil(cache.put(cacheReq, response.clone()));
  return response;
}

async function handleItemDetail(id, env) {
  const origin = env.ALLOWED_ORIGIN || "*";
  const token = env.NOTION_TOKEN;
  const pageRes = await fetch(`https://api.notion.com/v1/pages/${id}`, { headers: notionHeaders(token) });
  if (!pageRes.ok) return json({ error: "not_found" }, 404, origin);
  const page = await pageRes.json();
  const cat = findCategory(page);
  if (!cat) return json({ error: "forbidden" }, 403, origin);

  const extras = await getPageExtras(id, token);
  const payload = {
    id: page.id,
    icon: getIcon(page.icon),
    name: getTitle(page.properties),
    images: [...getFiles(page.properties, cat.fileProp), ...extras.images],
    lines: cat.textProps.map((tp) => getRichText(page.properties, tp)).filter(Boolean),
    extraLines: extras.textLines,
    claimedBy: getRichText(page.properties, "Claimed By").trim() || null,
    category: cat.key,
  };
  return json(payload, 200, origin, 30);
}

async function handleClaim(request, env, ctx) {
  const origin = env.ALLOWED_ORIGIN || "*";
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400, origin);
  }

  const id = (body.id || "").toString().trim();
  const name = (body.name || "").toString().trim().replace(/[\r\n\t]+/g, " ").slice(0, 60);
  if (!id) return json({ error: "missing_id" }, 400, origin);
  if (!name) return json({ error: "missing_name" }, 400, origin);

  const token = env.NOTION_TOKEN;
  const pageRes = await fetch(`https://api.notion.com/v1/pages/${id}`, { headers: notionHeaders(token) });
  if (!pageRes.ok) return json({ error: "not_found" }, 404, origin);
  const page = await pageRes.json();

  const cat = findCategory(page);
  if (!cat) return json({ error: "forbidden" }, 403, origin);

  const existing = getRichText(page.properties, "Claimed By").trim();
  if (existing) return json({ error: "already_claimed", claimedBy: existing }, 409, origin);

  const patchRes = await fetch(`https://api.notion.com/v1/pages/${id}`, {
    method: "PATCH",
    headers: { ...notionHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { "Claimed By": { rich_text: [{ type: "text", text: { content: name } }] } },
    }),
  });
  if (!patchRes.ok) {
    const t = await patchRes.text();
    return json({ error: "notion_error", detail: t }, 502, origin);
  }

  ctx.waitUntil(caches.default.delete(new Request(ITEMS_CACHE_KEY)));
  return json({ ok: true, claimedBy: name }, 200, origin);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    try {
      if (url.pathname === "/api/items" && request.method === "GET") {
        return await handleItems(env, ctx);
      }
      if (url.pathname === "/api/item" && request.method === "GET") {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "missing_id" }, 400, origin);
        return await handleItemDetail(id, env);
      }
      if (url.pathname === "/api/claim" && request.method === "POST") {
        return await handleClaim(request, env, ctx);
      }
      if (url.pathname === "/" || url.pathname === "") {
        return json({ ok: true, service: "moving-out-giveaway-api" }, 200, origin);
      }
      return json({ error: "not_found" }, 404, origin);
    } catch (err) {
      return json({ error: "server_error", detail: String((err && err.message) || err) }, 500, origin);
    }
  },
};
