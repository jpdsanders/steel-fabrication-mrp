# Product Requirements Document
## Steel Fabrication MRP System

**Document Version:** 1.0  
**Status:** Draft  
**Date:** June 30, 2026  

---

## 1. Overview

### 1.1 Product Summary

The Steel Fabrication MRP System is a multi-organization, web-based manufacturing resource planning platform purpose-built for steel fabrication shops. It replaces disconnected tools with a single, integrated system that manages the full lifecycle of a fabrication job — from initial estimate and customer quote through purchasing, shop floor production, time tracking, document control, and final job closeout with full material traceability.

The system will serve three independent organizations, each operating with fully isolated data, branding, and user management under a shared platform infrastructure.

### 1.2 Goals

- Provide end-to-end job visibility from estimate to closeout
- Replace unreliable third-party time tracking with native, job-stage-aware clock in/out
- Establish full heat number traceability from PO → receiving → part number → MTR
- Centralize document control with revision tracking for drawings, certifications, and inspection records
- Generate customer-facing quote documents and job closeout material certification packages
- Give project managers and supervisors real-time production and cost data

### 1.3 Out of Scope (v1.0)

- Accounting or ERP integration (future phase)
- Customer-facing portal
- Automated supplier pricing API integrations (manual live pricing entry in v1.0)
- Role definitions (to be finalized in a later phase)

---

## 2. Users & Organizations

### 2.1 Multi-Organization Architecture

- The platform supports **three independent organizations**
- Each organization has its own:
  - Isolated database/data environment
  - Branding (logo, colors) used on generated documents
  - User base and role assignments
  - Configuration (stages, document templates, material catalog)
- There is no cross-organization data sharing or parent dashboard in v1.0

### 2.2 Role-Based Access Control

- The system will be built with a flexible, configurable role and permission framework
- Specific roles and permission sets will be defined in a subsequent phase
- Example role categories (to be confirmed): Shop Floor Worker, Estimator, Purchasing Agent, Project Manager, Document Controller, Administrator
- Access to modules, records, and actions will be gated by role

---

## 3. Modules

---

### 3.1 Production Tracking

#### 3.1.1 Overview
Jobs move through a defined set of production stages. The system tracks the current stage of each job, time spent per stage, and provides real-time visibility into shop floor status.

#### 3.1.2 Default Production Workflow
The default stage sequence for a job is:

1. Estimating
2. Fabrication
3. Welding
4. Paint
5. Inspection
6. Shipping

#### 3.1.3 Custom Routing
- Each job can be configured with a custom stage sequence at the time of job creation
- Stages can be added, removed, or reordered per job (e.g., adding Galvanizing, Sandblasting, or Third-Party Inspection)
- A library of available stages will be maintained and configurable by administrators
- The default workflow serves as a template; deviations are tracked and visible

#### 3.1.4 Job Record
Each job will contain:
- Job number and name
- Customer information
- Associated estimate/quote
- Assigned production stages and current stage
- Linked documents (drawings, specs, inspection records)
- Linked POs and material/heat number records
- Labor hours (burned vs. estimated) by stage
- Job status (Active, On Hold, Complete, Closed)
- Notes and activity log

#### 3.1.5 Dashboard
- Real-time view of all active jobs and their current stage
- Hours burned vs. hours remaining per job
- Outstanding POs per job
- Jobs approaching or past due date
- Filterable by organization, job status, stage, and assigned team

---

### 3.2 Estimating

#### 3.2.1 Overview
The estimating module allows estimators to build detailed job cost estimates from material takeoffs and labor, then generate formal branded quote documents for customers.

#### 3.2.2 Material Takeoffs
- Estimators build a bill of materials (BOM) line by line from drawings and specifications
- Each line item includes: description, material type/grade, quantity, unit of measure (lbs, linear ft, each, etc.)
- Material items are sourced from the internal material catalog or entered manually

#### 3.2.3 Material Catalog
- Each organization maintains a catalog of standard steel sections, plate sizes, hardware, and consumables
- Catalog items include a baseline/fallback unit price
- Prices can be overridden per estimate with live supplier pricing
- Catalog is administrator-maintained and updatable

#### 3.2.4 Live Supplier Pricing
- Estimators can enter live pricing obtained from suppliers directly on the estimate
- Live pricing overrides catalog baseline pricing for that estimate
- Supplier name and quote reference can be recorded per line item for traceability
- Both baseline and live pricing are preserved for comparison

#### 3.2.5 Labor Estimation
- Labor hours are estimated by trade/stage (e.g., Fitting, Welding, Painting, Inspection)
- Each labor category has a configurable hourly rate
- Total labor cost is calculated automatically from hours × rate
- Labor estimates are linked to production stages for burn tracking during execution

