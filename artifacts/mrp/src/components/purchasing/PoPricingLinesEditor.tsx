import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Tags } from "lucide-react";
import type { QualityClause } from "@workspace/api-client-react";
import { formatFeetInches, parseFeetInches } from "@/lib/units";
import { formatCurrency } from "@/components/purchasing/vendorStatus";

/** Line model for the pricing-aware PO editor. */
export interface EditablePricingLine {
  profileType: string;
  profileSize: string;
  grade: string;
  pieces: string;
  /** Total length as feet-and-inches text (or plain inches). */
  length: string;
  unitPrice: string;
  promiseDate: string;
  qualityClauseIds: number[];
}

export function emptyPricingLine(): EditablePricingLine {
  return {
    profileType: "",
    profileSize: "",
    grade: "",
    pieces: "1",
    length: "",
    unitPrice: "",
    promiseDate: "",
    qualityClauseIds: [],
  };
}

export function toPricingLineInputs(lines: EditablePricingLine[]) {
  return lines.map((l) => {
    const parsed = parseFeetInches(l.length);
    const price = l.unitPrice.trim() === "" ? null : Number(l.unitPrice);
    return {
      profileType: l.profileType.trim() || null,
      profileSize: l.profileSize.trim() || null,
      grade: l.grade.trim() || null,
      pieces: Math.max(1, Math.round(Number(l.pieces) || 1)),
      lengthIn:
        parsed === null || Number.isNaN(parsed) ? null : Math.max(0, parsed),
      unitPrice:
        price === null || Number.isNaN(price) ? null : Math.max(0, price),
      promiseDate: l.promiseDate || null,
      qualityClauseIds: l.qualityClauseIds,
    };
  });
}

export function lineExtended(l: EditablePricingLine): number | null {
  const price = Number(l.unitPrice);
  const pieces = Number(l.pieces);
  if (l.unitPrice.trim() === "" || Number.isNaN(price) || Number.isNaN(pieces)) {
    return null;
  }
  return price * Math.max(0, pieces);
}

export function poTotal(lines: EditablePricingLine[]): number | null {
  let total = 0;
  let any = false;
  for (const l of lines) {
    const ext = lineExtended(l);
    if (ext != null) {
      total += ext;
      any = true;
    }
  }
  return any ? total : null;
}

function lengthPreview(raw: string): string | null {
  const parsed = parseFeetInches(raw);
  if (parsed === null) return null;
  if (Number.isNaN(parsed)) return "Unrecognized — use e.g. 12'-6 1/2\"";
  return formatFeetInches(parsed);
}

export default function PoPricingLinesEditor({
  lines,
  onChange,
  clauses,
}: {
  lines: EditablePricingLine[];
  onChange: (lines: EditablePricingLine[]) => void;
  clauses: QualityClause[];
}) {
  const activeClauses = clauses.filter((c) => c.active);
  const clauseById = new Map(clauses.map((c) => [c.id, c]));

  const update = (index: number, patch: Partial<EditablePricingLine>) => {
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const toggleClause = (index: number, clauseId: number, checked: boolean) => {
    const current = lines[index].qualityClauseIds;
    const next = checked
      ? [...current, clauseId]
      : current.filter((id) => id !== clauseId);
    update(index, { qualityClauseIds: next });
  };

  const total = poTotal(lines);

  return (
    <div className="space-y-3">
      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Grade</TableHead>
              <TableHead className="w-20 text-right">Pieces</TableHead>
              <TableHead className="w-40 text-right">Total length (ft-in)</TableHead>
              <TableHead className="w-28 text-right">Unit price ($)</TableHead>
              <TableHead className="w-40">Promise date</TableHead>
              <TableHead className="w-28 text-right">Extended</TableHead>
              <TableHead className="w-32">Clauses</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-6">
                  No lines. Add material lines below.
                </TableCell>
              </TableRow>
            )}
            {lines.map((line, i) => {
              const preview = lengthPreview(line.length);
              const ext = lineExtended(line);
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
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) => update(i, { unitPrice: e.target.value })}
                      className="h-8 text-right"
                      placeholder="0.00"
                      data-testid={`input-line-unit-price-${i}`}
                    />
                  </TableCell>
                  <TableCell className="p-2">
                    <Input
                      type="date"
                      value={line.promiseDate}
                      onChange={(e) => update(i, { promiseDate: e.target.value })}
                      className="h-8"
                      data-testid={`input-line-promise-${i}`}
                    />
                  </TableCell>
                  <TableCell className="p-2 text-right text-sm" data-testid={`line-extended-${i}`}>
                    {ext != null ? formatCurrency(ext) : "—"}
                  </TableCell>
                  <TableCell className="p-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 w-full justify-start"
                          data-testid={`button-line-clauses-${i}`}
                        >
                          <Tags className="w-3.5 h-3.5" />
                          {line.qualityClauseIds.length > 0
                            ? `${line.qualityClauseIds.length} sel.`
                            : "None"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64" align="end">
                        {activeClauses.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No active quality clauses.
                          </p>
                        ) : (
                          <div className="space-y-2 max-h-60 overflow-y-auto">
                            {activeClauses.map((c) => {
                              const checked = line.qualityClauseIds.includes(c.id);
                              return (
                                <label
                                  key={c.id}
                                  className="flex items-start gap-2 cursor-pointer"
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(v) =>
                                      toggleClause(i, c.id, v === true)
                                    }
                                    data-testid={`checkbox-line-${i}-clause-${c.id}`}
                                  />
                                  <span className="text-sm leading-tight">
                                    <span className="font-mono text-xs">{c.code}</span>{" "}
                                    {c.title}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                    {line.qualityClauseIds.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {line.qualityClauseIds.map((id) => (
                          <Badge key={id} variant="outline" className="text-xs">
                            {clauseById.get(id)?.code ?? id}
                          </Badge>
                        ))}
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
      <div className="flex justify-between items-center">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => onChange([...lines, emptyPricingLine()])}
          data-testid="button-line-add"
        >
          <Plus className="w-4 h-4" /> Add line
        </Button>
        <div className="text-sm font-medium" data-testid="po-total-preview">
          <span className="text-muted-foreground mr-2">PO total</span>
          {total != null ? formatCurrency(total) : "—"}
        </div>
      </div>
    </div>
  );
}

/** Multi-select checkbox list for PO-level quality clauses. */
export function ClauseMultiSelect({
  clauses,
  selected,
  onChange,
  idPrefix = "po",
}: {
  clauses: QualityClause[];
  selected: number[];
  onChange: (ids: number[]) => void;
  idPrefix?: string;
}) {
  const activeClauses = clauses.filter((c) => c.active);
  if (activeClauses.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active quality clauses configured.
      </p>
    );
  }
  const toggle = (id: number, checked: boolean) => {
    onChange(checked ? [...selected, id] : selected.filter((x) => x !== id));
  };
  return (
    <div className="space-y-2 border rounded-md p-3 max-h-48 overflow-y-auto">
      {activeClauses.map((c) => (
        <label key={c.id} className="flex items-start gap-2 cursor-pointer">
          <Checkbox
            checked={selected.includes(c.id)}
            onCheckedChange={(v) => toggle(c.id, v === true)}
            data-testid={`checkbox-${idPrefix}-clause-${c.id}`}
          />
          <span className="text-sm leading-tight">
            <span className="font-mono text-xs">{c.code}</span> {c.title}
            {c.description && (
              <span className="block text-xs text-muted-foreground">
                {c.description}
              </span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}
