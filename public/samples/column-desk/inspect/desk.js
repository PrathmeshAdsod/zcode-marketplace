import { readCsv } from './csv.js';
import { mountEdition } from './edition.js';

const byId = id => document.getElementById(id);
const input = byId('csv-file');
const example = 'order_id,email,total\nO-102,erin@example.test,29.00\nO-102,missing-at,not-a-number\nO-103,kai@example.test\n';
let fileState;
let selection = 0;

function cell(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const edition = mountEdition({ byId, cell, download }) ?? (() => {});
function openCsv(name, data, error) {
  const status = byId('file-status');
  const result = byId('results');
  try {
    if (error) throw error;
    fileState = { name, ...readCsv(data) };
    status.textContent = name;
    status.dataset.error = 'false';
    byId('rows').textContent = fileState.records.length;
    byId('columns').textContent = fileState.headers.length;
    byId('issue-count').textContent = fileState.issues.length;
    byId('issues').replaceChildren(...(fileState.issues.length ? fileState.issues.slice(0, 20).map(issue =>
      cell('li', 'Record ' + issue.record + ' · ' + issue.message)) : [cell('li', 'No structural issues found.')]));
    const table = byId('preview');
    table.replaceChildren();
    const header = table.createTHead().insertRow();
    for (const [index, value] of fileState.headers.entries()) header.append(cell('th', value || '(column ' + (index + 1) + ')'));
    const body = table.createTBody();
    for (const record of fileState.records.slice(0, 8)) {
      const row = body.insertRow();
      for (const [index] of fileState.headers.entries()) row.append(cell('td', record[index] ?? ''));
    }
    result.hidden = false;
  } catch (failure) {
    fileState = undefined;
    status.textContent = failure.message;
    status.dataset.error = 'true';
    result.hidden = true;
  }
  edition(fileState);
}
input.addEventListener('change', async () => {
  const file = input.files[0];
  if (!file) return;
  const request = ++selection;
  input.value = '';
  if (file.size > 2 * 1024 * 1024) {
    openCsv(file.name, '', new Error('Choose a file smaller than 2 MiB.'));
    return;
  }
  try {
    const data = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    if (selection === request) openCsv(file.name, data);
  } catch {
    if (selection === request) openCsv(file.name, '', new Error('The file must be valid UTF-8.'));
  }
});
byId('example').addEventListener('click', () => { selection++; openCsv('Example orders.csv', example); });
byId('download').addEventListener('click', () => {
  if (fileState) download('column-desk-inspection.json', {
    version: 1, file: fileState.name, columns: fileState.headers, records: fileState.records.length, issues: fileState.issues,
  });
});