#### 3.2.6 Estimate Summary
- Automatic rollup of material cost, labor cost, and applied margin/markup
- Support for additional cost line items (freight, subcontractor, equipment, etc.)
- Configurable tax and markup rules per organization

#### 3.2.7 Quote Document Generation
- Estimates can be published as formal customer-facing quote documents
- Quote PDFs include: organization branding (logo, name, contact info), job description, itemized or summary pricing (configurable), terms and conditions, validity date, and signature block
- Quote templates are configurable per organization
- Quotes are versioned; revisions generate a new quote version tied to the same job
- Quotes are stored in the document control module automatically upon generation

---

### 3.3 Document Control

#### 3.3.1 Overview
Centralized document management for all job-related and organizational documents, with a strong emphasis on revision control for drawings and traceability for certifications and inspection records.

#### 3.3.2 Document Types
The system will support the following document categories:

| Category | Examples |
|---|---|
| Drawings | Shop drawings, engineering drawings, erection drawings |
| Specifications | Project specs, scope of work documents |
| Material Certifications | MTRs (Mill Test Reports), material certs |
| Weld Procedures | WPS (Weld Procedure Specifications), PQRs |
| Inspection Records | Third-party inspection reports, QC checklists |
| Transmittals | Document transmittal records |
| RFIs | Requests for Information and responses |
| Quotes | Customer-facing quote documents (auto-populated from Estimating) |

#### 3.3.3 Revision Tracking — Drawings
- Every drawing upload is assigned a revision identifier (e.g., Rev A, Rev B, or numeric)
- The system maintains a full revision history; previous revisions are retained and accessible
- The current/active revision is clearly indicated
- Superseded revisions are marked and access-restricted by role if needed
- Users can compare revision notes side by side
- Notifications can be triggered when a drawing is revised (to be defined in roles phase)

#### 3.3.4 MTR Management
- MTRs are uploaded and linked to:
  - A specific heat number
  - A specific PO / receiving record
  - One or more jobs
- MTRs are retrievable by heat number, job, or material type
- MTRs are included in the job closeout traceability report

#### 3.3.5 Transmittals
- Transmittals record the formal submission or receipt of documents between parties
- Each transmittal logs: date, sender, recipient, document list, revision levels, and purpose (For Approval, For Record, For Construction, etc.)
- Transmittal history is retained per job

#### 3.3.6 RFIs
- RFIs can be created, assigned, and tracked per job
- Each RFI contains: number, date submitted, question/description, submitted by, directed to, due date, status (Open, Pending, Closed), and response
- RFI log is viewable per job

#### 3.3.7 Document Storage
- Documents are stored securely per organization
- Searchable by job, document type, revision, date, and keyword
- All documents are downloadable with appropriate role permissions

---

### 3.4 Purchasing

#### 3.4.1 Overview
The purchasing module manages purchase orders from creation through receiving, with full traceability back to jobs and heat numbers. POs are primarily job-driven but can also be created independently (e.g., stock purchases).

#### 3.4.2 Purchase Orders
- POs can be created:
  - Directly from a job's bill of materials (single-click generation from estimate)
  - Independently for stock or non-job-specific purchases
- Each PO contains: PO number, vendor, line items (description, quantity, unit, unit price, total), job linkage (optional), requested delivery date, and status

#### 3.4.3 PO Status Tracking
PO statuses:
- **Draft** — created but not sent
- **Submitted** — sent to vendor
- **Acknowledged** — vendor confirmed
- **Partially Received** — some items received
- **Fully Received** — all items received
- **Closed** — complete and reconciled
- **Cancelled**

#### 3.4.4 Receiving
- Each PO has a receiving log where deliveries are recorded
- Partial receipts are supported; each delivery is recorded separately
- Received items are matched back to PO line items
- Discrepancies (short shipments, substitutions) are flagged

#### 3.4.5 Heat Number Tracking
- During receiving, heat numbers are recorded per line item
- Each heat number entry captures: heat number, material description, grade/spec, quantity received, associated MTR (uploaded or linked from document control), and job linkage
- Heat numbers are searchable across the system
- A single heat number can be associated with multiple jobs if material is split

#### 3.4.6 Heat Number → MTR Linkage
- When a heat number is entered at receiving, the system prompts for or links an MTR document
- If an MTR has already been uploaded to document control, it can be linked directly
- If not yet received, the MTR can be attached later; the record is flagged as pending MTR
- This creates the core traceability chain: PO → Receiving → Heat Number → MTR

#### 3.4.7 Outstanding PO Dashboard
- Real-time view of all open POs across jobs
- Filterable by vendor, job, status, and expected delivery date
- Overdue POs (past requested delivery date with no receipt) are highlighted

