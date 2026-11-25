import multer from 'multer';
import { commitImport, getImport, listImportRows, listImports, previewUpload, rejectedRowsCsv, stageImport } from '../services/importService.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 20, fieldSize: 32 * 1024 } }).single('file');
function parseJson(value, label) { try { return JSON.parse(value); } catch { const error = new Error(`${label} must be valid JSON`); error.status = 400; error.code = 'INVALID_REQUEST'; throw error; } }
function receive(req, res, next) { upload(req, res, (error) => { if (!error) return next(); const tooLarge = error.code === 'LIMIT_FILE_SIZE'; error.status = tooLarge ? 413 : 400; error.code = tooLarge ? 'FILE_TOO_LARGE' : 'INVALID_UPLOAD'; next(error); }); }

export function inspectImportController(req, res, next) {
  receive(req, res, async (error) => {
    if (error) return next(error);
    try { res.json({ sheets: await previewUpload(req.file, req.body.sheetName) }); } catch (err) { next(err); }
  });
}
export function stageImportController(req, res, next) {
  receive(req, res, async (error) => {
    if (error) return next(error);
    try {
      const input = { sheetName: req.body.sheetName, mapping: parseJson(req.body.mapping, 'mapping'), assignmentStrategy: parseJson(req.body.assignmentStrategy || '{"type":"unassigned","userIds":[]}', 'assignmentStrategy') };
      res.status(201).json(await stageImport(req.user, req.file, input));
    } catch (err) { next(err); }
  });
}
export async function listImportsController(req, res, next) { try { res.json(await listImports(req.query)); } catch (error) { next(error); } }
export async function getImportController(req, res, next) { try { const batch = await getImport(req.params.batchId); res.json({ batch, ...(await listImportRows(req.params.batchId, req.query)) }); } catch (error) { next(error); } }
export async function commitImportController(req, res, next) { try { const result = await commitImport(req.user, req.params.batchId, req.body?.confirmedDuplicateRows || []); res.status(202).json({ batch: result }); } catch (error) { next(error); } }
export async function rejectedRowsController(req, res, next) {
  try {
    const csv = await rejectedRowsCsv(req.params.batchId);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="import-${req.params.batchId}-rejected.csv"`, 'Cache-Control': 'no-store' });
    res.send(csv);
  } catch (error) { next(error); }
}
