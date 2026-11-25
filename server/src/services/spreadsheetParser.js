import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { parse as parseCsv } from 'csv-parse';
import { Readable } from 'node:stream';

export const IMPORT_LIMITS = Object.freeze({ fileBytes: 10 * 1024 * 1024, rows: 5000, columns: 50, cellChars: 5000, expandedBytes: 64 * 1024 * 1024, entryBytes: 25 * 1024 * 1024, zipEntries: 1000 });
const MIME = { csv: ['text/csv', 'application/vnd.ms-excel', 'application/csv', 'text/plain'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'] };

function fail(message) { const error = new Error(message); error.status = 400; error.code = 'INVALID_IMPORT_FILE'; throw error; }
function zipOpen(buffer) { return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, decodeStrings: true }, (err, zip) => err ? reject(err) : resolve(zip))); }
async function inspectZip(buffer) {
  const zip = await zipOpen(buffer);
  const seen = new Set(); let count = 0; let expanded = 0; const sheets = new Map();
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        count += 1;
        if (count > IMPORT_LIMITS.zipEntries || entry.fileName.includes('..') || seen.has(entry.fileName) || entry.encrypted || ![0, 8].includes(entry.compressionMethod)) { reject(new Error('Unsafe or excessive XLSX archive entries')); return; }
        seen.add(entry.fileName);
        if (/vbaProject|externalLinks|\.bin$/i.test(entry.fileName)) { reject(new Error('Macro-enabled or externally linked workbooks are not supported')); return; }
        if (entry.uncompressedSize > IMPORT_LIMITS.entryBytes || (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > 200)) { reject(new Error('XLSX archive entry exceeds safe expansion limits')); return; }
        expanded += entry.uncompressedSize;
        if (expanded > IMPORT_LIMITS.expandedBytes) { reject(new Error('XLSX expands beyond the safe size limit')); return; }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) { reject(streamError); return; }
          const chunks = []; let actual = 0;
          stream.on('data', (chunk) => {
            actual += chunk.length;
            if (actual > IMPORT_LIMITS.entryBytes || actual > entry.uncompressedSize || actual > IMPORT_LIMITS.expandedBytes) stream.destroy(new Error('XLSX expansion limit exceeded'));
            if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.fileName)) chunks.push(chunk);
          });
          stream.on('error', reject);
          stream.on('end', () => {
            if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.fileName)) sheets.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  } finally { zip.close(); }
  if (!sheets.size || !seen.has('[Content_Types].xml')) fail('Malformed XLSX workbook');
  for (const xml of sheets.values()) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('XML entities are not allowed in workbooks');
    const rows = [...xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].map((match) => Number(match[1]));
    if (rows.some((row) => row > IMPORT_LIMITS.rows + 1)) fail(`Workbook exceeds ${IMPORT_LIMITS.rows} rows`);
    const cells = [...xml.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)].map((match) => match[1]);
    if (cells.some((col) => { let value = 0; for (const char of col) value = value * 26 + char.charCodeAt(0) - 64; return value > IMPORT_LIMITS.columns; })) fail(`Workbook exceeds ${IMPORT_LIMITS.columns} columns`);
  }
}

function checkRows(rows) {
  if (!rows.length) fail('The file has no header row');
  const headers = rows[0].map((value, index) => String(value ?? '').trim() || `Column ${index + 1}`);
  if (headers.length > IMPORT_LIMITS.columns) fail(`A file may have at most ${IMPORT_LIMITS.columns} columns`);
  if (new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) fail('Column headers must be unique');
  if (rows.length - 1 > IMPORT_LIMITS.rows) fail(`A file may have at most ${IMPORT_LIMITS.rows} data rows`);
  const data = rows.slice(1).map((row, i) => ({ rowNumber: i + 2, values: headers.map((_, col) => String(row[col] ?? '')) }));
  if (data.some((row) => row.values.some((cell) => cell.length > IMPORT_LIMITS.cellChars))) fail(`Cells may not exceed ${IMPORT_LIMITS.cellChars} characters`);
  return { headers, rows: data };
}

export function validateUpload(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.size) fail('Choose a non-empty .xlsx or .csv file');
  if (file.size > IMPORT_LIMITS.fileBytes) { const error = new Error('File exceeds the 10 MB upload limit'); error.status = 413; error.code = 'FILE_TOO_LARGE'; throw error; }
  const extension = String(file.originalname || '').split('.').pop().toLowerCase();
  if (!['csv', 'xlsx'].includes(extension)) fail('Only .xlsx and .csv files are supported');
  if (!MIME[extension].includes(file.mimetype)) fail('File content type does not match a supported spreadsheet');
  if (extension === 'xlsx' && !(file.buffer[0] === 0x50 && file.buffer[1] === 0x4b)) fail('XLSX file is not a valid ZIP workbook');
  if (extension === 'csv' && (file.buffer.includes(0) || file.buffer.toString('utf8').includes('\uFFFD'))) fail('CSV must be valid UTF-8 text');
  return extension;
}

export async function inspectUpload(file, requestedSheet) {
  const extension = validateUpload(file);
  try {
    if (extension === 'csv') {
      const parser = Readable.from([file.buffer]).pipe(parseCsv({ bom: true, skip_empty_lines: true, relax_column_count: true, max_record_size: IMPORT_LIMITS.cellChars * IMPORT_LIMITS.columns }));
      const rows = []; for await (const row of parser) { rows.push(row); if (rows.length > IMPORT_LIMITS.rows + 1) fail(`A file may have at most ${IMPORT_LIMITS.rows} data rows`); }
      return { sheets: [{ name: 'CSV', ...checkRows(rows) }] };
    }
    await inspectZip(file.buffer);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer, { ignoreNodes: ['dataValidations', 'conditionalFormatting', 'extLst'] });
    const sheets = workbook.worksheets.map((sheet) => {
      if (sheet.rowCount > IMPORT_LIMITS.rows + 1 || sheet.columnCount > IMPORT_LIMITS.columns) fail(`Sheet "${sheet.name}" exceeds import limits`);
      const rows = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          const value = cell.value;
          if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) values[col - 1] = '[FORMULA NOT ALLOWED]';
          else if (value && typeof value === 'object' && value.hyperlink) values[col - 1] = value.text || '';
          else values[col - 1] = value == null ? '' : String(value);
        });
        rows[row.number - 1] = values;
      });
      return { name: sheet.name, ...checkRows(rows.filter(Boolean)) };
    });
    if (!sheets.length) fail('Workbook has no worksheets');
    const selected = requestedSheet ? sheets.filter((sheet) => sheet.name === requestedSheet) : sheets;
    if (requestedSheet && !selected.length) fail('Selected worksheet was not found');
    return { sheets: selected };
  } catch (error) {
    if (error.status) throw error;
    const invalid = new Error('Could not parse the spreadsheet. Check that the file is not malformed or encrypted.'); invalid.status = 400; invalid.code = 'INVALID_IMPORT_FILE'; throw invalid;
  }
}
