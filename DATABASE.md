# EduFinix CRM Database Design

## Platform conventions

Use MongoDB Atlas and Mongoose. Store timestamps in UTC and use `createdAt`/`updatedAt`; use ObjectId references. Define indexes from actual list/report query patterns and verify query plans as data grows. Paginate bounded lists. Avoid unbounded arrays of activity or import rows inside parent documents. Use transactions for workflows that update a lead and append history when the Atlas deployment supports transactions; otherwise design an idempotent reconciliation strategy. Schema/index changes need migration and deployment review.

## Collections

### `users`

- `name`, normalized unique `email`, `passwordHash`
- `role`: `founder`, `admin`, or `salesperson` (permissions mapped centrally; Founder read-only, Admin full management, salesperson assigned leads only)
- `active`, timestamps

Founder bootstrap and role-change policy must be defined; never allow an unauthenticated self-service role escalation. Preserve actor references on historical records when a user is deactivated.

### `authSessions` (or equivalent refresh-token records)

Store user reference, hashed refresh token/identifier, expiry, revocation time, rotation lineage, and created metadata. Never persist raw refresh tokens. TTL index can clean expired sessions, while authorization still checks revocation and user active state.

### `leads`

Store a unique readable `leadId`, `name`, original `phone`, canonical `normalizedPhone`, optional `email`, `source`, current `status`, `priority`, optional `assignedTo`, `assignedBy`, `createdBy`, `lastContactedAt`, `nextFollowUpAt`, `isArchived`, and timestamps. Status values are `NEW`, `ASSIGNED`, `CONTACTED`, `INTERESTED`, `FOLLOW_UP_SCHEDULED`, `CONVERTED`, `NOT_INTERESTED`, `NO_RESPONSE`, and `INVALID_NUMBER`. Server-side transition rules govern status changes.

Normalize phone numbers to canonical international form with country codes before duplicate detection; retain the original/display input. Never automatically merge duplicate leads. Flag exact matches separately from possible matches (same final seven digits across different country prefixes). On manual creation/update, require an explicit confirmation to keep a separate lead after reviewing matches. Do not assume phone is globally unique: shared numbers are allowed after confirmation. Use a non-unique normalized phone lookup index.

### `leadEvents`

Append-only complete activity history for lead creation/updates/archive, status changes, assignment/reassignment, note creation, follow-up creation/completion/transfers, and other auditable lead actions. Fields: `leadId` (Lead ObjectId reference), `actorId`, `eventType`, `previousValue`, `newValue`, `description`, and UTC `timestamp`. Query pages are bounded, but older history remains available through pagination. Correct errors with compensating events, not silent rewrites. Mongoose query middleware rejects updates/deletes.

### `leadNotes`

Internal notes are stored separately rather than in an unbounded `Lead.notes` array. Each immutable note has `leadId`, `authorId`, `body`, and timestamps. `NOTE_ADDED` events reference the note ID. Only Admins and the salesperson currently assigned to a lead can add/read its notes; Founder can read them.

### `followUps`

Separate records for scheduled contact work: `leadId`, `assignedTo`, `createdBy`, `scheduledAt`, status (`pending`, `completed`, `cancelled`), notes, `completedAt`, and timestamps. A lead may have multiple follow-ups. On reassignment, update all pending follow-ups to the new owner and append a `FOLLOWUP_TRANSFERRED` LeadEvent for each transferred item in the same transaction.

### `importBatches` and `importRows` (or equivalent staging)

Batch metadata: uploader, original filename, state, timestamps, file size, mapping/schema version, counts, and retention reference. Per-row staging/outcome records: source row number, normalized candidate data or protected reference, validation errors, duplicate classification, action (`create`, `skip`, `update`, `rejected`), and final result. Do not embed unlimited rows in one batch document. Store workbooks only in private object storage with short-lived access and a retention policy; do not store them in MongoDB documents. Ensure retries are idempotent and report row-level partial successes/failures.

