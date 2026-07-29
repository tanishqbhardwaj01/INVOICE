/* Invoice Studio — live editor + multi-page preview */

(() => {
  "use strict";

  const MAX_CUSTOM_COLUMNS = 5;

  const COLUMN_POSITIONS = [
    { value: "before_item", label: "Before Item" },
    { value: "after_item", label: "After Item" },
    { value: "before_qty", label: "Before Qty" },
    { value: "after_qty", label: "After Qty" },
    { value: "before_rate", label: "Before Rate" },
    { value: "after_rate", label: "After Rate" },
    { value: "before_amount", label: "Before Amount" },
    { value: "after_amount", label: "After Amount" },
  ];

  const PAGE_ROWS = {
    // Fill the sheet: middle/continued pages pack denser; last page uses reserve
    A4: { portrait: 20, landscape: 11, continued: 22 },
    A3: { portrait: 34, landscape: 18, continued: 38 },
    Letter: { portrait: 18, landscape: 10, continued: 20 },
    Legal: { portrait: 26, landscape: 11, continued: 28 },
  };

  const CURRENCY = {
    INR: { symbol: "₹", locale: "en-IN" },
    USD: { symbol: "$", locale: "en-US" },
    EUR: { symbol: "€", locale: "de-DE" },
    GBP: { symbol: "£", locale: "en-GB" },
  };

  const state = {
    items: [],
    customColumns: [],
    charges: [],
    logoDataUrl: "",
    scaleRaf: 0,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDaysISO(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function defaultInvoiceNumber() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `INV-${pad(now.getDate())}${pad(now.getMonth() + 1)}${String(now.getFullYear()).slice(2)}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  }

  function money(amount, currency) {
    const meta = CURRENCY[currency] || CURRENCY.INR;
    const n = Number(amount) || 0;
    try {
      return new Intl.NumberFormat(meta.locale, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${meta.symbol}${n.toFixed(2)}`;
    }
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function nl2brSafe(str) {
    return escapeHtml(str).replace(/\n/g, "<br />");
  }

  /** Safe arithmetic: only digits, spaces, . + - * / ( ) */
  function evalArithmetic(raw) {
    const text = String(raw ?? "").trim();
    if (!text) return { ok: false, value: text };
    if (!/[+\-*/()]/.test(text)) return { ok: false, value: text };
    if (!/^[\d\s.+\-*/()]+$/.test(text)) return { ok: false, value: text };
    try {
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${text});`)();
      if (typeof result !== "number" || !Number.isFinite(result)) {
        return { ok: false, value: text };
      }
      const rounded = Math.round(result * 100) / 100;
      return { ok: true, value: String(rounded) };
    } catch {
      return { ok: false, value: text };
    }
  }

  function blankItem() {
    const custom = {};
    state.customColumns.forEach((col) => {
      custom[col.id] = "";
    });
    return { id: uid("item"), description: "", qty: 1, rate: 0, custom };
  }

  function blankCharge() {
    return { id: uid("chg"), label: "", amount: 0 };
  }

  function getDueMode() {
    const checked = $('input[name="dueMode"]:checked');
    return checked ? checked.value : "date";
  }

  function getPaymentTermsLabel() {
    const sel = $("#paymentTerms").value;
    if (sel === "custom") {
      return $("#customTerms").value.trim() || "Custom terms";
    }
    return sel;
  }

  function chargesTotal() {
    return state.charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  }

  function computeTotals() {
    const taxPercent = Number($("#taxPercent").value) || 0;
    const autoRound = $("#autoRound").checked;
    let subtotal = state.items.reduce((sum, item) => {
      const qty = Number(item.qty) || 0;
      const rate = Number(item.rate) || 0;
      return sum + qty * rate;
    }, 0);
    const charges = chargesTotal();
    let taxable = subtotal + charges;
    let tax = (taxable * taxPercent) / 100;
    let grand = taxable + tax;
    if (autoRound) {
      grand = Math.round(grand);
      tax = grand - taxable;
    }
    return { subtotal, charges, tax, taxPercent, grand };
  }

  function sortedColumns() {
    const order = COLUMN_POSITIONS.map((p) => p.value);
    return state.customColumns
      .slice()
      .sort((a, b) => order.indexOf(a.position) - order.indexOf(b.position) || a.name.localeCompare(b.name));
  }

  function columnsAt(position) {
    return sortedColumns().filter((c) => c.position === position);
  }

  function readForm() {
    const currency = $("#currency").value;
    const totals = computeTotals();
    const shipDifferent = $("#shipDifferent").checked;
    return {
      invoiceNumber: $("#invoiceNumber").value.trim() || "—",
      documentTitle: $("#documentTitle").value.trim() || "INVOICE",
      invoiceDate: $("#invoiceDate").value,
      currency,
      themeColor: $("#themeColor").value || "#4066E6",
      notes: $("#notes").value.trim(),
      terms: $("#terms").value.trim(),
      tagline: $("#fromTagline").value.trim(),
      from: {
        name: $("#fromName").value.trim() || "Your Company",
        address: $("#fromAddress").value.trim(),
        website: $("#fromWebsite").value.trim(),
        email: $("#fromEmail").value.trim(),
        phone: $("#fromPhone").value.trim(),
      },
      to: {
        name: $("#toName").value.trim(),
        address: $("#toAddress").value.trim(),
        email: $("#toEmail").value.trim(),
        phone: $("#toPhone").value.trim(),
      },
      shipDifferent,
      ship: shipDifferent
        ? {
            name: $("#shipName").value.trim(),
            address: $("#shipAddress").value.trim(),
            email: $("#shipEmail").value.trim(),
            phone: $("#shipPhone").value.trim(),
          }
        : {
            name: $("#toName").value.trim(),
            address: $("#toAddress").value.trim(),
            email: $("#toEmail").value.trim(),
            phone: $("#toPhone").value.trim(),
          },
      dueMode: getDueMode(),
      dueDate: $("#dueDate").value,
      paymentTerms: getPaymentTermsLabel(),
      paymentStatus: $("#paymentStatus").value,
      amountPaid: Number($("#amountPaid").value) || 0,
      bank: {
        name: $("#bankName").value.trim(),
        accountName: $("#accountName").value.trim(),
        accountNumber: $("#accountNumber").value.trim(),
        ifsc: $("#ifsc").value.trim(),
        upi: $("#upiId").value.trim(),
      },
      showQr: $("#showQr").checked,
      pageSize: $("#pageSize").value,
      orientation: $("#orientation").value,
      repeat: {
        header: $("#repeatHeader").checked,
        billTo: $("#repeatBillTo").checked,
        tableHeader: $("#repeatTableHeader").checked,
        banking: $("#repeatBanking").checked,
        pageNumbers: $("#repeatPageNumbers").checked,
      },
      customColumns: sortedColumns(),
      charges: state.charges.map((c) => ({ ...c })),
      logoDataUrl: state.logoDataUrl,
      items: state.items.map((item) => ({
        ...item,
        custom: { ...(item.custom || {}) },
        amount: (Number(item.qty) || 0) * (Number(item.rate) || 0),
      })),
      totals,
    };
  }

  function partyLines(party) {
    return [party.address, party.email, party.phone, party.website]
      .filter(Boolean)
      .join("\n");
  }

  function hasBanking(bank) {
    return Boolean(
      bank.name || bank.accountName || bank.accountNumber || bank.ifsc || bank.upi
    );
  }

  function buildUpiString(data) {
    if (!data.bank.upi) return "";
    const params = new URLSearchParams();
    params.set("pa", data.bank.upi);
    params.set("pn", data.from.name || "Payee");
    params.set("am", data.totals.grand.toFixed(2));
    params.set("cu", data.currency === "INR" ? "INR" : data.currency);
    params.set("tn", `Invoice ${data.invoiceNumber}`);
    return `upi://pay?${params.toString()}`;
  }

  function rowsPerPage(data, { continued = false } = {}) {
    const map = PAGE_ROWS[data.pageSize] || PAGE_ROWS.A4;
    let rows = continued
      ? map.continued || map[data.orientation] || map.portrait
      : map[data.orientation] || map.portrait;
    // First page also has bill/ship block
    if (!continued) rows = Math.max(10, rows - 6);
    if (data.customColumns.length >= 3) rows = Math.max(8, rows - 1);
    return rows;
  }

  function lastPageItemCapacity(data) {
    // Closing page must leave room for notes / banking / QR / totals
    let cap = data.pageSize === "A3" ? 10 : 5;
    if (data.orientation === "landscape") cap = Math.max(2, cap - 2);
    if (data.notes || data.terms) cap = Math.max(2, cap - 1);
    if (hasBanking(data.bank)) cap = Math.max(2, cap - 1);
    if (data.showQr && data.bank.upi) cap = Math.max(1, cap - 2);
    if (data.charges.length) cap = Math.max(1, cap - 1);
    return cap;
  }

  /**
   * Pack so every non-last page is as full as possible.
   * Last page only holds what fits with the summary block.
   */
  function chunkItemsSmart(items, data) {
    if (!items.length) return [[]];

    const firstRows = rowsPerPage(data, { continued: false });
    const midRows = rowsPerPage(data, { continued: true });
    const lastRows = Math.max(1, lastPageItemCapacity(data));

    if (items.length <= lastRows) return [items.slice()];

    const chunks = [];
    let remaining = items.slice();
    let isFirst = true;

    while (remaining.length > lastRows) {
      const cap = isFirst ? firstRows : midRows;
      const take = Math.min(cap, remaining.length - lastRows);
      if (take <= 0) break;
      chunks.push(remaining.splice(0, take));
      isFirst = false;
    }

    if (remaining.length) chunks.push(remaining);
    return chunks.length ? chunks : [[]];
  }

  /* ---------- Settings modal ---------- */

  function openSettings() {
    $("#settings-modal").hidden = false;
    document.body.classList.add("modal-open");
    $("#btn-settings").setAttribute("aria-expanded", "true");
    renderColumnsEditor();
  }

  function closeSettings() {
    $("#settings-modal").hidden = true;
    document.body.classList.remove("modal-open");
    $("#btn-settings").setAttribute("aria-expanded", "false");
  }

  function bindSettingsModal() {
    $("#btn-settings").addEventListener("click", openSettings);
    $$("[data-close-settings]").forEach((el) => el.addEventListener("click", closeSettings));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("#settings-modal").hidden) closeSettings();
    });
  }

  /* ---------- Custom columns (movable) ---------- */

  function positionOptions(selected) {
    return COLUMN_POSITIONS.map(
      (p) =>
        `<option value="${p.value}" ${p.value === selected ? "selected" : ""}>${escapeHtml(p.label)}</option>`
    ).join("");
  }

  function renderColumnsEditor() {
    const list = $("#columns-list");
    const empty = $("#columns-empty");
    const count = $("#columns-count");
    const addBtn = $("#btn-add-column");
    const n = state.customColumns.length;

    count.textContent = `Movable columns · arithmetic in cells · max ${MAX_CUSTOM_COLUMNS} · ${n}/${MAX_CUSTOM_COLUMNS}`;
    addBtn.disabled = n >= MAX_CUSTOM_COLUMNS;
    empty.hidden = n > 0;

    list.innerHTML = state.customColumns
      .map(
        (col, index) => `
      <div class="column-row" data-col-id="${col.id}">
        <span class="column-row__idx">${index + 1}</span>
        <label class="field field--grow">
          <span>Name</span>
          <input type="text" data-col-name value="${escapeHtml(col.name)}" placeholder="e.g. SKU / HSN" maxlength="24" />
        </label>
        <label class="field">
          <span>Position</span>
          <select data-col-position>${positionOptions(col.position || "after_item")}</select>
        </label>
        <div class="column-row__moves">
          <button type="button" class="btn btn--ghost btn--sm" data-move-col="-1" title="Move up">↑</button>
          <button type="button" class="btn btn--ghost btn--sm" data-move-col="1" title="Move down">↓</button>
          <button type="button" class="btn btn--ghost btn--sm" data-remove-col>Remove</button>
        </div>
      </div>`
      )
      .join("");
  }

  function syncItemsWithColumns() {
    const ids = new Set(state.customColumns.map((c) => c.id));
    state.items.forEach((item) => {
      item.custom = item.custom || {};
      state.customColumns.forEach((col) => {
        if (item.custom[col.id] === undefined) item.custom[col.id] = "";
      });
      Object.keys(item.custom).forEach((key) => {
        if (!ids.has(key)) delete item.custom[key];
      });
    });
  }

  function bindColumns() {
    $("#btn-add-column").addEventListener("click", () => {
      if (state.customColumns.length >= MAX_CUSTOM_COLUMNS) return;
      state.customColumns.push({
        id: uid("col"),
        name: `Column ${state.customColumns.length + 1}`,
        position: "after_item",
      });
      syncItemsWithColumns();
      renderColumnsEditor();
      renderItemsEditor();
      renderPages();
    });

    $("#columns-list").addEventListener("input", (e) => {
      const input = e.target.closest("[data-col-name]");
      if (!input) return;
      const row = input.closest("[data-col-id]");
      const col = state.customColumns.find((c) => c.id === row.dataset.colId);
      if (!col) return;
      col.name = input.value;
      renderItemsEditor();
      renderPages();
    });

    $("#columns-list").addEventListener("change", (e) => {
      const select = e.target.closest("[data-col-position]");
      if (!select) return;
      const row = select.closest("[data-col-id]");
      const col = state.customColumns.find((c) => c.id === row.dataset.colId);
      if (!col) return;
      col.position = select.value;
      renderColumnsEditor();
      renderItemsEditor();
      renderPages();
    });

    $("#columns-list").addEventListener("click", (e) => {
      const row = e.target.closest("[data-col-id]");
      if (!row) return;
      const id = row.dataset.colId;
      const idx = state.customColumns.findIndex((c) => c.id === id);
      if (idx < 0) return;

      const removeBtn = e.target.closest("[data-remove-col]");
      if (removeBtn) {
        state.customColumns.splice(idx, 1);
        syncItemsWithColumns();
        renderColumnsEditor();
        renderItemsEditor();
        renderPages();
        return;
      }

      const moveBtn = e.target.closest("[data-move-col]");
      if (moveBtn) {
        const dir = Number(moveBtn.dataset.moveCol);
        const next = idx + dir;
        if (next < 0 || next >= state.customColumns.length) return;
        const tmp = state.customColumns[idx];
        state.customColumns[idx] = state.customColumns[next];
        state.customColumns[next] = tmp;
        renderColumnsEditor();
        renderItemsEditor();
        renderPages();
      }
    });
  }

  /* ---------- Charges ---------- */

  function renderChargesEditor() {
    const list = $("#charges-list");
    const empty = $("#charges-empty");
    empty.hidden = state.charges.length > 0;
    list.innerHTML = state.charges
      .map(
        (c) => `
      <div class="charge-row" data-charge-id="${c.id}">
        <label class="field field--grow">
          <span>Label</span>
          <input type="text" data-charge-label value="${escapeHtml(c.label)}" placeholder="e.g. Shipping / Discount" />
        </label>
        <label class="field">
          <span>Amount</span>
          <input type="number" data-charge-amount step="0.01" value="${c.amount}" />
        </label>
        <button type="button" class="btn btn--ghost btn--sm" data-remove-charge>Remove</button>
      </div>`
      )
      .join("");
  }

  function bindCharges() {
    $("#btn-add-charge").addEventListener("click", () => {
      state.charges.push(blankCharge());
      renderChargesEditor();
      updateEditorTotals();
      renderPages();
    });

    $("#charges-list").addEventListener("input", (e) => {
      const row = e.target.closest("[data-charge-id]");
      if (!row) return;
      const charge = state.charges.find((c) => c.id === row.dataset.chargeId);
      if (!charge) return;
      if (e.target.matches("[data-charge-label]")) charge.label = e.target.value;
      if (e.target.matches("[data-charge-amount]")) charge.amount = Number(e.target.value) || 0;
      updateEditorTotals();
      renderPages();
    });

    $("#charges-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-charge]");
      if (!btn) return;
      const row = btn.closest("[data-charge-id]");
      state.charges = state.charges.filter((c) => c.id !== row.dataset.chargeId);
      renderChargesEditor();
      updateEditorTotals();
      renderPages();
    });
  }

  /* ---------- Items editor ---------- */

  function buildColumnSlots() {
    return {
      before_item: columnsAt("before_item"),
      after_item: columnsAt("after_item"),
      before_qty: columnsAt("before_qty"),
      after_qty: columnsAt("after_qty"),
      before_rate: columnsAt("before_rate"),
      after_rate: columnsAt("after_rate"),
      before_amount: columnsAt("before_amount"),
      after_amount: columnsAt("after_amount"),
    };
  }

  function thForCols(cols) {
    return cols.map((col) => `<th class="custom-col">${escapeHtml(col.name || "Column")}</th>`).join("");
  }

  function tdForCols(cols, item) {
    return cols
      .map(
        (col) =>
          `<td><input type="text" data-custom="${col.id}" value="${escapeHtml((item.custom && item.custom[col.id]) || "")}" placeholder="${escapeHtml(col.name)} · e.g. 10*5" /></td>`
      )
      .join("");
  }

  function renderItemsEditor() {
    const head = $("#items-head");
    const body = $("#items-body");
    const s = buildColumnSlots();

    head.innerHTML = `<tr>
      ${thForCols(s.before_item)}
      <th>Description</th>
      ${thForCols(s.after_item)}
      ${thForCols(s.before_qty)}
      <th>Qty</th>
      ${thForCols(s.after_qty)}
      ${thForCols(s.before_rate)}
      <th>Rate</th>
      ${thForCols(s.after_rate)}
      ${thForCols(s.before_amount)}
      <th>Amount</th>
      ${thForCols(s.after_amount)}
      <th></th>
    </tr>`;

    body.innerHTML = state.items
      .map((item) => {
        const amount = (Number(item.qty) || 0) * (Number(item.rate) || 0);
        return `
        <tr data-id="${item.id}">
          ${tdForCols(s.before_item, item)}
          <td><input type="text" data-field="description" value="${escapeHtml(item.description)}" placeholder="Item name / description" /></td>
          ${tdForCols(s.after_item, item)}
          ${tdForCols(s.before_qty, item)}
          <td><input type="number" data-field="qty" min="0" step="1" value="${item.qty}" /></td>
          ${tdForCols(s.after_qty, item)}
          ${tdForCols(s.before_rate, item)}
          <td><input type="number" data-field="rate" min="0" step="0.01" value="${item.rate}" /></td>
          ${tdForCols(s.after_rate, item)}
          ${tdForCols(s.before_amount, item)}
          <td class="amount-cell">${money(amount, $("#currency").value)}</td>
          ${tdForCols(s.after_amount, item)}
          <td><button type="button" class="btn btn--icon" data-remove title="Remove item" aria-label="Remove item">×</button></td>
        </tr>`;
      })
      .join("");
  }

  function updateEditorTotals() {
    const currency = $("#currency").value;
    const { subtotal, charges, tax, grand } = computeTotals();
    $("#editorSubtotal").textContent = money(subtotal, currency);
    $("#editorCharges").textContent = money(charges, currency);
    $("#editorTax").textContent = money(tax, currency);
    $("#editorGrand").textContent = money(grand, currency);
  }

  function syncDueModeUI() {
    $("#dueDateField").hidden = false;
    $("#paymentTermsField").hidden = false;
    $("#customTermsField").hidden = $("#paymentTerms").value !== "custom";
  }

  function syncPaymentStatusUI() {
    const status = $("#paymentStatus").value;
    $("#amountPaidField").hidden = status !== "Partially paid";
  }

  function syncShipUI() {
    const different = $("#shipDifferent").checked;
    $("#shipSameHint").hidden = different;
    ["shipName", "shipAddress", "shipEmail", "shipPhone"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = !different;
      el.closest(".field").style.opacity = different ? "1" : "0.55";
    });
  }

  function headerHTML(data, { continued }) {
    if (!data.repeat.header && continued) return "";
    const logo = data.logoDataUrl
      ? `<img class="doc-logo" src="${data.logoDataUrl}" alt="Logo" />`
      : "";
    const metaParts = [
      data.from.address,
      data.from.website,
      data.from.email,
      data.from.phone,
    ].filter(Boolean);
    return `
      <header class="doc-header">
        <div class="doc-brand">
          ${logo}
          <div>
            <p class="doc-company-name">${escapeHtml(data.from.name)}</p>
            ${data.tagline ? `<p class="doc-tagline">${escapeHtml(data.tagline)}</p>` : ""}
            ${metaParts.length ? `<p class="doc-company-meta">${nl2brSafe(metaParts.join("\n"))}</p>` : ""}
          </div>
        </div>
        <div class="doc-title-block">
          <h3 class="doc-title">${escapeHtml(data.documentTitle)}</h3>
          <div class="doc-meta">
            <div><strong>Invoice #</strong> ${escapeHtml(data.invoiceNumber)}</div>
            <div><strong>Date</strong> ${escapeHtml(data.invoiceDate || "—")}</div>
            ${
              data.dueMode === "date"
                ? `<div><strong>Due date</strong> ${escapeHtml(data.dueDate || "—")}</div>`
                : `<div><strong>Terms</strong> ${escapeHtml(data.paymentTerms)}</div>`
            }
          </div>
        </div>
      </header>`;
  }

  function billShipHTML(data, { continued }) {
    if (continued && !data.repeat.billTo) return "";
    const toLines = [data.to.address, data.to.email, data.to.phone].filter(Boolean).join("\n");
    const shipLines = [data.ship.address, data.ship.email, data.ship.phone].filter(Boolean).join("\n");
    return `
      <section class="doc-parties">
        <div>
          <p class="doc-party-label">Bill to</p>
          <p class="doc-party-name">${escapeHtml(data.to.name || "—")}</p>
          <p class="doc-party-body">${nl2brSafe(toLines)}</p>
        </div>
        <div>
          <p class="doc-party-label">Ship to</p>
          <p class="doc-party-name">${escapeHtml(data.ship.name || "—")}</p>
          <p class="doc-party-body">${nl2brSafe(shipLines || (data.shipDifferent ? "" : "Same as bill to"))}</p>
        </div>
      </section>`;
  }

  function tableHTML(data, pageItems, { continued, isLast, showHeader }) {
    const s = {
      before_item: data.customColumns.filter((c) => c.position === "before_item"),
      after_item: data.customColumns.filter((c) => c.position === "after_item"),
      before_qty: data.customColumns.filter((c) => c.position === "before_qty"),
      after_qty: data.customColumns.filter((c) => c.position === "after_qty"),
      before_rate: data.customColumns.filter((c) => c.position === "before_rate"),
      after_rate: data.customColumns.filter((c) => c.position === "after_rate"),
      before_amount: data.customColumns.filter((c) => c.position === "before_amount"),
      after_amount: data.customColumns.filter((c) => c.position === "after_amount"),
    };

    const headCols = (cols) =>
      cols.map((col) => `<th>${escapeHtml(col.name || "Column")}</th>`).join("");
    const cellCols = (cols, item) =>
      cols
        .map((col) => `<td>${escapeHtml((item.custom && item.custom[col.id]) || "—")}</td>`)
        .join("");

    const colCount = 4 + data.customColumns.length;
    const header = showHeader
      ? `<thead><tr>
          ${headCols(s.before_item)}
          <th>Item</th>
          ${headCols(s.after_item)}
          ${headCols(s.before_qty)}
          <th class="num">Qty</th>
          ${headCols(s.after_qty)}
          ${headCols(s.before_rate)}
          <th class="num">Rate</th>
          ${headCols(s.after_rate)}
          ${headCols(s.before_amount)}
          <th class="num">Amount</th>
          ${headCols(s.after_amount)}
        </tr></thead>`
      : "";

    const rows =
      pageItems.length === 0
        ? `<tr><td colspan="${colCount}">No items</td></tr>`
        : pageItems
            .map(
              (item) => `<tr>
              ${cellCols(s.before_item, item)}
              <td>${escapeHtml(item.description || "Untitled item")}</td>
              ${cellCols(s.after_item, item)}
              ${cellCols(s.before_qty, item)}
              <td class="num">${Number(item.qty) || 0}</td>
              ${cellCols(s.after_qty, item)}
              ${cellCols(s.before_rate, item)}
              <td class="num">${money(item.rate, data.currency)}</td>
              ${cellCols(s.after_rate, item)}
              ${cellCols(s.before_amount, item)}
              <td class="num">${money(item.amount, data.currency)}</td>
              ${cellCols(s.after_amount, item)}
            </tr>`
            )
            .join("");

    const cont = continued
      ? `<p class="doc-continuation">Continued from previous page</p>`
      : !isLast && pageItems.length
        ? `<p class="doc-continuation">Continues on next page</p>`
        : "";

    return `${cont}<table class="doc-table">${header}<tbody>${rows}</tbody></table>`;
  }

  function bankingHTML(data) {
    if (!hasBanking(data.bank)) return "";
    const lines = [
      data.bank.name && `Bank: ${data.bank.name}`,
      data.bank.accountName && `Account name: ${data.bank.accountName}`,
      data.bank.accountNumber && `Account no: ${data.bank.accountNumber}`,
      data.bank.ifsc && `IFSC: ${data.bank.ifsc}`,
      data.bank.upi && `UPI: ${data.bank.upi}`,
    ]
      .filter(Boolean)
      .join("\n");
    return `<div class="doc-banking"><h4>Banking details</h4><p>${nl2brSafe(lines)}</p></div>`;
  }

  function totalsHTML(data) {
    const chargeRows = data.charges
      .filter((c) => c.label || c.amount)
      .map(
        (c) =>
          `<div class="doc-totals-row"><span>${escapeHtml(c.label || "Charge")}</span><span>${money(c.amount, data.currency)}</span></div>`
      )
      .join("");
    return `
      <div class="doc-totals">
        <div class="doc-totals-row"><span>Items total</span><span>${money(data.totals.subtotal, data.currency)}</span></div>
        ${chargeRows}
        <div class="doc-totals-row"><span>Tax (${data.totals.taxPercent}%)</span><span>${money(data.totals.tax, data.currency)}</span></div>
        <div class="doc-totals-row grand"><span>TOTAL</span><span>${money(data.totals.grand, data.currency)}</span></div>
        ${
          data.paymentStatus === "Partially paid"
            ? `<div class="doc-totals-row"><span>Paid</span><span>${money(data.amountPaid, data.currency)}</span></div>
               <div class="doc-totals-row"><span>Balance</span><span>${money(Math.max(0, data.totals.grand - data.amountPaid), data.currency)}</span></div>`
            : ""
        }
      </div>`;
  }

  function notesHTML(data) {
    if (!data.notes && !data.terms) return "";
    return `
      <div class="doc-notes">
        ${data.notes ? `<h4>Notes</h4><p>${nl2brSafe(data.notes)}</p>` : ""}
        ${data.terms ? `<h4 style="margin-top:3mm">Terms &amp; conditions</h4><p>${nl2brSafe(data.terms)}</p>` : ""}
      </div>`;
  }

  function applyTheme(color) {
    document.documentElement.style.setProperty("--brand", color);
    const hex = $("#themeColorHex");
    if (hex) hex.textContent = String(color || "#4066E6").toUpperCase();
  }

  function renderPages() {
    const data = readForm();
    applyTheme(data.themeColor);
    const root = $("#pages-root");
    const scaleWrap = $("#preview-scale");

    root.style.transform = "none";
    root.style.width = "";
    scaleWrap.style.height = "auto";

    const chunks = chunkItemsSmart(data.items, data);
    const totalPages = chunks.length;

    $("#previewMeta").textContent = `Live document — ${data.pageSize} · ${
      data.orientation[0].toUpperCase() + data.orientation.slice(1)
    } · ${totalPages} page${totalPages === 1 ? "" : "s"}`;

    const pill = $("#invoicePill");
    if (pill) pill.textContent = `INV | ${data.invoiceNumber.replace(/^INV-?/i, "")}`;

    root.innerHTML = "";
    root.style.setProperty("--doc-accent", data.themeColor);

    chunks.forEach((pageItems, index) => {
      const pageNo = index + 1;
      const continued = index > 0;
      const isLast = index === totalPages - 1;
      const showTableHeader = data.repeat.tableHeader || !continued;

      const sheet = document.createElement("article");
      sheet.className = "page-sheet";
      sheet.dataset.size = data.pageSize;
      sheet.dataset.orientation = data.orientation;
      sheet.style.setProperty("--doc-accent", data.themeColor);

      const bankingOnThisPage =
        hasBanking(data.bank) && (isLast || data.repeat.banking);
      const qrNeeded = isLast && data.showQr && data.bank.upi && data.totals.grand > 0;

      let summaryBlock = "";
      if (isLast) {
        summaryBlock = `<section class="page-sheet__summary">
            <div class="doc-bottom">
              <div class="doc-bottom__meta">
                ${notesHTML(data)}
                ${bankingOnThisPage ? bankingHTML(data) : ""}
                <div class="doc-qr-wrap" data-qr-slot="${qrNeeded ? "1" : "0"}"></div>
              </div>
              <div class="doc-bottom__totals">${totalsHTML(data)}</div>
            </div>
          </section>`;
      } else if (bankingOnThisPage) {
        summaryBlock = `<section class="page-sheet__summary">
            <div class="doc-bottom">
              <div class="doc-bottom__meta">${bankingHTML(data)}</div>
              <div class="doc-bottom__totals"></div>
            </div>
          </section>`;
      }

      sheet.innerHTML = `
        <div class="page-sheet__inner">
          <div class="page-sheet__main">
            ${headerHTML(data, { continued })}
            ${billShipHTML(data, { continued })}
            <div class="doc-table-box">
              ${tableHTML(data, pageItems, { continued, isLast, showHeader: showTableHeader })}
            </div>
          </div>
          ${summaryBlock}
          <footer class="page-sheet__footer">
            <span class="powered">Powered by Number7 AI</span>
            ${
              data.repeat.pageNumbers
                ? `<span class="page-num">Page ${pageNo} of ${totalPages}</span>`
                : "<span></span>"
            }
          </footer>
        </div>`;

      root.appendChild(sheet);

      if (qrNeeded) {
        const slot = sheet.querySelector('[data-qr-slot="1"]');
        const upi = buildUpiString(data);
        const qrBox = document.createElement("div");
        qrBox.className = "doc-qr";
        slot.appendChild(qrBox);
        const caption = document.createElement("div");
        caption.className = "doc-qr-caption";
        caption.innerHTML = `Scan to pay<br /><strong>${money(data.totals.grand, data.currency)}</strong><br />${escapeHtml(data.bank.upi)}`;
        slot.appendChild(caption);
        if (window.QRCode) {
          new QRCode(qrBox, {
            text: upi,
            width: 72,
            height: 72,
            correctLevel: QRCode.CorrectLevel.M,
          });
        } else {
          qrBox.textContent = "QR unavailable";
        }
      }
    });

    scheduleFitPreviewScale();
  }

  function fitPreviewScale() {
    const stage = $("#preview-stage");
    const scaleWrap = $("#preview-scale");
    const root = $("#pages-root");
    const first = $(".page-sheet", scaleWrap);
    if (!first || !stage || !root) return;

    root.style.transform = "none";
    scaleWrap.style.height = "auto";
    void first.offsetWidth;

    const stageWidth = Math.max(0, stage.clientWidth - 32);
    const sheetWidth = first.offsetWidth;
    if (!sheetWidth || !stageWidth) return;

    const scale = Math.min(1, stageWidth / sheetWidth);
    root.style.transform = `scale(${scale})`;
    root.style.transformOrigin = "top center";
    scaleWrap.style.height = `${Math.ceil(root.scrollHeight * scale)}px`;
    scaleWrap.style.width = "100%";
    scaleWrap.style.overflow = "hidden";
  }

  function scheduleFitPreviewScale() {
    cancelAnimationFrame(state.scaleRaf);
    state.scaleRaf = requestAnimationFrame(() => {
      fitPreviewScale();
      state.scaleRaf = requestAnimationFrame(() => fitPreviewScale());
    });
  }

  function bindSectionNav() {
    $$(".tabs__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.section;
        $$(".tabs__btn").forEach((b) => b.classList.toggle("is-active", b === btn));
        $$(".editor-section").forEach((sec) => {
          const match = sec.id === `section-${id}`;
          sec.classList.toggle("is-active", match);
          sec.hidden = !match;
        });
      });
    });
  }

  function bindItems() {
    $("#btn-add-item").addEventListener("click", () => {
      state.items.push(blankItem());
      renderItemsEditor();
      updateEditorTotals();
      renderPages();
    });

    $("#items-body").addEventListener("input", (e) => {
      const customInput = e.target.closest("input[data-custom]");
      const fieldInput = e.target.closest("input[data-field]");
      const row = e.target.closest("tr");
      if (!row) return;
      const item = state.items.find((i) => i.id === row.dataset.id);
      if (!item) return;

      if (customInput) {
        item.custom = item.custom || {};
        item.custom[customInput.dataset.custom] = customInput.value;
        renderPages();
        return;
      }

      if (!fieldInput) return;
      const field = fieldInput.dataset.field;
      item[field] = field === "description" ? fieldInput.value : Number(fieldInput.value);
      const amountCell = row.querySelector(".amount-cell");
      if (amountCell) {
        amountCell.textContent = money(
          (Number(item.qty) || 0) * (Number(item.rate) || 0),
          $("#currency").value
        );
      }
      updateEditorTotals();
      renderPages();
    });

    // Evaluate arithmetic expressions on blur in custom columns
    $("#items-body").addEventListener("focusout", (e) => {
      const customInput = e.target.closest("input[data-custom]");
      if (!customInput) return;
      const row = customInput.closest("tr");
      const item = state.items.find((i) => i.id === row.dataset.id);
      if (!item) return;
      const evaluated = evalArithmetic(customInput.value);
      if (evaluated.ok) {
        customInput.value = evaluated.value;
        item.custom[customInput.dataset.custom] = evaluated.value;
        customInput.classList.add("is-calculated");
        renderPages();
      }
    });

    $("#items-body").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove]");
      if (!btn) return;
      const row = btn.closest("tr");
      if (state.items.length === 1) state.items[0] = blankItem();
      else state.items = state.items.filter((i) => i.id !== row.dataset.id);
      renderItemsEditor();
      updateEditorTotals();
      renderPages();
    });
  }

  function syncPageSizeControls(sourceId, value) {
    if (sourceId !== "pageSize") $("#pageSize").value = value;
    if (sourceId !== "pageSizeQuick") $("#pageSizeQuick").value = value;
  }

  function bindForm() {
    const formIds = [
      "invoiceNumber",
      "documentTitle",
      "invoiceDate",
      "currency",
      "themeColor",
      "notes",
      "terms",
      "fromTagline",
      "fromName",
      "fromAddress",
      "fromWebsite",
      "fromEmail",
      "fromPhone",
      "toName",
      "toAddress",
      "toEmail",
      "toPhone",
      "shipName",
      "shipAddress",
      "shipEmail",
      "shipPhone",
      "shipDifferent",
      "dueDate",
      "paymentTerms",
      "customTerms",
      "paymentStatus",
      "amountPaid",
      "bankName",
      "accountName",
      "accountNumber",
      "ifsc",
      "upiId",
      "showQr",
      "taxPercent",
      "autoRound",
      "pageSize",
      "orientation",
      "repeatHeader",
      "repeatBillTo",
      "repeatTableHeader",
      "repeatBanking",
      "repeatPageNumbers",
    ];

    formIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const evt =
        el.type === "checkbox" || el.tagName === "SELECT" || el.type === "color"
          ? "change"
          : "input";
      el.addEventListener(evt, () => {
        if (id === "pageSize") syncPageSizeControls("pageSize", el.value);
        if (id === "paymentTerms") syncDueModeUI();
        if (id === "paymentStatus") syncPaymentStatusUI();
        if (id === "shipDifferent") syncShipUI();
        if (id === "currency" || id === "taxPercent" || id === "autoRound") {
          renderItemsEditor();
          updateEditorTotals();
        }
        renderPages();
      });
    });

    $$('input[name="dueMode"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        syncDueModeUI();
        renderPages();
      });
    });

    $("#pageSizeQuick").addEventListener("change", (e) => {
      syncPageSizeControls("pageSizeQuick", e.target.value);
      renderPages();
    });

    $("#logoFile").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) {
        state.logoDataUrl = "";
        renderPages();
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        state.logoDataUrl = String(reader.result || "");
        renderPages();
      };
      reader.readAsDataURL(file);
    });

    $("#btn-reset").addEventListener("click", () => {
      if (!confirm("Reset the invoice to defaults?")) return;
      initDefaults();
    });

    $("#btn-print").addEventListener("click", () => window.print());
    const printIcon = $("#btn-print-icon");
    if (printIcon) printIcon.addEventListener("click", () => window.print());
    const downloadBtn = $("#btn-download");
    if (downloadBtn) downloadBtn.addEventListener("click", () => window.print());

    window.addEventListener("resize", () => scheduleFitPreviewScale());
  }

  function initDefaults() {
    $("#invoiceNumber").value = defaultInvoiceNumber();
    $("#documentTitle").value = "INVOICE";
    $("#invoiceDate").value = todayISO();
    $("#dueDate").value = addDaysISO(30);
    $("#currency").value = "INR";
    $("#themeColor").value = "#4066E6";
    $("#notes").value = "Thank you for your business.";
    $("#terms").value = "";
    $("#fromTagline").value = "Your Partner in Growth";
    $("#fromName").value = "Number7 Studio";
    $("#fromAddress").value = "12 Innovation Lane\nBengaluru, KA 560001\nIndia";
    $("#fromWebsite").value = "www.number7ai.com";
    $("#fromEmail").value = "billing@number7ai.com";
    $("#fromPhone").value = "+91 98765 43210";
    $("#toName").value = "Acme Retail Pvt Ltd";
    $("#toAddress").value = "88 Market Road\nMumbai, MH 400001";
    $("#toEmail").value = "ap@acme.example";
    $("#toPhone").value = "+91 91234 56789";
    $("#shipDifferent").checked = false;
    $("#shipName").value = "";
    $("#shipAddress").value = "";
    $("#shipEmail").value = "";
    $("#shipPhone").value = "";
    $("#taxPercent").value = "18";
    $("#autoRound").checked = false;
    $('input[name="dueMode"][value="date"]').checked = true;
    $("#paymentTerms").value = "Net 30";
    $("#customTerms").value = "";
    $("#paymentStatus").value = "Unpaid";
    $("#amountPaid").value = "0";
    $("#bankName").value = "HDFC Bank";
    $("#accountName").value = "Number7 Studio";
    $("#accountNumber").value = "50200012345678";
    $("#ifsc").value = "HDFC0001234";
    $("#upiId").value = "number7@hdfc";
    $("#showQr").checked = true;
    $("#pageSize").value = "A4";
    $("#pageSizeQuick").value = "A4";
    $("#orientation").value = "portrait";
    $("#repeatHeader").checked = true;
    $("#repeatBillTo").checked = false;
    $("#repeatTableHeader").checked = true;
    $("#repeatBanking").checked = false;
    $("#repeatPageNumbers").checked = true;
    $("#logoFile").value = "";
    state.logoDataUrl = "";
    state.customColumns = [];
    state.charges = [];
    state.items = Array.from({ length: 36 }, (_, i) => ({
      id: uid("item"),
      description: `Service line ${i + 1}`,
      qty: 1,
      rate: 1000 + i * 250,
      custom: {},
    }));
    syncDueModeUI();
    syncPaymentStatusUI();
    syncShipUI();
    renderColumnsEditor();
    renderChargesEditor();
    renderItemsEditor();
    updateEditorTotals();
    renderPages();
  }

  function boot() {
    bindSectionNav();
    bindSettingsModal();
    bindColumns();
    bindCharges();
    bindItems();
    bindForm();
    initDefaults();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
