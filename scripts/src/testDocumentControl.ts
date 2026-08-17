/**
 * Integration tests for Phase 1 document control:
 *  - acknowledgment gate cannot be bypassed via the generic document endpoints
 *    (revision-backed documents are hidden from the job documents list, and
 *    their generic download / delete return 403)
 *  - the guarded revision file endpoint 403s before ack and 200s after
 *  - RFI / ECN / transmittal references are rejected when they point at a
 *    different job's drawings, revisions, or documents
 *
 * Requires the API server workflow to be running. Creates its own temp user
 * and two temp jobs, and cleans everything up afterwards.
 *
 * Run: pnpm --filter @workspace/scripts run test:document-control
 */
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  usersTable,
  userCompanyRolesTable,
  jobsTable,
  documentsTable,
  drawingsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const BASE = process.env.API_BASE_URL ?? "http://localhost:80/api";
const COMPANY_ID = 1;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

async function main() {
  const tag = randomUUID().slice(0, 8);
  const email = `doc-control-test-${tag}@example.com`;
  const password = randomUUID();

  // ── Setup: temp user + two temp jobs ────────────────────────────────────
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Doc Control Test",
      passwordHash: bcrypt.hashSync(password, 10),
    })
    .returning();
  await db.insert(userCompanyRolesTable).values({
    userId: user.id,
    companyId: COMPANY_ID,
    role: "admin",
  });
  const jobs = await db
    .insert(jobsTable)
    .values([
      { companyId: COMPANY_ID, jobNumber: `TEST-A-${tag}`, name: "DC test A", customer: "DC Test Co" },
      { companyId: COMPANY_ID, jobNumber: `TEST-B-${tag}`, name: "DC test B", customer: "DC Test Co" },
    ])
    .returning();
  const [jobA, jobB] = jobs;

  let cookie = "";
  const api = async (
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(init.headers ?? {}),
        cookie,
      },
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body };
  };

  const cleanupDocIds: number[] = [];
  try {
    // ── Login ───────────────────────────────────────────────────────────
    const login = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    check("login", login.status === 200, login.body);
    if (login.status !== 200) throw new Error("cannot continue without login");
    if (login.body.companyId !== COMPANY_ID) {
      await api("/auth/switch-company", {
        method: "POST",
        body: JSON.stringify({ companyId: COMPANY_ID }),
      });
    }

    const upload = (fields: Record<string, string>) => {
      const fd = new FormData();
      fd.set(
        "file",
        new Blob([`%PDF-1.4 dc-test ${tag}\n%%EOF\n`], {
          type: "application/pdf",
        }),
        "dc-test.pdf",
      );
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      return fd;
    };

    // ── Drawing on job A: Rev A, then Rev B (supersedes, unacked) ────────
    const created = await api(`/jobs/${jobA.id}/drawings`, {
      method: "POST",
      body: upload({ drawingNumber: `D-${tag}`, revisionLabel: "A" }),
    });
    check("create drawing", created.status === 201, created.body);
    const drawingId = created.body.id as number;
    const revised = await api(`/drawings/${drawingId}/revisions`, {
      method: "POST",
      body: upload({
        revisionLabel: "B",
        changeSummary: "test supersede",
        status: "issued_for_fabrication",
      }),
    });
    check("create revision B", revised.status === 201, revised.body);
    const revs: any[] = revised.body.revisions;
    const revB = revs.find((r) => r.revisionLabel === "B");
    const revA = revs.find((r) => r.revisionLabel === "A");
    check("rev B active, rev A superseded",
      revB?.isActive === true && revA?.isActive === false && revA?.supersededAt);
    cleanupDocIds.push(revA.documentId, revB.documentId);

    // ── Ack-gate bypass attempts via generic document endpoints ──────────
    const docList = await api(`/jobs/${jobA.id}/documents`);
    const listedIds = (docList.body as any[]).map((d) => d.id);
    check(
      "revision-backed docs hidden from job documents list",
      !listedIds.includes(revA.documentId) && !listedIds.includes(revB.documentId),
      listedIds,
    );
    const genericDl = await api(`/documents/${revB.documentId}/download`);
    check("generic download of revision-backed doc → 403", genericDl.status === 403, genericDl.status);
    const genericDel = await api(`/documents/${revB.documentId}`, { method: "DELETE" });
    check("generic delete of revision-backed doc → 403", genericDel.status === 403, genericDel.status);

    const gatedBefore = await api(`/drawing-revisions/${revB.id}/file`);
    check("revision file before ack → 403", gatedBefore.status === 403, gatedBefore.status);
    const ack = await api(`/drawing-revisions/${revB.id}/acknowledge`, { method: "POST" });
    check("acknowledge", ack.status === 201, ack.body);
    const gatedAfterRes = await fetch(`${BASE}/drawing-revisions/${revB.id}/file`, {
      headers: { cookie },
    });
    check("revision file after ack → 200", gatedAfterRes.status === 200, gatedAfterRes.status);

    // ── Cross-job reference rejection ─────────────────────────────────────
    const rfiWrongJob = await api(`/jobs/${jobB.id}/rfis`, {
      method: "POST",
      body: JSON.stringify({ question: "cross-job?", drawingId }),
    });
    check("RFI referencing other job's drawing → 400", rfiWrongJob.status === 400, rfiWrongJob.body);
    const rfiWrongRev = await api(`/jobs/${jobB.id}/rfis`, {
      method: "POST",
      body: JSON.stringify({ question: "cross-job rev?", drawingRevisionId: revB.id }),
    });
    check("RFI referencing other job's revision → 400", rfiWrongRev.status === 400, rfiWrongRev.body);
    const ecnWrongJob = await api(`/jobs/${jobB.id}/ecns`, {
      method: "POST",
      body: JSON.stringify({
        source: "internal",
        description: "cross-job ecn",
        affectedRevisionIds: [revB.id],
      }),
    });
    check("ECN referencing other job's revision → 400", ecnWrongJob.status === 400, ecnWrongJob.body);
    const tWrongRev = await api(`/jobs/${jobB.id}/transmittals`, {
      method: "POST",
      body: JSON.stringify({
        sentDate: "2026-08-14",
        recipient: "X",
        purpose: "for_record",
        items: [{ drawingRevisionId: revB.id }],
      }),
    });
    check("transmittal referencing other job's revision → 400", tWrongRev.status === 400, tWrongRev.body);
    const tWrongDoc = await api(`/jobs/${jobB.id}/transmittals`, {
      method: "POST",
      body: JSON.stringify({
        sentDate: "2026-08-14",
        recipient: "X",
        purpose: "for_record",
        items: [{ documentId: revB.documentId }],
      }),
    });
    check("transmittal referencing other job's document → 400", tWrongDoc.status === 400, tWrongDoc.body);

    // ── Handoff cannot bypass the ack gate ────────────────────────────────
    const handoff = await api(`/jobs/${jobA.id}/handoffs`, {
      method: "POST",
      body: JSON.stringify({
        destinationCompanyId: 2,
        documentIds: [revB.documentId],
      }),
    });
    check(
      "job handoff with revision-backed document → 400",
      handoff.status === 400,
      { status: handoff.status, body: handoff.body },
    );

    // ── Closeout package uses only the Active revision ────────────────────
    // Mark the SUPERSEDED rev A as as_built_final: it must NOT enter closeout.
    await api(`/drawing-revisions/${revA.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "as_built_final" }),
    });
    const closeout1 = await api(`/jobs/${jobA.id}/closeout-package`);
    check(
      "superseded as_built_final revision excluded from closeout",
      closeout1.status === 200 && closeout1.body.asBuiltCount === 0,
      closeout1.body,
    );
    // Mark the ACTIVE rev B as as_built_final: exactly one entry expected.
    await api(`/drawing-revisions/${revB.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "as_built_final" }),
    });
    const closeout2 = await api(`/jobs/${jobA.id}/closeout-package`);
    check(
      "active as_built_final revision counted once in closeout",
      closeout2.status === 200 &&
        closeout2.body.asBuiltCount === 1 &&
        closeout2.body.asBuiltDrawings.length === 1 &&
        closeout2.body.asBuiltDrawings[0].revision.id === revB.id,
      closeout2.body,
    );

    // Positive controls on the correct job
    const rfiOk = await api(`/jobs/${jobA.id}/rfis`, {
      method: "POST",
      body: JSON.stringify({ question: "same-job ok", drawingId, drawingRevisionId: revB.id }),
    });
    check("RFI on the drawing's own job → 201", rfiOk.status === 201, rfiOk.body);
  } finally {
    // ── Cleanup ───────────────────────────────────────────────────────────
    await db.delete(drawingsTable).where(inArray(drawingsTable.jobId, [jobA.id, jobB.id]));
    if (cleanupDocIds.length) {
      await db.delete(documentsTable).where(inArray(documentsTable.id, cleanupDocIds));
    }
    await db.delete(jobsTable).where(inArray(jobsTable.id, [jobA.id, jobB.id]));
    await db.delete(userCompanyRolesTable).where(eq(userCompanyRolesTable.userId, user.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll document-control integration checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
