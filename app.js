/* Invoice Studio — live editor + multi-page preview */

(() => {
  "use strict";

  const PAGE_ROWS = {
    A4: { portrait: 12, landscape: 7 },
    A3: { portrait: 22, landscape: 12 },
    Letter: { portrait: 11, landscape: 7 },
    Legal: { portrait: 16, landscape: 7 },
  };

  // Rows reserved on the last page for notes / banking / QR / totals
  const LAST_PAGE_RESERVE = {
    base: 3,
    notes: 2,
    banking: 3,
    qr: 4,
  };

  const CURRENCY = {
    INR: { symbol: "₹", locale: "en-IN" },
    USD: { symbol: "$", locale: "en-US" },
    EUR: { symbol: "€", locale: "de-DE" },
    GBP: { symbol: "£", locale: "en-GB" },
  };

  const state = {
    items: [{ id: uid(), description: "", qty: 1, rate: 0 }],
    logoDataUrl: "",
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function uid() {
    return `item_${Math.random().toString(36).slice(2, 9)}`;
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

  function computeTotals() {
    const taxPercent = Number($("#taxPercent").value) || 0;
    const autoRound = $("#autoRound").checked;
    let subtotal = state.items.reduce((sum, item) => {
      const qty = Number(item.qty) || 0;
      const rate = Number(item.rate) || 0;
      return sum + qty * rate;
    }, 0);
    let tax = (subtotal * taxPercent) / 100;
    let grand = subtotal + tax;
    if (autoRound) {
      grand = Math.round(grand);
      tax = grand - subtotal;
    }
    return { subtotal, tax, taxPercent, grand };
  }

  function readForm() {
    const currency = $("#currency").value;
    const totals = computeTotals();
    const dueMode = getDueMode();
    return {
      invoiceNumber: $("#invoiceNumber").value.trim() || "—",
      documentTitle: $("#documentTitle").value.trim() || "INVOICE",
      invoiceDate: $("#invoiceDate").value,
      currency,
        themeColor: $("#themeColor").value || "#4066E6",
      notes: $("#notes").value.trim(),
      terms: $("#terms").value.trim(),
      from: {
        name: $("#fromName").value.trim() || "Your Company",
        address: $("#fromAddress").value.trim(),
        city: $("#fromCity").value.trim(),
        country: $("#fromCountry").value.trim(),
        contact: $("#fromContact").value.trim(),
      },
      to: {
        name: $("#toName").value.trim(),
        address: $("#toAddress").value.trim(),
        city: $("#toCity").value.trim(),
        country: $("#toCountry").value.trim(),
        contact: $("#toContact").value.trim(),
      },
      dueMode,
      dueDate: $("#dueDate").value,
      paymentTerms: getPaymentTermsLabel(),
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
      logoDataUrl: state.logoDataUrl,
      items: state.items.map((item) => ({
        ...item,
        amount: (Number(item.qty) || 0) * (Number(item.rate) || 0),
      })),
      totals,
    };
  }

  function partyLines(party) {
    return [party.address, party.city, party.country, party.contact]
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

  function rowsPerPage(data) {
    const map = PAGE_ROWS[data.pageSize] || PAGE_ROWS.A4;
    return map[data.orientation] || map.portrait;
  }

  function lastPageItemCapacity(data) {
    const full = rowsPerPage(data);
    let reserve = LAST_PAGE_RESERVE.base;
    if (data.notes || data.terms) reserve += LAST_PAGE_RESERVE.notes;
    if (hasBanking(data.bank)) reserve += LAST_PAGE_RESERVE.banking;
    if (data.showQr && data.bank.upi) reserve += LAST_PAGE_RESERVE.qr;
    return Math.max(1, full - reserve);
  }

  function chunkItems(items, fullRows, lastRows) {
    if (!items.length) return [[]];
    const maxLast = Math.max(1, Math.min(lastRows, fullRows));
    if (items.length <= maxLast) return [items.slice()];

    const chunks = [];
    let remaining = items.slice();

    while (remaining.length > maxLast) {
      const overflow = remaining.length - maxLast;
      const take = Math.min(fullRows, overflow);
      chunks.push(remaining.splice(0, take));
    }

    chunks.push(remaining);
    return chunks;
  }

  function renderItemsEditor() {
    const body = $("#items-body");
    body.innerHTML = state.items
      .map((item) => {
        const amount = (Number(item.qty) || 0) * (Number(item.rate) || 0);
        return `
        <tr data-id="${item.id}">
          <td><input type="text" data-field="description" value="${escapeHtml(item.description)}" placeholder="Item name / description" /></td>
          <td><input type="number" data-field="qty" min="0" step="1" value="${item.qty}" /></td>
          <td><input type="number" data-field="rate" min="0" step="0.01" value="${item.rate}" /></td>
          <td class="amount-cell">${money(amount, $("#currency").value)}</td>
          <td><button type="button" class="btn btn--icon" data-remove title="Remove item" aria-label="Remove item">×</button></td>
        </tr>`;
      })
      .join("");
  }

  function updateEditorTotals() {
    const currency = $("#currency").value;
    const { subtotal, tax, grand } = computeTotals();
    $("#editorSubtotal").textContent = money(subtotal, currency);
    $("#editorTax").textContent = money(tax, currency);
    $("#editorGrand").textContent = money(grand, currency);
  }

  function syncDueModeUI() {
    const mode = getDueMode();
    $("#dueDateField").hidden = mode !== "date";
    $("#paymentTermsField").hidden = mode !== "terms";
    const isCustom = mode === "terms" && $("#paymentTerms").value === "custom";
    $("#customTermsField").hidden = !isCustom;
  }

  function headerHTML(data, { continued }) {
    if (!data.repeat.header && continued) return "";
    const logo = data.logoDataUrl
      ? `<img class="doc-logo" src="${data.logoDataUrl}" alt="Logo" />`
      : "";
    const meta = partyLines(data.from);
    return `
      <header class="doc-header">
        <div class="doc-brand">
          ${logo}
          <div>
            <p class="doc-company-name">${escapeHtml(data.from.name)}</p>
            ${meta ? `<p class="doc-company-meta">${nl2brSafe(meta)}</p>` : ""}
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

  function billToHTML(data, { continued }) {
    if (continued && !data.repeat.billTo) return "";
    if (!continued && !data.to.name && !partyLines(data.to)) {
      return `
        <section class="doc-parties">
          <div>
            <p class="doc-party-label">Bill to</p>
            <p class="doc-party-name">—</p>
          </div>
        </section>`;
    }
    if (continued && !data.repeat.billTo) return "";
    return `
      <section class="doc-parties">
        <div>
          <p class="doc-party-label">Bill to</p>
          <p class="doc-party-name">${escapeHtml(data.to.name || "—")}</p>
          <p class="doc-party-body">${nl2brSafe(partyLines(data.to))}</p>
        </div>
      </section>`;
  }

  function tableHTML(data, pageItems, { continued, isLast, showHeader }) {
    const header = showHeader
      ? `<thead>
          <tr>
            <th>Item</th>
            <th class="num">Qty</th>
            <th class="num">Rate</th>
            <th class="num">Amount</th>
          </tr>
        </thead>`
      : "";

    const rows =
      pageItems.length === 0
        ? `<tr>
            <td>No items</td>
            <td class="num">—</td>
            <td class="num">—</td>
            <td class="num">—</td>
          </tr>`
        : pageItems
            .map(
              (item) => `<tr>
              <td>${escapeHtml(item.description || "Untitled item")}</td>
              <td class="num">${Number(item.qty) || 0}</td>
              <td class="num">${money(item.rate, data.currency)}</td>
              <td class="num">${money(item.amount, data.currency)}</td>
            </tr>`
            )
            .join("");

    const cont =
      continued
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
    return `
      <div class="doc-banking">
        <h4>Banking details</h4>
        <p>${nl2brSafe(lines)}</p>
      </div>`;
  }

  function totalsHTML(data) {
    return `
      <div class="doc-totals">
        <div class="doc-totals-row"><span>Items total</span><span>${money(data.totals.subtotal, data.currency)}</span></div>
        <div class="doc-totals-row"><span>Tax (${data.totals.taxPercent}%)</span><span>${money(data.totals.tax, data.currency)}</span></div>
        <div class="doc-totals-row grand"><span>TOTAL</span><span>${money(data.totals.grand, data.currency)}</span></div>
      </div>`;
  }

  function notesHTML(data) {
    if (!data.notes && !data.terms) return "";
    return `
      <div class="doc-notes">
        ${data.notes ? `<h4>Notes</h4><p>${nl2brSafe(data.notes)}</p>` : ""}
        ${data.terms ? `<h4 style="margin-top:4mm">Terms &amp; conditions</h4><p>${nl2brSafe(data.terms)}</p>` : ""}
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
    const perPage = rowsPerPage(data);
    const lastCap = lastPageItemCapacity(data);
    const chunks = chunkItems(data.items, perPage, lastCap);
    const totalPages = chunks.length;

    $("#previewMeta").textContent = `Live document — ${data.pageSize} · ${
      data.orientation[0].toUpperCase() + data.orientation.slice(1)
    } · ${totalPages} page${totalPages === 1 ? "" : "s"}`;

    const pill = $("#invoicePill");
    if (pill) {
      pill.textContent = `INV | ${data.invoiceNumber.replace(/^INV-?/i, "")}`;
    }

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
            ${billToHTML(data, { continued })}
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

    fitPreviewScale();
  }

  function fitPreviewScale() {
    const stage = $("#preview-stage");
    const scaleWrap = $("#preview-scale");
    const first = $(".page-sheet", scaleWrap);
    if (!first) return;

    const stageWidth = stage.clientWidth - 32;
    const sheetWidth = first.offsetWidth;
    if (!sheetWidth) return;

    const scale = Math.min(1, stageWidth / sheetWidth);
    $("#pages-root").style.transform = `scale(${scale})`;
    // Keep layout height correct after CSS transform
    const root = $("#pages-root");
    const naturalHeight = root.scrollHeight;
    scaleWrap.style.height = `${naturalHeight * scale}px`;
    scaleWrap.style.width = "100%";
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
      state.items.push({ id: uid(), description: "", qty: 1, rate: 0 });
      renderItemsEditor();
      updateEditorTotals();
      renderPages();
    });

    $("#items-body").addEventListener("input", (e) => {
      const input = e.target.closest("input[data-field]");
      if (!input) return;
      const row = input.closest("tr");
      const item = state.items.find((i) => i.id === row.dataset.id);
      if (!item) return;
      const field = input.dataset.field;
      item[field] = field === "description" ? input.value : Number(input.value);
      const amountCell = row.querySelector(".amount-cell");
      amountCell.textContent = money(
        (Number(item.qty) || 0) * (Number(item.rate) || 0),
        $("#currency").value
      );
      updateEditorTotals();
      renderPages();
    });

    $("#items-body").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove]");
      if (!btn) return;
      const row = btn.closest("tr");
      if (state.items.length === 1) {
        state.items[0] = { id: uid(), description: "", qty: 1, rate: 0 };
      } else {
        state.items = state.items.filter((i) => i.id !== row.dataset.id);
      }
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
      "fromName",
      "fromAddress",
      "fromCity",
      "fromCountry",
      "fromContact",
      "toName",
      "toAddress",
      "toCity",
      "toCountry",
      "toContact",
      "dueDate",
      "paymentTerms",
      "customTerms",
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
      const evt = el.type === "checkbox" || el.tagName === "SELECT" || el.type === "color" ? "change" : "input";
      el.addEventListener(evt, () => {
        if (id === "pageSize") syncPageSizeControls("pageSize", el.value);
        if (id === "paymentTerms") syncDueModeUI();
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

    $("#btn-print").addEventListener("click", () => {
      window.print();
    });

    const printIcon = $("#btn-print-icon");
    if (printIcon) printIcon.addEventListener("click", () => window.print());
    const downloadBtn = $("#btn-download");
    if (downloadBtn) downloadBtn.addEventListener("click", () => window.print());

    window.addEventListener("resize", () => fitPreviewScale());
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
    $("#fromName").value = "Number7 Studio";
    $("#fromAddress").value = "12 Innovation Lane";
    $("#fromCity").value = "Bengaluru, KA 560001";
    $("#fromCountry").value = "India";
    $("#fromContact").value = "billing@number7ai.com";
    $("#toName").value = "Acme Retail Pvt Ltd";
    $("#toAddress").value = "88 Market Road";
    $("#toCity").value = "Mumbai, MH 400001";
    $("#toCountry").value = "India";
    $("#toContact").value = "";
    $("#taxPercent").value = "18";
    $("#autoRound").checked = false;
    $('input[name="dueMode"][value="date"]').checked = true;
    $("#paymentTerms").value = "Net 30";
    $("#customTerms").value = "";
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
    // Enough line items to demonstrate multi-page breaks on A4
    state.items = Array.from({ length: 18 }, (_, i) => ({
      id: uid(),
      description: `Service line ${i + 1}`,
      qty: 1,
      rate: 1000 + i * 250,
    }));
    syncDueModeUI();
    renderItemsEditor();
    updateEditorTotals();
    renderPages();
  }

  function boot() {
    bindSectionNav();
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
