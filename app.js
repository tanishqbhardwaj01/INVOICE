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
    return addDaysToISO(todayISO(), days);
  }

  function addDaysToISO(isoDate, days) {
    const base = isoDate || todayISO();
    const d = new Date(`${base}T12:00:00`);
    if (Number.isNaN(d.getTime())) {
      const fallback = new Date();
      fallback.setDate(fallback.getDate() + Number(days) || 0);
      return fallback.toISOString().slice(0, 10);
    }
    d.setDate(d.getDate() + (Number(days) || 0));
    return d.toISOString().slice(0, 10);
  }

  function daysBetween(fromISO, toISO) {
    if (!fromISO || !toISO) return 0;
    const a = new Date(`${fromISO}T12:00:00`);
    const b = new Date(`${toISO}T12:00:00`);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
    return Math.round((b - a) / 86400000);
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

  /**
   * Cell helpers:
   * - "10*5" → evaluates to 50 (display only)
   * - "-15%" / "+10%" → % adjust line amount
   * - "-50" / "+50" → flat ₹/currency adjust line amount (sign required)
   * - "50" unsigned → display only (no amount impact)
   */
  function evalArithmetic(raw) {
    const text = String(raw ?? "").trim();
    if (!text) return { ok: false, value: text };

    if (/^[+\-]?\d+(\.\d+)?\s*%$/.test(text)) {
      return { ok: true, value: text.replace(/\s+/g, ""), isPercent: true };
    }

    // Keep explicit signed flat amounts as-is (e.g. -50, +100)
    if (/^[+\-]\d+(\.\d+)?$/.test(text)) {
      return { ok: true, value: text, isFlat: true };
    }

    if (!/[+\-*/()]/.test(text)) return { ok: false, value: text };
    if (!/^[\d\s.+\-*/()]+$/.test(text)) return { ok: false, value: text };
    try {
      const result = Function(`"use strict"; return (${text});`)();
      if (typeof result !== "number" || !Number.isFinite(result)) {
        return { ok: false, value: text };
      }
      const rounded = Math.round(result * 100) / 100;
      return { ok: true, value: String(rounded), isPercent: false };
    } catch {
      return { ok: false, value: text };
    }
  }

  function lineAmountAdjustments(item) {
    let factor = 1;
    let flat = 0;
    Object.values(item.custom || {}).forEach((raw) => {
      const text = String(raw ?? "").trim();
      const pct = text.match(/^([+\-]?\d+(?:\.\d+)?)\s*%$/);
      if (pct) {
        factor *= 1 + Number(pct[1]) / 100;
        return;
      }
      // Flat wave/discount in currency: must include + or - (e.g. -50)
      const flatMatch = text.match(/^([+\-]\d+(?:\.\d+)?)$/);
      if (flatMatch) {
        flat += Number(flatMatch[1]);
      }
    });
    return { factor, flat };
  }

  function lineAmount(item) {
    const base = (Number(item.qty) || 0) * (Number(item.rate) || 0);
    const { factor, flat } = lineAmountAdjustments(item);
    return Math.round((base * factor + flat) * 100) / 100;
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

  function isCustomTerms() {
    return $("#paymentTerms").value === "custom";
  }

  function getPaymentTermsLabel() {
    const sel = $("#paymentTerms").value;
    if (sel === "0") return "Due on receipt";
    if (sel === "custom") {
      const days = daysBetween($("#invoiceDate").value, $("#dueDate").value);
      if (days === 0) return "Due on receipt";
      if (days < 0) return "Custom terms";
      return `Net ${days}`;
    }
    return `Net ${sel}`;
  }

  function syncPaymentDueUI({ skipDueDateWrite = false } = {}) {
    const terms = $("#paymentTerms").value;
    const dueInput = $("#dueDate");
    const lockHint = $("#dueLockHint");
    const summary = $("#dueSummary");
    const invoiceDate = $("#invoiceDate").value || todayISO();
    const custom = terms === "custom";

    dueInput.disabled = !custom;
    if (lockHint) {
      lockHint.textContent = custom ? "Unlocked" : "Locked to terms";
      lockHint.classList.toggle("is-unlocked", custom);
    }

    if (!custom && !skipDueDateWrite) {
      const n = Number(terms) || 0;
      dueInput.value = addDaysToISO(invoiceDate, n);
    }

    if (summary) {
      if (terms === "0") {
        summary.textContent = "Due on receipt · due date matches invoice date";
      } else if (custom) {
        const days = daysBetween(invoiceDate, dueInput.value);
        if (!dueInput.value) {
          summary.textContent = "Due on date · pick a due date (terms = day count)";
        } else if (days === 0) {
          summary.textContent = "Custom · due on receipt (0 days from invoice date)";
        } else if (days < 0) {
          summary.textContent = "Custom · due date is before invoice date";
        } else {
          summary.textContent = `Custom · Net ${days} · ${days} day${days === 1 ? "" : "s"} from invoice date`;
        }
      } else {
        summary.textContent = `Net ${terms} · due date follows invoice date`;
      }
    }
  }

  function chargesTotal() {
    return state.charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  }

  function paymentStatusValue() {
    const el = $("#paymentStatus");
    return el ? el.value : "unpaid";
  }

  function computeTotals() {
    const taxPercent = Number($("#taxPercent").value) || 0;
    const autoRound = $("#autoRound").checked;
    const status = paymentStatusValue();
    let subtotal = state.items.reduce((sum, item) => sum + lineAmount(item), 0);
    const charges = chargesTotal();
    const taxable = subtotal + charges;
    const tax = (taxable * taxPercent) / 100;
    const rawGrand = taxable + tax;
    let roundOff = 0;
    let grand = rawGrand;
    if (autoRound) {
      grand = Math.round(rawGrand);
      roundOff = grand - rawGrand;
    }
    let amountPaid = Number($("#amountPaid").value) || 0;
    if (status === "unpaid") amountPaid = 0;
    if (status === "paid") amountPaid = grand;
    const balance = Math.max(0, grand - amountPaid);
    return {
      subtotal,
      charges,
      tax,
      taxPercent,
      rawGrand,
      roundOff,
      autoRound,
      grand,
      amountPaid,
      balance,
      paymentStatus: status,
    };
  }

  function syncPaymentStatusUI() {
    const status = paymentStatusValue();
    const paidField = $("#amountPaidField");
    const balanceRow = $("#editorBalanceRow");
    const hint = $("#paymentStatusHint");
    if (paidField) paidField.hidden = status !== "partial";
    if (balanceRow) balanceRow.hidden = status === "paid";
    if (hint) {
      if (status === "partial") {
        hint.textContent = "Partial — enter the amount paid here. Paid & balance appear on the invoice totals.";
      } else if (status === "paid") {
        hint.textContent = "Paid — balance is cleared. Status stays in the editor only.";
      } else {
        hint.textContent = "Unpaid — status stays in the editor only (not printed on the bill).";
      }
    }
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
    const termsValue = $("#paymentTerms").value;
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
        gstin: $("#fromGstin").value.trim(),
        stateCode: $("#fromStateCode").value.trim(),
        website: $("#fromWebsite").value.trim(),
        email: $("#fromEmail").value.trim(),
        phone: $("#fromPhone").value.trim(),
      },
      to: {
        name: $("#toName").value.trim(),
        address: $("#toAddress").value.trim(),
        gstin: $("#toGstin").value.trim(),
        stateCode: $("#toStateCode").value.trim(),
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
      dueDate: $("#dueDate").value,
      paymentTerms: getPaymentTermsLabel(),
      paymentTermsValue: termsValue,
      showBothDueOnInvoice: $("#showBothDueOnInvoice").checked,
      paymentStatus: paymentStatusValue(),
      amountPaid: totals.amountPaid,
      bank: {
        name: $("#bankName").value.trim(),
        accountName: $("#accountName").value.trim(),
        accountNumber: $("#accountNumber").value.trim(),
        ifsc: $("#ifsc").value.trim(),
        upi: $("#upiId").value.trim(),
      },
      showQr: $("#showQr").checked,
      qrEveryPage: $("#qrEveryPage").checked,
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
        amount: lineAmount(item),
      })),
      totals,
    };
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

  function pageShowsBanking(data, isLast) {
    return hasBanking(data.bank) && (isLast || data.repeat.banking);
  }

  function pageShowsQr(data, isLast) {
    return Boolean(data.showQr && data.bank.upi && data.totals.grand > 0) && (isLast || data.qrEveryPage);
  }

  /** Absolute page size in CSS px (96dpi). Avoids mm + preview-scale mismatch while measuring. */
  function pagePixelSize(data) {
    const mm = {
      A4: [210, 297],
      A3: [297, 420],
      Letter: [215.9, 279.4],
      Legal: [215.9, 355.6],
    };
    let [wMm, hMm] = mm[data.pageSize] || mm.A4;
    if (data.orientation === "landscape") [wMm, hMm] = [hMm, wMm];
    const dpi = 96;
    return {
      width: Math.round((wMm / 25.4) * dpi),
      height: Math.round((hMm / 25.4) * dpi),
    };
  }

  function getMeasureRoot() {
    let root = document.getElementById("measure-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "measure-root";
      root.setAttribute("aria-hidden", "true");
      document.body.appendChild(root);
    }
    return root;
  }

  function summaryHTML(data, { isLast, bankingOnThisPage, qrOnThisPage }) {
    if (isLast) {
      return `<section class="page-sheet__summary">
        <div class="doc-bottom">
          <div class="doc-bottom__meta">
            ${notesHTML(data)}
            ${payRowHTML(data, { showBanking: bankingOnThisPage, showQr: qrOnThisPage })}
          </div>
          <div class="doc-bottom__totals">${totalsHTML(data)}</div>
        </div>
      </section>`;
    }
    if (bankingOnThisPage || qrOnThisPage) {
      return `<section class="page-sheet__summary">
        <div class="doc-bottom">
          <div class="doc-bottom__meta">
            ${payRowHTML(data, { showBanking: bankingOnThisPage, showQr: qrOnThisPage })}
          </div>
          <div class="doc-bottom__totals"></div>
        </div>
      </section>`;
    }
    return "";
  }

  function buildPageSheet(data, pageItems, { continued, isLast, pageNo, totalPages, forMeasure }) {
    const showTableHeader = data.repeat.tableHeader || !continued;
    const bankingOnThisPage = pageShowsBanking(data, isLast);
    const qrOnThisPage = pageShowsQr(data, isLast);
    const px = pagePixelSize(data);

    const sheet = document.createElement("article");
    sheet.className = "page-sheet";
    sheet.dataset.size = data.pageSize;
    sheet.dataset.orientation = data.orientation;
    sheet.style.setProperty("--doc-accent", data.themeColor);
    // Explicit px so measure-root and live preview share the same layout box
    sheet.style.setProperty("width", `${px.width}px`, "important");
    sheet.style.setProperty("height", `${px.height}px`, "important");
    sheet.style.setProperty("max-height", `${px.height}px`, "important");
    sheet.style.setProperty("min-height", `${px.height}px`, "important");
    sheet.style.flexShrink = "0";

    sheet.innerHTML = `
      <div class="page-sheet__inner">
        <div class="page-sheet__main">
          ${headerHTML(data, { continued })}
          ${billShipHTML(data, { continued })}
          <div class="doc-table-box">
            ${tableHTML(data, pageItems, { continued, isLast, showHeader: showTableHeader })}
          </div>
        </div>
        ${summaryHTML(data, { isLast, bankingOnThisPage, qrOnThisPage })}
        <footer class="page-sheet__footer">
          <span class="powered">Powered by Number7 AI</span>
          ${
            data.repeat.pageNumbers
              ? `<span class="page-num">Page ${pageNo} of ${totalPages}</span>`
              : "<span></span>"
          }
        </footer>
      </div>`;

    if (qrOnThisPage) {
      const slot = sheet.querySelector('[data-qr-slot="1"]');
      if (forMeasure) {
        // Match real QR + caption footprint (amount + UPI line)
        const wrap = slot || sheet.querySelector(".doc-qr-wrap");
        if (wrap) {
          wrap.innerHTML = `<div class="doc-qr" style="width:72px;height:72px;background:#eee"></div>
            <div class="doc-qr-caption">Scan to pay<br /><strong>${money(
              data.totals.grand,
              data.currency
            )}</strong><br />${escapeHtml(data.bank.upi || "upi@bank")}</div>`;
        }
      } else {
        mountQr(slot, data);
      }
    }

    return sheet;
  }

  /** Safety gap so sub-pixel / caption differences never clip the last rows. */
  const PAGE_FIT_SAFETY_PX = 28;

  function sheetLayoutHeight(sheet) {
    // Prefer the explicit px we set — offsetHeight is wrong under preview CSS transforms
    const forced = parseFloat(sheet.style.height);
    if (Number.isFinite(forced) && forced > 0) return forced;
    return sheet.offsetHeight;
  }

  /** True when unclipped page content is taller than the fixed sheet. */
  function pageContentOverflows(sheet) {
    const inner = sheet.querySelector(".page-sheet__inner");
    const main = sheet.querySelector(".page-sheet__main");
    const tableBox = sheet.querySelector(".doc-table-box");
    if (!inner || !main) return false;

    const allowed = sheetLayoutHeight(sheet);

    const prevSheet = {
      height: sheet.style.getPropertyValue("height") || `${allowed}px`,
      maxHeight: sheet.style.getPropertyValue("max-height") || `${allowed}px`,
      minHeight: sheet.style.getPropertyValue("min-height") || `${allowed}px`,
      overflow: sheet.style.overflow,
    };
    const prevInner = {
      height: inner.style.height,
      maxHeight: inner.style.maxHeight,
      overflow: inner.style.overflow,
      flex: inner.style.flex,
    };
    const prevMain = {
      overflow: main.style.overflow,
      flex: main.style.flex,
      minHeight: main.style.minHeight,
    };
    const prevBox = tableBox
      ? {
          overflow: tableBox.style.overflow,
          flex: tableBox.style.flex,
          minHeight: tableBox.style.minHeight,
        }
      : null;

    // Unconstrain the whole sheet so scrollHeight reflects true content size
    // (must override !important min/max height used for live preview)
    sheet.style.setProperty("height", "auto", "important");
    sheet.style.setProperty("max-height", "none", "important");
    sheet.style.setProperty("min-height", "0", "important");
    sheet.style.overflow = "visible";
    inner.style.height = "auto";
    inner.style.maxHeight = "none";
    inner.style.overflow = "visible";
    inner.style.flex = "0 0 auto";
    main.style.overflow = "visible";
    main.style.flex = "0 0 auto";
    main.style.minHeight = "auto";
    if (tableBox) {
      tableBox.style.overflow = "visible";
      tableBox.style.flex = "0 0 auto";
      tableBox.style.minHeight = "auto";
    }

    void sheet.offsetWidth;

    const naturalHeight = Math.max(sheet.scrollHeight, inner.scrollHeight, sheet.offsetHeight);

    sheet.style.setProperty("height", prevSheet.height, "important");
    sheet.style.setProperty("max-height", prevSheet.maxHeight, "important");
    sheet.style.setProperty("min-height", prevSheet.minHeight, "important");
    sheet.style.overflow = prevSheet.overflow;
    inner.style.height = prevInner.height;
    inner.style.maxHeight = prevInner.maxHeight;
    inner.style.overflow = prevInner.overflow;
    inner.style.flex = prevInner.flex;
    main.style.overflow = prevMain.overflow;
    main.style.flex = prevMain.flex;
    main.style.minHeight = prevMain.minHeight;
    if (tableBox && prevBox) {
      tableBox.style.overflow = prevBox.overflow;
      tableBox.style.flex = prevBox.flex;
      tableBox.style.minHeight = prevBox.minHeight;
    }

    return naturalHeight > allowed - PAGE_FIT_SAFETY_PX;
  }

  /** Binary-search how many leading items fit on one page with the given chrome. */
  function maxItemsThatFit(items, data, { continued, isLast }) {
    if (!items.length) return 0;

    const measureRoot = getMeasureRoot();
    measureRoot.innerHTML = "";

    const fits = (count) => {
      measureRoot.innerHTML = "";
      const sheet = buildPageSheet(data, items.slice(0, count), {
        continued,
        isLast,
        pageNo: 1,
        totalPages: 1,
        forMeasure: true,
      });
      measureRoot.appendChild(sheet);
      void sheet.offsetHeight;
      return !pageContentOverflows(sheet);
    };

    if (fits(items.length)) return items.length;
    if (!fits(1)) return 1; // always keep at least one row; avoid infinite loops

    let lo = 1;
    let hi = items.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid - 1;
    }

    measureRoot.innerHTML = "";
    return Math.max(1, lo);
  }

  /**
   * Measurement-based pagination:
   * - If all remaining items fit with totals/notes/banking → last page
   * - Else pack a non-last page, leaving enough items to fill the last page
   * Items are never clipped under banking/QR; they move to the next page.
   */
  function chunkItemsSmart(items, data) {
    if (!items.length) return [[]];

    const chunks = [];
    let remaining = items.slice();
    let guard = 0;

    while (remaining.length && guard < items.length + 5) {
      guard += 1;
      const continued = chunks.length > 0;

      // Prefer finishing on a last page (summary + totals) when everything fits
      const lastFit = maxItemsThatFit(remaining, data, { continued, isLast: true });
      if (lastFit >= remaining.length) {
        chunks.push(remaining.splice(0, remaining.length));
        break;
      }

      // Not done — pack a non-last page, but leave a full last-page worth of items
      const midFit = maxItemsThatFit(remaining, data, { continued, isLast: false });
      let take = remaining.length - lastFit; // leave lastFit for the closing page
      if (take > midFit) take = midFit;
      if (take < 1) take = 1;
      if (take >= remaining.length) take = remaining.length - 1;
      chunks.push(remaining.splice(0, take));
    }

    if (remaining.length) chunks.push(remaining);
    getMeasureRoot().innerHTML = "";
    return chunks.length ? chunks : [[]];
  }

  /* ---------- Settings modal ---------- */

  function openSettings() {
    $("#settings-modal").hidden = false;
    document.body.classList.add("modal-open");
    $("#btn-settings").setAttribute("aria-expanded", "true");
  }

  function closeSettings() {
    $("#settings-modal").hidden = true;
    if ($("#columns-modal").hidden) document.body.classList.remove("modal-open");
    $("#btn-settings").setAttribute("aria-expanded", "false");
  }

  function bindSettingsModal() {
    $("#btn-settings").addEventListener("click", openSettings);
    $$("[data-close-settings]").forEach((el) => el.addEventListener("click", closeSettings));
  }

  /* ---------- Custom columns modal ---------- */

  function openColumnsModal() {
    $("#columns-modal").hidden = false;
    document.body.classList.add("modal-open");
    renderColumnsEditor();
  }

  function closeColumnsModal() {
    $("#columns-modal").hidden = true;
    if ($("#settings-modal").hidden) document.body.classList.remove("modal-open");
  }

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
    const addBtn = $("#btn-add-column-modal");
    const n = state.customColumns.length;

    if (count) {
      count.textContent = `Movable · arithmetic in cells · max ${MAX_CUSTOM_COLUMNS} · ${n}/${MAX_CUSTOM_COLUMNS}`;
    }
    if (addBtn) addBtn.disabled = n >= MAX_CUSTOM_COLUMNS;
    if (empty) empty.hidden = n > 0;

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

  function addCustomColumn() {
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
  }

  function bindColumns() {
    $("#btn-add-column").addEventListener("click", openColumnsModal);
    $("#btn-add-column-modal").addEventListener("click", addCustomColumn);
    $$("[data-close-columns]").forEach((el) => el.addEventListener("click", closeColumnsModal));

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
        <input type="text" data-charge-label value="${escapeHtml(c.label)}" placeholder="Label (shipping, discount…)" />
        <input type="number" data-charge-amount step="0.01" value="${c.amount}" placeholder="0.00" aria-label="Charge amount" />
        <button type="button" class="btn btn--icon" data-remove-charge title="Remove charge" aria-label="Remove charge">×</button>
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
          `<td><input type="text" data-custom="${col.id}" value="${escapeHtml((item.custom && item.custom[col.id]) || "")}" placeholder="${escapeHtml(col.name)} · -15% or -50" /></td>`
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
        const amount = lineAmount(item);
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
    const { subtotal, charges, tax, grand, balance, roundOff, autoRound, paymentStatus } =
      computeTotals();
    $("#editorSubtotal").textContent = money(subtotal, currency);
    $("#editorCharges").textContent = money(charges, currency);
    $("#editorTax").textContent = money(tax, currency);
    $("#editorGrand").textContent = money(grand, currency);
    $("#editorBalance").textContent = money(balance, currency);
    const roundWrap = $("#editorRoundOffWrap");
    const roundEl = $("#editorRoundOff");
    if (roundWrap && roundEl) {
      const showRound = autoRound && Math.abs(roundOff) >= 0.005;
      roundWrap.hidden = !showRound;
      if (showRound) {
        const sign = roundOff > 0 ? "+" : "";
        roundEl.textContent = `${sign}${money(roundOff, currency)}`;
      }
    }
    const balanceRow = $("#editorBalanceRow");
    if (balanceRow) balanceRow.hidden = paymentStatus === "paid";
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

  function dueMetaHTML(data) {
    const isReceipt = data.paymentTermsValue === "0" || data.paymentTerms === "Due on receipt";
    const termsLine = `<div><strong>Terms</strong> ${escapeHtml(data.paymentTerms)}</div>`;
    const dueLine = `<div><strong>Due date</strong> ${escapeHtml(data.dueDate || "—")}</div>`;

    if (data.showBothDueOnInvoice) {
      return `${termsLine}${dueLine}`;
    }
    if (isReceipt) return termsLine;
    return dueLine;
  }

  function headerHTML(data, { continued }) {
    if (!data.repeat.header && continued) return "";
    const logo = data.logoDataUrl
      ? `<img class="doc-logo" src="${data.logoDataUrl}" alt="Logo" />`
      : "";
    const metaParts = [data.from.address, data.from.email, data.from.phone].filter(Boolean);
    return `
      <header class="doc-header">
        <div class="doc-brand">
          ${logo}
          <div>
            <p class="doc-company-name">${escapeHtml(data.from.name)}</p>
            ${data.tagline ? `<p class="doc-tagline">${escapeHtml(data.tagline)}</p>` : ""}
            ${metaParts.length ? `<p class="doc-company-meta">${nl2brSafe(metaParts.join("\n"))}</p>` : ""}
            ${data.from.gstin ? `<p class="doc-gstin">GSTIN: ${escapeHtml(data.from.gstin)}</p>` : ""}
            ${data.from.stateCode ? `<p class="doc-state">State code: ${escapeHtml(data.from.stateCode)}</p>` : ""}
          </div>
        </div>
        <div class="doc-title-block">
          <h3 class="doc-title">${escapeHtml(data.documentTitle)}</h3>
          <div class="doc-meta">
            <div><strong>Invoice #</strong> ${escapeHtml(data.invoiceNumber)}</div>
            <div><strong>Date</strong> ${escapeHtml(data.invoiceDate || "—")}</div>
            ${dueMetaHTML(data)}
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
          ${data.to.gstin ? `<p class="doc-gstin">GSTIN: ${escapeHtml(data.to.gstin)}</p>` : ""}
          ${data.to.stateCode ? `<p class="doc-state">State code: ${escapeHtml(data.to.stateCode)}</p>` : ""}
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
      cols
        .map((col) => `<th class="doc-custom">${escapeHtml(col.name || "Column")}</th>`)
        .join("");
    const cellCols = (cols, item) =>
      cols
        .map((col) => {
          const raw = item.custom && item.custom[col.id];
          const text = String(raw ?? "").trim();
          return `<td class="doc-custom">${text ? escapeHtml(text) : "—"}</td>`;
        })
        .join("");

    const colCount = 4 + data.customColumns.length;
    const header = showHeader
      ? `<thead><tr>
          ${headCols(s.before_item)}
          <th class="doc-item">Item</th>
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
              <td class="doc-item">${escapeHtml(item.description || "Untitled item")}</td>
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

    const contBefore = continued
      ? `<p class="doc-continuation">Continued from previous page</p>`
      : "";
    const contAfter =
      !isLast && pageItems.length
        ? `<p class="doc-continuation doc-continuation--after">Continues on next page</p>`
        : "";

    return `${contBefore}<table class="doc-table">${header}<tbody>${rows}</tbody></table>${contAfter}`;
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

  function qrSlotHTML(needed) {
    return `<div class="doc-qr-wrap" data-qr-slot="${needed ? "1" : "0"}"></div>`;
  }

  function payRowHTML(data, { showBanking, showQr }) {
    if (!showBanking && !showQr) return "";
    return `<div class="doc-pay-row">
      ${showQr ? qrSlotHTML(true) : ""}
      ${showBanking ? bankingHTML(data) : ""}
    </div>`;
  }

  function totalsHTML(data) {
    const chargeRows = data.charges
      .filter((c) => c.label || c.amount)
      .map(
        (c) =>
          `<div class="doc-totals-row"><span>${escapeHtml(c.label || "Charge")}</span><span>${money(c.amount, data.currency)}</span></div>`
      )
      .join("");
    const status = data.paymentStatus || data.totals.paymentStatus || "unpaid";
    const paid = data.totals.amountPaid || 0;
    const balance = data.totals.balance != null ? data.totals.balance : data.totals.grand - paid;
    const roundOff = data.totals.roundOff || 0;
    const showRound = data.totals.autoRound && Math.abs(roundOff) >= 0.005;
    const roundSign = roundOff > 0 ? "+" : "";
    const partialRows =
      status === "partial"
        ? `<div class="doc-totals-row"><span>Paid</span><span>${money(paid, data.currency)}</span></div>
           <div class="doc-totals-row"><span>Balance</span><span>${money(balance, data.currency)}</span></div>`
        : "";
    return `
      <div class="doc-totals">
        <div class="doc-totals-row"><span>Items total</span><span>${money(data.totals.subtotal, data.currency)}</span></div>
        ${chargeRows}
        <div class="doc-totals-row"><span>Tax (${data.totals.taxPercent}%)</span><span>${money(data.totals.tax, data.currency)}</span></div>
        ${
          showRound
            ? `<div class="doc-totals-row doc-totals-row--round"><span>Round off</span><span>${roundSign}${money(
                roundOff,
                data.currency
              )}</span></div>`
            : ""
        }
        <div class="doc-totals-row grand"><span>TOTAL</span><span>${money(data.totals.grand, data.currency)}</span></div>
        ${partialRows}
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

  function mountQr(slot, data) {
    if (!slot) return;
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
      const sheet = buildPageSheet(data, pageItems, {
        continued: index > 0,
        isLast: index === totalPages - 1,
        pageNo: index + 1,
        totalPages,
        forMeasure: false,
      });
      root.appendChild(sheet);
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
        const amountCell = row.querySelector(".amount-cell");
        if (amountCell) {
          amountCell.textContent = money(lineAmount(item), $("#currency").value);
        }
        updateEditorTotals();
        renderPages();
        return;
      }

      if (!fieldInput) return;
      const field = fieldInput.dataset.field;
      item[field] = field === "description" ? fieldInput.value : Number(fieldInput.value);
      const amountCell = row.querySelector(".amount-cell");
      if (amountCell) {
        amountCell.textContent = money(lineAmount(item), $("#currency").value);
      }
      updateEditorTotals();
      renderPages();
    });

    // Evaluate arithmetic / keep % discounts on blur in custom columns
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
        customInput.classList.toggle("is-calculated", true);
        customInput.classList.toggle("is-discount", !!(evaluated.isPercent || evaluated.isFlat));
        const amountCell = row.querySelector(".amount-cell");
        if (amountCell) {
          amountCell.textContent = money(lineAmount(item), $("#currency").value);
        }
        updateEditorTotals();
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
      "fromGstin",
      "fromStateCode",
      "fromWebsite",
      "fromEmail",
      "fromPhone",
      "toName",
      "toAddress",
      "toGstin",
      "toStateCode",
      "toEmail",
      "toPhone",
      "shipName",
      "shipAddress",
      "shipEmail",
      "shipPhone",
      "shipDifferent",
      "dueDate",
      "paymentTerms",
      "paymentStatus",
      "showBothDueOnInvoice",
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
      "qrEveryPage",
    ];

    formIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const evt =
        el.type === "checkbox" || el.tagName === "SELECT" || el.type === "color" || el.type === "date"
          ? "change"
          : "input";
      el.addEventListener(evt, () => {
        if (id === "pageSize") syncPageSizeControls("pageSize", el.value);
        if (id === "paymentTerms" || id === "invoiceDate" || id === "dueDate") {
          syncPaymentDueUI({
            skipDueDateWrite: id === "dueDate" && isCustomTerms(),
          });
        }
        if (id === "shipDifferent") syncShipUI();
        if (id === "paymentStatus") {
          syncPaymentStatusUI();
          updateEditorTotals();
        }
        if (
          id === "currency" ||
          id === "taxPercent" ||
          id === "autoRound" ||
          id === "amountPaid"
        ) {
          if (id === "currency") renderItemsEditor();
          updateEditorTotals();
        }
        renderPages();
      });
    });

    // Live typing updates for amount paid / tax while typing
    ["amountPaid", "taxPercent"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => {
        updateEditorTotals();
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

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("#columns-modal").hidden) {
        closeColumnsModal();
        return;
      }
      if (!$("#settings-modal").hidden) closeSettings();
    });

    window.addEventListener("resize", () => scheduleFitPreviewScale());
  }

  function initDefaults() {
    $("#invoiceNumber").value = defaultInvoiceNumber();
    $("#documentTitle").value = "INVOICE";
    $("#invoiceDate").value = todayISO();
    $("#currency").value = "INR";
    $("#themeColor").value = "#4066E6";
    $("#notes").value = "Thank you for your business.";
    $("#terms").value = "";
    $("#fromTagline").value = "Your Partner in Growth";
    $("#fromName").value = "Number7 Studio";
    $("#fromAddress").value = "12 Innovation Lane\nBengaluru, KA 560001\nIndia";
    $("#fromGstin").value = "29AABCN1234A1Z5";
    $("#fromStateCode").value = "29";
    $("#fromWebsite").value = "www.number7ai.com";
    $("#fromEmail").value = "billing@number7ai.com";
    $("#fromPhone").value = "+91 98765 43210";
    $("#toName").value = "Acme Retail Pvt Ltd";
    $("#toAddress").value = "88 Market Road\nMumbai, MH 400001";
    $("#toGstin").value = "27AABCA9876B1Z2";
    $("#toStateCode").value = "27";
    $("#toEmail").value = "ap@acme.example";
    $("#toPhone").value = "+91 91234 56789";
    $("#shipDifferent").checked = false;
    $("#shipName").value = "";
    $("#shipAddress").value = "";
    $("#shipEmail").value = "";
    $("#shipPhone").value = "";
    $("#taxPercent").value = "18";
    $("#autoRound").checked = true;
    $("#paymentTerms").value = "30";
    $("#paymentStatus").value = "unpaid";
    $("#showBothDueOnInvoice").checked = true;
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
    $("#qrEveryPage").checked = false;
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
    syncPaymentDueUI();
    syncShipUI();
    syncPaymentStatusUI();
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