Phase 4 stores no original workbook or disk temporary file. The upload is held in bounded server memory (10 MB maximum) for parsing and then discarded. `importBatches` stores filename, size, SHA-256 digest, selected worksheet, column mapping, assignment strategy, uploader and counters. `importRows` stores row number, staged mapped candidate, bounded raw cell values for report generation, validation issues, duplicate match references, commit state, attempt count, and resulting Lead reference. Staging rows expire 30 days after commit; batch summaries remain as import history. A unique `{ batchId: 1, rowNumber: 1 }` index ensures one staged result per source row.

Only `.xlsx` and UTF-8 `.csv` are accepted, up to 10 MB, 5,000 data rows, 50 columns, 5,000 characters per cell and 10 optional mapped fields. XLSX ZIP expansion is bounded and macro/external-link archives are rejected; formula cells are represented as invalid input and never evaluated. Exact normalized-phone matches and possible same-last-seven-digit matches are recorded separately. Duplicates within the file point to their source row. Nothing is merged automatically. Duplicate rows are skipped unless an Admin explicitly confirms the row is a separate lead during commit.

Commit processes rows independently. Each row's Lead, immutable LeadEvents and `importRows` outcome are written in one MongoDB transaction. Import row state is the idempotency record: retry only considers pending/failed rows, and imported rows cannot be created again. A transaction commit interruption can therefore be retried safely. Assignment strategy is snapshotted on the batch: unassigned, one salesperson, or round-robin in selected salesperson order across ascending source row numbers. MongoDB must report replica-set or sharded-cluster capability (`hello` response) at startup; a standalone server fails startup because the consistency guarantees rely on transactions.

## Index plan (initial, validate with query shapes)

- `users`: unique normalized email; session lookup by user/token hash and TTL by expiry.
- `leads`: unique `leadId`; compound `{ assignedTo: 1, status: 1, isArchived: 1, createdAt: -1 }` for salesperson queues; `{ status: 1, isArchived: 1, createdAt: -1 }` for admin filtering; non-unique `normalizedPhone` lookup; optional source filters after profiling.
- `leads`: non-unique `phoneSuffix` lookup for possible duplicate warnings (keep consistent with normalized phone on all create/update paths).
- `leadEvents`: `{ leadId: 1, timestamp: -1 }` for timeline; `{ actorId: 1, eventType: 1, timestamp: -1 }` for personal activity.
- `leadNotes`: `{ leadId: 1, createdAt: -1 }`.
- `followUps`: `{ assignedTo: 1, status: 1, scheduledAt: 1 }` for due queues; `{ leadId: 1, status: 1, scheduledAt: 1 }` for lead history.
- `importBatches`: `{ createdBy: 1, uploadedAt: -1 }` for history. `importRows`: unique `{ batchId: 1, rowNumber: 1 }`, `{ batchId: 1, commitStatus: 1, rowNumber: 1 }`, and TTL on finalized row `expiresAt` values for 30-day staging/report retention.

Do not add every suggested index blindly: indexes increase write and storage cost. Confirm with explain plans and expected report filters.

## Access and data lifecycle

Founder/Admin can access organization-wide CRM data according to permissions. Salespeople query leads currently assigned to their authenticated user and their own scoped metrics. Historical event visibility should follow an explicit policy (for example, own activity plus authorized lead context); avoid leaking another salesperson's private notes. Enforce scope in server services and query predicates.

Define retention/deletion for lead personal data, import staging, source files, and audit history before production. Deactivate users rather than deleting referenced actors. Apply a retention/minimization policy to free-text notes and uploaded data.

## Metric integrity

Dashboard metrics must distinguish current-state snapshots from event counts over a time range. Use `leadEvents` for assignment/status activity and ownership intervals, not the lead's current `assignedTo` alone. Record UTC event time and apply one documented reporting timezone at query/display time. Define conversion cohorts and attribution when a lead changes salesperson. For scale, aggregation pipelines and optional daily summary snapshots may be introduced after baseline query profiling; summaries must be rebuildable from events.
