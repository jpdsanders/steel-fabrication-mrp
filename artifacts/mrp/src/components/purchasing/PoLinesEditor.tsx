import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { formatFeetInches, parseFeetInches } from "@/lib/units";

export interface EditableLine {
  profileType: string;
  profileSize: string;
  grade: string;
  pieces: string;
  /** Total length as feet-and-inches text, e.g. `12'-6 1/2"` (or plain inches). */
  length: string;
}

export function emptyLine(): EditableLine {
  return { profileType: "", profileSize: "", grade: "", pieces: "1", length: "" };
}

export function toLineInputs(lines: EditableLine[]) {
  return lines.map((l) => {
    const parsed = parseFeetInches(l.length);
    return {
      profileType: l.profileType.trim() || null,
      profileSize: l.profileSize.trim() || null,
      grade: l.grade.trim() || null,
      pieces: Math.max(1, Math.round(Number(l.pieces) || 1)),
      lengthIn:
        parsed === null || Number.isNaN(parsed) ? null : Math.max(0, parsed),
    };
  });
}

function lengthPreview(raw: string): string | null {
  const parsed = parseFeetInches(raw);
  if (parsed === null) return null;
  if (Number.isNaN(parsed)) return "Unrecognized — use e.g. 12'-6 1/2\"";
  return formatFeetInches(parsed);
}

export default function PoLinesEditor({
  lines,
  onChange,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
}) {
  const update = (index: number, patch: Partial<EditableLine>) => {
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  return (
    <div className="space-y-3">
      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Grade</TableHead>
              <TableHead className="w-24 text-right">Pieces</TableHead>
              <TableHead className="w-44 text-right">Total length (ft-in)</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                  No lines. Add material lines below.
                </TableCell>
              </TableRow>
            )}
            {lines.map((line, i) => {
              const preview = lengthPreview(line.length);
              return (
                <TableRow key={i} data-testid={`po-line-row-${i}`}>
                  <TableCell className="p-2">
                    <Input value={line.profileType} onChange={(e) => update(i, { profileType: e.target.value })} placeholder="e.g. W" className="h-8" data-testid={`input-line-type-${i}`} />
                  </TableCell>
                  <TableCell className="p-2">
                    <Input value={line.profileSize} onChange={(e) => update(i, { profileSize: e.target.value })} placeholder="e.g. W12X26" className="h-8" data-testid={`input-line-size-${i}`} />
                  </TableCell>
                  <TableCell className="p-2">
                    <Input value={line.grade} onChange={(e) => update(i, { grade: e.target.value })} placeholder="e.g. A992" className="h-8" data-testid={`input-line-grade-${i}`} />
                  </TableCell>
                  <TableCell className="p-2">
                    <Input type="number" min="1" value={line.pieces} onChange={(e) => update(i, { pieces: e.target.value })} className="h-8 text-right" data-testid={`input-line-pieces-${i}`} />
                  </TableCell>
                  <TableCell className="p-2">
                    <Input
                      value={line.length}
                      onChange={(e) => update(i, { length: e.target.value })}
                      placeholder={`e.g. 20'-0"`}
                      className="h-8 text-right"
                      data-testid={`input-line-length-${i}`}
                    />
                    {preview && preview !== line.length && (
                      <div className="text-xs text-muted-foreground text-right mt-1" data-testid={`preview-line-length-${i}`}>
                        {preview}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="p-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => onChange(lines.filter((_, j) => j !== i))}
                      data-testid={`button-line-remove-${i}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => onChange([...lines, emptyLine()])}
        data-testid="button-line-add"
      >
        <Plus className="w-4 h-4" /> Add line
      </Button>
    </div>
  );
}