---

### 3.5 Time Tracking

#### 3.5.1 Overview
Native clock in/out time tracking built directly into the system, replacing third-party tools. Time entries are tied to a specific job and production stage, enabling real-time labor cost tracking against estimates.

#### 3.5.2 Clock In/Out
- Employees clock in by selecting:
  1. Their name or employee ID
  2. The job they are working on
  3. The specific production stage (e.g., Welding, Fabrication)
- Employees clock out from the same interface; total time is calculated automatically
- Multiple employees can be clocked into the same job/stage simultaneously

#### 3.5.3 Shop Floor Interface
- A simplified, touch-friendly interface optimized for:
  - Shop floor desktop/kiosk computer
  - Mobile phone (responsive web)
  - Tablet
- Large buttons, minimal navigation — designed for use in a shop environment
- Workers only see what they need: find job → clock in → clock out

#### 3.5.4 Supervisor Controls
- Supervisors can view who is currently clocked in and to which job/stage
- Supervisors can edit or correct time entries
- Manual time entry is supported for missed punches

#### 3.5.5 Labor vs. Estimate Tracking
- Hours logged per job/stage are compared in real time against estimated hours
- Project managers see: estimated hours, hours burned, hours remaining, and percent complete per stage and per job
- Alerts or indicators when a job/stage is approaching or exceeding estimated hours

#### 3.5.6 Payroll Export (Future Consideration)
- Time data will be structured to support future export to payroll systems
- No direct payroll integration in v1.0

---

### 3.6 Reporting

#### 3.6.1 Job Status Report
- Summary of all active jobs showing current stage, percent complete, hours burned vs. estimated, and open POs
- Filterable by job, date range, stage, and status

#### 3.6.2 Labor Detail Report
- Hours worked per employee, per job, per stage, and per date range
- Supports job cost reconciliation and payroll review

#### 3.6.3 Outstanding PO Report
- All open POs with status, vendor, expected delivery date, and linked job
- Highlights overdue items

#### 3.6.4 Job Closeout — Material Traceability Report
- Generated at job closeout
- Maps every part number on the job to its assigned heat number
- Includes linked MTR document reference (filename, upload date, document control ID)
- Exportable as PDF for submission to inspectors, owners, or general contractors
- This report serves as the material certification package for the job

#### 3.6.5 Estimate vs. Actual Report
- Compares estimated material cost, labor cost, and total job cost against actual values at closeout
- Identifies cost overruns and efficiency trends over time

---

## 4. Technical Considerations

### 4.1 Platform
- Web-based application accessible via desktop browser, mobile browser, and tablet
- Responsive design with a dedicated simplified view for shop floor use cases

### 4.2 Multi-Tenancy
- Each of the three organizations operates in a fully isolated data environment
- Organization-level configuration for branding, stage libraries, material catalogs, labor rates, and document templates

### 4.3 Document Storage
- Secure file storage for all uploaded documents (drawings, MTRs, inspection records, etc.)
- Version-controlled storage for drawing revisions

### 4.4 Export & Output Formats
- Quote documents: PDF
- Job Closeout Traceability Report: PDF
- Data reports: PDF and/or CSV
- All exports branded per organization

### 4.5 Authentication & Security
- Role-based access control enforced at the API and UI level
- Secure login per organization
- Audit logging for document access, revisions, and key data changes

---

## 5. Future Phases (Noted for Consideration)

| Feature | Notes |
|---|---|
| Role definitions | Specific roles and permissions to be defined and configured |
| Payroll integration | Export time tracking data to payroll platforms |
| Supplier pricing API | Live pricing feeds from steel service centers |
| Accounting/ERP integration | Connect job costs to financial systems |
| Customer portal | Allow customers to track job status and access documents |
| Mobile app (native) | Native iOS/Android app for shop floor time tracking |
| Advanced analytics | Trend reporting across jobs, estimating accuracy over time |

---

## 6. Open Questions

| # | Question | Owner |
|---|---|---|
| 1 | What are the specific roles and permission levels for each user type? | Client |
| 2 | What are the branding assets (logos, colors) for each of the three organizations? | Client |
| 3 | What fields are required on a customer quote document per organization? | Client |
| 4 | Are there specific material grades/specs that need to be pre-loaded into the material catalog? | Client |
| 5 | What file formats will drawings and documents be submitted in (PDF, DWG, etc.)? | Client |
| 6 | Will employees have individual logins or will the shop floor use a shared kiosk login? | Client |
| 7 | Are there existing job numbering or document numbering conventions to preserve? | Client |
| 8 | What are the terms and conditions included on quote documents? | Client |

---

*Document prepared following discovery session. Version 1.0 — subject to revision as requirements are refined.*

