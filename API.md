# EduFinix CRM API Design

## Conventions

- Versioned base path: `/api/v1`.
- JSON bodies except multipart upload; bound request size and upload size/type.
- Validate, normalize, and authorize at the server boundary. Never trust client role, actor, owner, or scope fields.
- Use consistent errors: `{ error: { code, message, details? }, requestId }`; do not return stack traces or database internals.
- Bound pagination and filters. Prefer cursor pagination for high-volume/event feeds; allowlisted sort fields only.
- Mutations that may be retried should accept/use an idempotency key where appropriate, especially import commit and assignment actions.
- Use UTC in storage and ISO 8601 in API. Document reporting timezone and date range boundaries.

## Authentication and RBAC

Planned session endpoints: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`. Use short-lived access JWTs with validated issuer/audience/expiry/algorithm. Use rotated, revocable refresh sessions; store only token hashes server-side and use secure HttpOnly cookies for browser refresh credentials with suitable CSRF protections. Rate-limit login and refresh. Deactivated users and revoked sessions must fail authorization.

Roles: `founder`, `admin`, `salesperson`; map permissions centrally. Founder has read-only access to all CRM data and analytics. Admin has full management permissions. Salespersons can access only their assigned leads. Every route and query must enforce scope; the client only hides unavailable UI. Admin-only user and import operations must not be reachable by changing client state. All status changes and assignment/reassignment actions record UTC timestamps and actor IDs.

## Planned endpoint groups

| Group | Operations | Access and notes |
| --- | --- | --- |
| `/auth` | login, refresh, logout, current user | Login public with throttling; other operations authenticated |
| `/users/assignees` | list active salespeople | Founder/Admin read; used by lead assignment UI |
| `/leads` | list/create | Read: Founder/Admin all, salesperson assigned only. Create: Admin only |
| `/leads/:id` | detail/edit/archive | Read: scoped. Edit/archive: Admin only |
| `/leads/:id/assign` | assign/reassign | Admin only; validates active salesperson and transfers pending follow-ups atomically |
| `/leads/:id/status` | change status | Admin or currently assigned salesperson; validates transition and appends event |
| `/leads/:id/events` | paginated timeline | Founder/Admin all; salesperson scoped to assigned lead |
| `/leads/:id/notes` | list/add internal notes | Read scoped including Founder; add Admin or assigned salesperson |
| `/leads/:id/follow-ups` | paginated list/create | Read scoped; create Admin or assigned salesperson |
| `/follow-ups/:id/complete` | complete pending follow-up | Admin or its currently assigned salesperson |
| `/imports/leads` | `POST /inspect` parses bounded XLSX/CSV for sheet/header preview; `POST /` stages mapped rows; `GET /` lists history; `GET /:batchId` reads paged row results; `POST /:batchId/commit` starts/retries commit; `GET /:batchId/rejected.csv` downloads a CSV report | Admin only. In-memory upload (10 MB max); 5,000 rows, 50 columns and 5,000 chars/cell maximum. Requires explicit duplicate row confirmations; commit is row-transactional and idempotent. |
| `/dashboard/salesperson` | personal queue and performance | Authenticated salesperson, server scoped to self |
| `/analytics/admin` | organization-wide metrics with filters | Founder/Admin permission; metric definitions documented |

Use dedicated endpoints for state-changing workflows so permission and event behavior cannot be bypassed via generic lead updates. A generic `PATCH /leads/:id` must reject direct changes to `status`, `assignedTo`, role, and other protected fields.

## Excel import protocol and failure handling

1. Upload workbook with file size/type limits; parse in a controlled server-side library after dependency approval. Reject macro-enabled/unsupported formats, malformed files, excessive rows/cells, and formulas where unsupported. Never execute spreadsheet content.
2. Validate sheet/header mapping and normalize each row, including phone numbers with country codes; return a preview with row numbers, field errors, duplicate classification, and proposed action. Keep staging separated from committed leads.
3. Detect duplicates within the upload and against existing records. Flag exact duplicates and possible duplicates separately, alongside invalid phone, missing required fields, and existing lead outcomes. Never automatically merge duplicate leads or silently overwrite them.
4. Commit valid rows with explicit policy (create/skip/update) and an idempotency key. Record per-row success/failure and batch totals. Support partial success; a bad row must not erase unrelated successful rows. On retries, return prior outcomes rather than duplicate creation. Use bounded chunks and resumable processing for large files; use background processing only when synchronous limits are exceeded.
5. Retain only necessary staging and private source files for a defined period; audit uploader and batch actions.

The inspect endpoint returns sheet names, headers and up to ten sample rows; it does not persist the source workbook. The staging endpoint accepts `multipart/form-data` fields `file`, `sheetName`, `mapping` (JSON), and `assignmentStrategy` (JSON). Required mappings are `name`, `phone`, `source`; `email` and `priority` are optional. Additional fields use `{key, header}` pairs. Assignment strategy is `{type:"unassigned",userIds:[]}`, `{type:"single",userIds:[id]}`, or `{type:"equal",userIds:[ordered ids]}`. Equal distribution is stable round-robin over ascending source row number. Commit accepts `{confirmedDuplicateRows:[rowNumber,...]}`. Confirmation is locked once the batch begins processing. Rows not confirmed are skipped; invalid rows remain reportable as rejected. Each committed Lead and its creation/assignment events are atomic with the row outcome. A retry processes failed rows only, and startup resumes batches interrupted while committing.

The server requires MongoDB replica-set or sharded transaction support and verifies the topology on startup. Workbook uploads are stored only in bounded memory during parsing; no temporary files or source workbooks persist. Rejected-row reports are formula-injection-safe CSV downloads and require Admin authentication.

## Assignment, status, and follow-up semantics

Assignment and status changes are service-level operations that update current lead state and append immutable `leadEvents` in one transaction where supported. Every event includes actor ID, prior/new values, UTC timestamp, and source. Reassignment preserves prior ownership for historical attribution and transfers all open follow-ups to the new owner, recording those transfers in activity history. Follow-up scheduling is a separate resource with due time, owner, state, and completion/reschedule history.

The LeadEvent types include `LEAD_CREATED`, `LEAD_UPDATED`, `LEAD_ARCHIVED`, `LEAD_ASSIGNED`, `LEAD_REASSIGNED`, `STATUS_CHANGED`, `NOTE_ADDED`, `FOLLOWUP_CREATED`, `FOLLOWUP_COMPLETED`, and `FOLLOWUP_TRANSFERRED`.

Lead statuses are `NEW`, `ASSIGNED`, `CONTACTED`, `INTERESTED`, `FOLLOW_UP_SCHEDULED`, `CONVERTED`, `NOT_INTERESTED`, `NO_RESPONSE`, and `INVALID_NUMBER`. The API rejects invalid transitions; completing the last pending follow-up returns a `FOLLOW_UP_SCHEDULED` lead to `CONTACTED`. Notes are separate immutable records, and note content is not embedded in the event description.

Allowed transitions are: `NEW` → `ASSIGNED`, `CONTACTED`, or `INVALID_NUMBER`; `ASSIGNED` → `CONTACTED`, `INTERESTED`, `FOLLOW_UP_SCHEDULED`, `CONVERTED`, `NOT_INTERESTED`, `NO_RESPONSE`, or `INVALID_NUMBER`; `CONTACTED` → `INTERESTED`, `FOLLOW_UP_SCHEDULED`, `CONVERTED`, `NOT_INTERESTED`, `NO_RESPONSE`, or `INVALID_NUMBER`; `INTERESTED` → `CONTACTED`, `FOLLOW_UP_SCHEDULED`, `CONVERTED`, `NOT_INTERESTED`, `NO_RESPONSE`, or `INVALID_NUMBER`; `FOLLOW_UP_SCHEDULED` → `CONTACTED`, `INTERESTED`, `CONVERTED`, `NOT_INTERESTED`, `NO_RESPONSE`, or `INVALID_NUMBER`; `NOT_INTERESTED` → `CONTACTED`; `NO_RESPONSE` → `CONTACTED`, `FOLLOW_UP_SCHEDULED`, `NOT_INTERESTED`, or `INVALID_NUMBER`. `CONVERTED` and `INVALID_NUMBER` are terminal.

Phone numbers must contain an international country code and are stored in normalized form for lookup. Exact normalized matches and possible matches sharing the last seven digits across country prefixes are returned distinctly. Creation/update rejects duplicates unless the caller explicitly confirms a separate lead. Confirming never merges records. The list API supports bounded `page`/`limit` (maximum 100), `q`, `status`, `priority`, `source`, `assignedTo`, and archived filters; salespeople cannot override their server-derived scope.

## Dashboard metric contract

Before building dashboards, document each metric's name, numerator/denominator, date field, timezone, status filters, and attribution rule. Distinguish current pipeline counts from period event counts. Decide whether “leads handled” follows the salesperson who owned a lead at the event time or current owner; report conversions by a defined cohort. Include unassigned leads only in authorized organization views. Use event history for historical assignment and status metrics.

## Indexes, performance, and operations

Database index recommendations are in `DATABASE.md`; indexes must match actual filters/sorts and be checked with query plans. Dashboard endpoints should bound date ranges, aggregation size, and response payload. Add rate limiting to authentication and uploads, structured logs with request IDs, and audit records for privileged actions. Never log credentials or full spreadsheet rows. Consider pre-aggregated daily summaries only after measuring query cost, and keep them rebuildable from source events.
