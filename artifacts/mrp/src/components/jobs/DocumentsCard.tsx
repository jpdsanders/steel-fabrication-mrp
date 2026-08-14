import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListJobDocuments,
  useListEstimateDocuments,
  useDeleteDocument,
  getListJobDocumentsQueryKey,
  getListEstimateDocumentsQueryKey,
  getDownloadDocumentUrl,
  DocumentCategory,
  type Document,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  FileImage,
  FileSpreadsheet,
  FileCode,
  File as FileIcon,
  Upload,
  Download,
  Trash2,
  Loader2,
  Paperclip,
} from "lucide-react";

export const ACCEPT = ".pdf,.dwg,.dxf,.nc1,.nc,.jpg,.jpeg,.png,.xlsx,.csv,.kss,.xml";

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  drawing: "Drawing",
  mtr: "MTR",
  photo: "Photo",
  nc_data: "NC Data",
  spreadsheet: "Spreadsheet",
  other: "Other",
};

function fileIcon(doc: Document) {
  const ext = doc.filename.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png"].includes(ext))
    return <FileImage className="w-4 h-4" />;
  if (["xlsx", "csv"].includes(ext))
    return <FileSpreadsheet className="w-4 h-4" />;
  if (["nc1", "nc", "dwg", "dxf"].includes(ext))
    return <FileCode className="w-4 h-4" />;
  if (ext === "pdf") return <FileText className="w-4 h-4" />;
  return <FileIcon className="w-4 h-4" />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type DocumentOwner =
  | { type: "job"; id: number }
  | { type: "estimate"; id: number };

export async function uploadDocumentFile(
  owner: DocumentOwner,
  file: File,
  category: DocumentCategory,
): Promise<{ ok: boolean; error?: string }> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const url =
    owner.type === "job"
      ? `${base}/api/jobs/${owner.id}/documents`
      : `${base}/api/estimates/${owner.id}/documents`;
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);
    const res = await fetch(url, { method: "POST", body: formData });
    if (!res.ok) {
      let message = "Upload failed";
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {
        // keep default message
      }
      return { ok: false, error: message };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Upload failed" };
  }
}

export default function DocumentsCard({ owner }: { owner: DocumentOwner }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [category, setCategory] = useState<DocumentCategory>("drawing");
  const [isUploading, setIsUploading] = useState(false);

  const isJob = owner.type === "job";
  const listQueryKey = isJob
    ? getListJobDocumentsQueryKey(owner.id)
    : getListEstimateDocumentsQueryKey(owner.id);

  const jobQuery = useListJobDocuments(owner.id, {
    query: {
      enabled: isJob && !!owner.id,
      queryKey: getListJobDocumentsQueryKey(owner.id),
    },
  });
  const estimateQuery = useListEstimateDocuments(owner.id, {
    query: {
      enabled: !isJob && !!owner.id,
      queryKey: getListEstimateDocumentsQueryKey(owner.id),
    },
  });
  const documents = isJob ? jobQuery.data : estimateQuery.data;

  const deleteDocument = useDeleteDocument({
    mutation: {
      onSuccess: () => {
        toast({ title: "Document deleted" });
        queryClient.invalidateQueries({ queryKey: listQueryKey });
      },
      onError: () => {
        toast({ title: "Failed to delete document", variant: "destructive" });
      },
    },
  });

  const handleUpload = async () => {
    if (!pendingFile) return;
    setIsUploading(true);
    try {
      const result = await uploadDocumentFile(owner, pendingFile, category);
      if (!result.ok) {
        toast({ title: result.error ?? "Upload failed", variant: "destructive" });
        return;
      }
      toast({ title: "Document uploaded" });
      setPendingFile(null);
      queryClient.invalidateQueries({ queryKey: listQueryKey });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row justify-between items-center">
        <CardTitle className="flex items-center gap-2">
          <Paperclip className="w-5 h-5" /> Documents
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-4 h-4" /> Upload
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setPendingFile(file);
              setCategory("drawing");
            }
            e.target.value = "";
          }}
        />
      </CardHeader>
      <CardContent>
        {documents && documents.length > 0 ? (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-3 border rounded-md px-3 py-2"
              >
                <span className="text-muted-foreground shrink-0">
                  {fileIcon(doc)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate" title={doc.filename}>
                    {doc.filename}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                      {CATEGORY_LABELS[doc.category]}
                    </Badge>
                    <span>{formatSize(doc.sizeBytes)}</span>
                    <span>{new Date(doc.uploadedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                    <a
                      href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}${getDownloadDocumentUrl(doc.id)}`}
                      download={doc.filename}
                      aria-label={`Download ${doc.filename}`}
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    aria-label={`Delete ${doc.filename}`}
                    disabled={deleteDocument.isPending}
                    onClick={() => deleteDocument.mutate({ documentId: doc.id })}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4">
            No documents attached. Upload shop drawings, MTRs, photos, and more.
          </div>
        )}
      </CardContent>

      <Dialog
        open={!!pendingFile}
        onOpenChange={(open) => {
          if (!open && !isUploading) setPendingFile(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="text-sm border rounded-md px-3 py-2 flex items-center gap-2">
              <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="truncate">{pendingFile?.name}</span>
              {pendingFile && (
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                  {formatSize(pendingFile.size)}
                </span>
              )}
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={category}
                onValueChange={(val) => setCategory(val as DocumentCategory)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORY_LABELS) as DocumentCategory[]).map(
                    (key) => (
                      <SelectItem key={key} value={key}>
                        {CATEGORY_LABELS[key]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingFile(null)}
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={isUploading || !pendingFile}>
              {isUploading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
