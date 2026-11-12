# Column Desk Inspect

Check a vendor export before loading it into a database or CRM. Column Desk reads UTF-8, comma-separated CSVs in the browser and flags blank or duplicate column names and records with the wrong number of fields. It understands quoted commas, escaped quotes, and quoted multiline values. Inspect the column list, preview the first eight rows, and export structural findings as JSON. No file data leaves the browser.

Use Node.js 24 or newer. Run `npm ci --offline`, then `npm start` and open [Column Desk](http://127.0.0.1:4173). The app accepts up to 2 MiB and 10,000 records. The example CSV is synthetic and intentionally contains problems.

Run `npm test` for parser tests. The MIT license accompanies the source.
