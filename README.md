# Invoice Studio

Clean HTML-only invoice editor with a live side-by-side preview (Number7 Document Generation demo).

## Open locally

```bash
# From this folder — any static server works
npx --yes serve .
# or
python3 -m http.server 8080
```

Then open the URL shown (e.g. `http://localhost:8080`).

## What’s included

- **Side-by-side editor + live preview** (USP)
- **Page size** dropdown: A4 (default), A3, Letter, Legal + orientation
- **Multi-page sheets** with page breaks and **Page X of Y**
- **User-controlled “repeat on every page”**: header, bill-to, table headers, banking, page numbers
- **Payment due**: fixed due date **or** payment terms (both available)
- **Optional banking**: bank name, account name, account number, IFSC, UPI
- **UPI QR** encoded with grand-total amount
- **CSS box-sizing / grid fit** alignment (no float hacks)

## Stack

Plain `index.html` + `styles.css` + `app.js` (QR via CDN `qrcodejs`).
