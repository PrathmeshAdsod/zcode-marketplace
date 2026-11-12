const maxRows = 10_000;
const maxColumns = 200;

export function readCsv(input) {
  const text = input.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closed = false;

  function addField() {
    row.push(field);
    if (row.length > maxColumns) throw new Error('The file exceeds 200 fields in one record.');
    field = '';
    closed = false;
  }
  function addRow() {
    addField();
    rows.push(row);
    if (rows.length > maxRows + 1) throw new Error('The file exceeds 10,000 data records.');
    row = [];
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === ',') addField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      addRow();
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (char === '"' || closed) throw new Error('Invalid quotation in record ' + (rows.length + 1) + '.');
    else field += char;
  }
  if (quoted) throw new Error('Unclosed quoted field in record ' + (rows.length + 1) + '.');
  if (field || row.length || closed) addRow();
  if (!rows.length) throw new Error('No CSV records were found.');
  const [headers, ...records] = rows;
  const issues = [];
  const used = new Set();
  for (const [index, value] of headers.entries()) {
    const name = value.trim();
    if (!name) issues.push({ record: 1, field: index + 1, message: 'Blank column name' });
    else if (used.has(name.toLowerCase())) issues.push({ record: 1, field: index + 1, message: 'Duplicate column name: ' + name });
    used.add(name.toLowerCase());
  }
  for (const [index, fields] of records.entries()) {
    if (fields.length !== headers.length) issues.push({
      record: index + 2, field: null, message: 'Expected ' + headers.length + ' fields, found ' + fields.length,
    });
  }
  return { headers, records, issues };
}
