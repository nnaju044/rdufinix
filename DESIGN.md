# EduFinix CRM Design

## Purpose and scope

EduFinix CRM is an internal lead management and sales performance platform. The initial workflow covers Excel lead intake, assignment and reassignment, salesperson follow-up and status management, and Founder/Admin reporting. Application features remain subject to staged implementation and review.

## Architecture

- `client/` is a browser-only React SPA built with Vite and JavaScript JSX. It contains presentation, navigation, client-side validation, and API calls; it never connects to MongoDB or makes authorization decisions.
- `server/` is a Node.js/Express JavaScript ES module API. It owns authentication, authorization, validation, business rules, reporting queries, and persistence.
- MongoDB Atlas is accessed through Mongoose from server services/repositories only. Do not expose database credentials or secrets to Vite variables; `VITE_*` configuration is public at build time.
- The client uses a centralized API client plus feature-oriented API modules. Components do not issue direct HTTP requests.
- Server code stays separated into `config/`, `models/`, `routes/`, `controllers/`, `middleware/`, and `services/`. Keep transaction boundaries and multi-document workflows in services.

The client/server separation in the scaffold is appropriate. A separate shared package or microservice is not justified for the initial single-team MVP; keep the workspace packages independent and introduce shared contracts only if duplication becomes material.

## Client conventions

Use reusable components, route-level pages, hooks, an auth/session context, and feature API modules. Client route guards improve navigation only; they do not secure data. Show server-returned validation and authorization errors clearly. Avoid putting refresh credentials in browser local storage.

## Server conventions

Routes compose authentication, authorization, and request validation middleware. Controllers translate HTTP input/output and delegate workflows to services. Services enforce state transitions, assignment rules, import behavior, and metrics definitions. Models own schema constraints and indexes. Add a centralized error handler, request correlation IDs, and structured audit-safe logs; never log passwords, tokens, or full imported personal data.

## Identity, roles, and access

Initial roles are `founder`, `admin`, and `salesperson`, with permissions defined centrally rather than scattered role string checks. Founder has read-only access to all CRM data and analytics. Admin has full management permissions. Salespersons can access only leads currently assigned to them. Do not accept user ID, role, or scope from a client as authority. Derive scope from the authenticated principal and enforce it in every query and mutation, including exports and analytics. Consider field-level restrictions for sensitive user and lead fields.

Authentication should use short-lived access JWTs and revocable, rotated refresh sessions. Store refresh tokens as hashes in a session/token collection; prefer an HttpOnly, Secure, SameSite cookie for browser refresh credentials with CSRF protection where cookie-based cross-site requests are possible. Validate issuer, audience, expiry, and signing algorithm; support logout/revocation and account deactivation. Rate-limit login and upload endpoints. Require strong secret configuration and fail startup when required environment values are missing.

The current scaffold's lightweight in-memory authentication throttle is suitable only for a single process. Replace it with a shared store before horizontal scaling so limits apply across instances.

## MVP workflow boundaries

1. Admin creates leads with an international phone number. Exact and possible phone matches are shown separately; a human must confirm a separate record, and duplicates are never merged.
2. Admin assigns or reassigns leads. Current ownership is stored on the lead and every assignment/reassignment action is retained in complete activity history with timestamp and actor ID.
3. Salesperson records contact/status outcomes, adds internal notes, and schedules/completes follow-ups. Notes are separate immutable records. Follow-ups have due time, completion state, and actor; on lead reassignment, pending follow-ups transfer to the new owner and each transfer is recorded in history.
4. Roles: Founder can read all leads, notes, events, and follow-ups; Admin can manage all leads; Salesperson can access only assigned leads. Backend middleware and scoped service queries enforce these rules.

Lead statuses: `NEW`, `ASSIGNED`, `CONTACTED`, `INTERESTED`, `FOLLOW_UP_SCHEDULED`, `CONVERTED`, `NOT_INTERESTED`, `NO_RESPONSE`, and `INVALID_NUMBER`. The server validates transitions and records each successful change.
4. Dashboards use documented metric definitions and an event/ownership history that can attribute work to the correct salesperson and time window.

## Lead import architecture

Lead import is an Admin-only staged workflow within the existing Express service architecture. The parser accepts `.xlsx` and UTF-8 `.csv` in bounded memory, inspects content on the server, rejects malformed/oversized workbooks, caps files at 10 MB and 5,000 data rows, and never evaluates formulas. The initial inspect request returns available worksheets, headers and a small sample for mapping. A second upload stores a batch and bounded row-level staging documents, not a retained workbook or temporary file.

The service normalizes international phones, validates each row, flags exact and possible matches against the database and uploaded rows, and leaves duplicate decisions to an Admin. Duplicate rows are not merged. Import commits are resumable and process rows independently; each Lead, creation/assignment event and row outcome commit in one MongoDB transaction. Assignment is unassigned, single-owner or stable round-robin by selected salesperson order and source row. Startup checks for replica-set or sharded transaction support. Import row details are retained for 30 days after finalization; batch summaries remain in history.

## Reporting correctness

Define metric semantics before implementing dashboards: reporting timezone, date field used for each chart, whether counts are current-state or period events, treatment of unassigned leads, reassignment attribution, and conversion cohort/denominator. Store immutable status and assignment events with UTC timestamps. Current lead state alone cannot correctly reconstruct past ownership or period activity. Founder/Admin aggregates are organization-wide; salesperson aggregates are computed with server-enforced self scope.

## Configuration and source layout

Use environment-based configuration and validate it at startup. Keep `.env` files out of version control; provide placeholders only. Proposed layout:

```text
client/src/{components,pages,hooks,services/api,context,utils}/
server/src/{config,models,controllers,routes,middleware,services,utils}/
```

Avoid premature microservices, generic workflow engines, or a large abstraction layer. Start with a modular monolith; introduce background workers only if measured import/report workloads require them.
