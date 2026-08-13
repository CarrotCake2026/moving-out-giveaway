(function () {
  const API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "";
  const REFRESH_MS = 60000;

  const els = {
    status: document.getElementById("status"),
    categories: document.getElementById("categories"),
    overlay: document.getElementById("modal-overlay"),
    modalClose: document.getElementById("modal-close"),
    modalGallery: document.getElementById("modal-gallery"),
    modalTitle: document.getElementById("modal-title"),
    modalLines: document.getElementById("modal-lines"),
    modalExtra: document.getElementById("modal-extra"),
    modalClaim: document.getElementById("modal-claim"),
  };

  // itemId -> { item, cardClaimEl, modalClaimEl? }
  const itemIndex = new Map();
  let lastSignature = null;

  function isTypingInClaimBox() {
    const active = document.activeElement;
    return !!(active && active.tagName === "INPUT" && active.closest(".claim-box"));
  }

  function signatureOf(categories) {
    return JSON.stringify(
      categories.map((c) => [c.key, c.items.map((i) => [i.id, i.name, i.claimedBy, (i.images || []).length])])
    );
  }

  function setStatus(text, isError, showRetry) {
    els.status.classList.toggle("error", !!isError);
    els.status.innerHTML = "";
    els.status.append(document.createTextNode(text));
    if (showRetry) {
      const a = document.createElement("a");
      a.className = "retry";
      a.textContent = " Retry";
      a.addEventListener("click", loadItems);
      els.status.append(a);
    }
  }

  function iconNode(icon, size) {
    if (!icon) return null;
    if (icon.type === "emoji") {
      const span = document.createElement("span");
      span.className = "icon";
      span.textContent = icon.value;
      return span;
    }
    const img = document.createElement("img");
    img.src = icon.value;
    img.alt = "";
    img.style.width = (size || 16) + "px";
    img.style.height = (size || 16) + "px";
    img.style.borderRadius = "4px";
    img.style.marginRight = "4px";
    img.style.verticalAlign = "middle";
    return img;
  }

  const CLAIM_COLORS = [
    { bg: "#e8f5ea", border: "#6fae7c", text: "#2f6b3d" },
    { bg: "#e6f0fb", border: "#6fa3d9", text: "#2c5a8a" },
    { bg: "#f0eaf9", border: "#a98fd9", text: "#5c3d99" },
    { bg: "#fbe9f1", border: "#e08fb0", text: "#99315c" },
    { bg: "#faf1de", border: "#d9a94a", text: "#8a5a10" },
    { bg: "#e2f5f0", border: "#5cb89f", text: "#1f6e58" },
    { bg: "#fbebe6", border: "#e08a6a", text: "#99381c" },
    { bg: "#eef0f1", border: "#9aa3a8", text: "#45525a" },
  ];

  function colorForName(name) {
    const key = (name || "").trim().toLowerCase();
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) | 0;
    }
    const index = Math.abs(hash) % CLAIM_COLORS.length;
    return CLAIM_COLORS[index];
  }

  function buildClaimBox(item, { compact } = {}) {
    const box = document.createElement("div");
    box.className = "claim-box";

    function renderClaimed(name) {
      box.className = "claim-box claimed";
      const color = colorForName(name);
      box.style.background = color.bg;
      box.style.borderColor = color.border;
      box.style.color = color.text;
      box.textContent = "";
      box.append(document.createTextNode("Claimed by "));
      const strong = document.createElement("strong");
      strong.textContent = name;
      box.append(strong);
    }

    function renderOpen() {
      box.className = "claim-box";
      box.style.cssText = "";
      box.innerHTML = "";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 60;
      input.placeholder = "Type your name to claim it";
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit(input.value);
        }
      });
      box.append(input);
    }

    function submit(rawName) {
      const name = (rawName || "").trim();
      if (!name) return;
      box.className = "claim-box pending";
      box.innerHTML = "";
      box.append(document.createTextNode("Claiming…"));

      fetch(`${API_BASE_URL}/api/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, name }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.ok) {
            item.claimedBy = data.claimedBy;
            syncItemClaimUI(item.id, data.claimedBy);
          } else if (res.status === 409) {
            item.claimedBy = data.claimedBy || "someone else";
            syncItemClaimUI(item.id, item.claimedBy);
          } else {
            renderOpen();
            const err = document.createElement("div");
            err.className = "claim-error-text";
            err.textContent = "Couldn't save that — try again.";
            box.after(err);
            setTimeout(() => err.remove(), 4000);
          }
        })
        .catch(() => {
          renderOpen();
          const err = document.createElement("div");
          err.className = "claim-error-text";
          err.textContent = "Network error — try again.";
          box.after(err);
          setTimeout(() => err.remove(), 4000);
        });
    }

    if (item.claimedBy) {
      renderClaimed(item.claimedBy);
    } else {
      renderOpen();
    }

    box._render = () => (item.claimedBy ? renderClaimed(item.claimedBy) : renderOpen());
    return box;
  }

  function syncItemClaimUI(itemId, claimedBy) {
    const entry = itemIndex.get(itemId);
    if (!entry) return;
    entry.item.claimedBy = claimedBy;
    entry.claimBoxes.forEach((box) => box._render());
  }

  function buildCard(item, category) {
    const card = document.createElement("div");
    card.className = "card";

    const imgWrap = document.createElement("div");
    imgWrap.className = `card-image-wrap ${category.cover}`;
    if (item.images && item.images.length) {
      const img = document.createElement("img");
      img.src = item.images[0];
      img.loading = "lazy";
      img.alt = item.name;
      imgWrap.append(img);
    } else {
      imgWrap.classList.add("empty");
      imgWrap.textContent = "🎁";
    }
    imgWrap.addEventListener("click", () => openModal(item.id));
    card.append(imgWrap);

    const body = document.createElement("div");
    body.className = "card-body";

    const name = document.createElement("p");
    name.className = "card-name";
    const icon = iconNode(item.icon, 15);
    if (icon) name.append(icon);
    name.append(document.createTextNode(item.name));
    name.addEventListener("click", () => openModal(item.id));
    body.append(name);

    (item.lines || []).forEach((line) => {
      const p = document.createElement("p");
      p.className = "card-line";
      p.textContent = line;
      body.append(p);
    });

    const claimBox = buildClaimBox(item);
    body.append(claimBox);

    card.append(body);

    const entry = itemIndex.get(item.id) || { item, claimBoxes: [] };
    entry.item = item;
    entry.claimBoxes.push(claimBox);
    itemIndex.set(item.id, entry);

    return card;
  }

  function render(categories) {
    els.categories.innerHTML = "";
    itemIndex.clear();

    categories.forEach((cat) => {
      const section = document.createElement("section");
      section.className = "category";

      const h2 = document.createElement("h2");
      h2.className = "category-heading";
      h2.textContent = cat.name;
      section.append(h2);

      const grid = document.createElement("div");
      grid.className = `grid ${cat.key === "ingredients" ? "small" : ""}`;
      cat.items.forEach((item) => grid.append(buildCard(item, cat)));
      section.append(grid);

      els.categories.append(section);
    });
  }

  function loadItems() {
    const isFirstLoad = lastSignature === null;
    if (isFirstLoad) setStatus("Loading items…", false, false);
    fetch(`${API_BASE_URL}/api/items`)
      .then((res) => {
        if (!res.ok) throw new Error("bad status " + res.status);
        return res.json();
      })
      .then((data) => {
        const categories = data.categories || [];
        const signature = signatureOf(categories);
        if (signature === lastSignature) {
          setStatus("", false, false);
          return;
        }
        if (!isFirstLoad && isTypingInClaimBox()) {
          // Don't yank the page out from under someone mid-claim; try again next poll.
          return;
        }
        lastSignature = signature;
        render(categories);
        setStatus("", false, false);
      })
      .catch(() => {
        setStatus("Couldn't load items right now.", true, true);
      });
  }

  // Modal

  let currentItemId = null;

  function openModal(itemId) {
    currentItemId = itemId;
    els.overlay.hidden = false;
    els.modalGallery.className = "modal-gallery";
    els.modalGallery.innerHTML = "";
    els.modalTitle.textContent = "";
    els.modalLines.innerHTML = "";
    els.modalExtra.innerHTML = "";
    els.modalClaim.innerHTML = "";

    const loading = document.createElement("div");
    loading.className = "modal-loading";
    loading.textContent = "Loading…";
    els.modalGallery.append(loading);

    fetch(`${API_BASE_URL}/api/item?id=${encodeURIComponent(itemId)}`)
      .then((res) => {
        if (!res.ok) throw new Error("bad status " + res.status);
        return res.json();
      })
      .then((detail) => {
        if (currentItemId !== itemId) return;
        renderModal(detail);
      })
      .catch(() => {
        if (currentItemId !== itemId) return;
        els.modalGallery.innerHTML = "";
        const err = document.createElement("div");
        err.className = "modal-loading";
        err.textContent = "Couldn't load this item.";
        els.modalGallery.append(err);
      });
  }

  function appendRichRuns(container, runs) {
    (runs || []).forEach((run) => {
      let node = document.createTextNode(run.text);
      if (run.code) {
        const code = document.createElement("code");
        code.append(node);
        node = code;
      }
      if (run.bold) {
        const b = document.createElement("strong");
        b.append(node);
        node = b;
      }
      if (run.italic) {
        const i = document.createElement("em");
        i.append(node);
        node = i;
      }
      if (run.strikethrough) {
        const s = document.createElement("s");
        s.append(node);
        node = s;
      }
      if (run.href) {
        const a = document.createElement("a");
        a.href = run.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.append(node);
        node = a;
      }
      container.append(node);
    });
  }

  const HEADING_TAGS = { heading_1: "h4", heading_2: "h5", heading_3: "h6" };

  function renderExtraBlocks(container, blocks) {
    let listEl = null;
    let listTag = null;
    blocks.forEach((block) => {
      const isBulleted = block.type === "bulleted_list_item";
      const isNumbered = block.type === "numbered_list_item";
      if (isBulleted || isNumbered) {
        const wantTag = isBulleted ? "ul" : "ol";
        if (!listEl || listTag !== wantTag) {
          listEl = document.createElement(wantTag);
          listEl.className = "modal-extra-list";
          container.append(listEl);
          listTag = wantTag;
        }
        const li = document.createElement("li");
        appendRichRuns(li, block.runs);
        listEl.append(li);
        return;
      }
      listEl = null;
      listTag = null;
      const tag = HEADING_TAGS[block.type] || "p";
      const el = document.createElement(tag);
      el.className = "modal-extra-block";
      appendRichRuns(el, block.runs);
      container.append(el);
    });
  }

  function renderModal(detail) {
    els.modalGallery.innerHTML = "";
    if (detail.images && detail.images.length) {
      detail.images.forEach((url) => {
        const img = document.createElement("img");
        img.src = url;
        img.alt = detail.name;
        els.modalGallery.append(img);
      });
    } else {
      els.modalGallery.classList.add("empty");
    }

    els.modalTitle.innerHTML = "";
    const icon = iconNode(detail.icon, 20);
    if (icon) els.modalTitle.append(icon);
    els.modalTitle.append(document.createTextNode(detail.name));

    els.modalLines.innerHTML = "";
    (detail.lines || []).forEach((line) => {
      const p = document.createElement("p");
      p.style.margin = "0 0 4px";
      p.textContent = line;
      els.modalLines.append(p);
    });

    els.modalExtra.innerHTML = "";
    renderExtraBlocks(els.modalExtra, detail.extraBlocks || []);

    els.modalClaim.innerHTML = "";
    const entry = itemIndex.get(detail.id);
    const item = entry ? entry.item : detail;
    item.claimedBy = detail.claimedBy;
    const claimBox = buildClaimBox(item);
    els.modalClaim.append(claimBox);
    if (entry) entry.claimBoxes.push(claimBox);
  }

  function closeModal() {
    currentItemId = null;
    els.overlay.hidden = true;
  }

  els.modalClose.addEventListener("click", closeModal);
  els.overlay.addEventListener("click", (e) => {
    if (e.target === els.overlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.overlay.hidden) closeModal();
  });

  loadItems();
  setInterval(loadItems, REFRESH_MS);
})();
