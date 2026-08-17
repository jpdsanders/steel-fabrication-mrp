import {
  DrawingRevisionStatus,
  EcnSource,
  EcnDisposition,
  EcnStatus,
  RfiStatus,
  TransmittalPurpose,
} from "@workspace/api-client-react";

/** File input accept list — mirrors DocumentsCard plus CAD model formats. */
export const DRAWING_ACCEPT =
  ".pdf,.dwg,.dxf,.nc1,.nc,.jpg,.jpeg,.png,.xlsx,.csv,.kss,.xml,.step,.stp,.igs,.iges";

export const REVISION_STATUS_LABELS: Record<DrawingRevisionStatus, string> = {
  issued_for_approval: "Issued for Approval",
  approved: "Approved",
  approved_as_noted: "Approved as Noted",
  rejected_revise_resubmit: "Rejected – Revise & Resubmit",
  issued_for_fabrication: "Issued for Fabrication",
  as_built_final: "As-Built / Final",
};

export const REVISION_STATUS_ORDER: DrawingRevisionStatus[] = [
  "issued_for_approval",
  "approved",
  "approved_as_noted",
  "rejected_revise_resubmit",
  "issued_for_fabrication",
  "as_built_final",
];

export const RFI_STATUS_LABELS: Record<RfiStatus, string> = {
  open: "Open",
  pending: "Pending",
  closed: "Closed",
};

export const ECN_SOURCE_LABELS: Record<EcnSource, string> = {
  customer: "Customer",
  internal: "Internal",
  field: "Field",
};

export const ECN_DISPOSITION_LABELS: Record<EcnDisposition, string> = {
  rework: "Rework",
  scrap: "Scrap",
  fabricate_to_new_rev: "Fabricate to New Rev",
  no_impact: "No Impact",
};

export const ECN_STATUS_LABELS: Record<EcnStatus, string> = {
  open: "Open",
  approved: "Approved",
  closed: "Closed",
};

export const TRANSMITTAL_PURPOSE_LABELS: Record<TransmittalPurpose, string> = {
  for_approval: "For Approval",
  for_record: "For Record",
  for_construction: "For Construction",
  for_information: "For Information",
  other: "Other",
};

/** Build an absolute URL for the API server (matches DocumentsCard pattern). */
export function apiFileUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${base}${clean}`;
}

/**
 * Plain-fetch multipart uploader for endpoints where the generated hooks
 * fight FormData. Mirrors DocumentsCard.uploadDocumentFile.
 */
export async function postMultipart(
  path: string,
  form: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const url = apiFileUrl(path);
  try {
    const res = await fetch(url, {
      method: "POST",
      body: form,
      credentials: "include",
    });
    if (!res.ok) {
      let message = "Upload failed";
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {
        // keep default
      }
      return { ok: false, error: message };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Upload failed" };
  }
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

/** Local YYYY-MM-DD (for date inputs / transmittal default). */
export function todayIso(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function truncate(text: string, max = 60): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
