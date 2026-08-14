import { useListEmployees, getListEmployeesQueryKey } from "@workspace/api-client-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, ChevronDown } from "lucide-react";

interface EmployeeMultiSelectProps {
  value: number[];
  onChange: (ids: number[]) => void;
}

export default function EmployeeMultiSelect({ value, onChange }: EmployeeMultiSelectProps) {
  const { data: employees } = useListEmployees(
    { activeOnly: true },
    { query: { queryKey: getListEmployeesQueryKey({ activeOnly: true }) } },
  );

  const toggle = (id: number) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const selected = (employees ?? []).filter((e) => value.includes(e.id));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
          data-testid="button-employee-multiselect"
        >
          <span className="flex items-center gap-2 truncate">
            <Users className="w-4 h-4 text-muted-foreground shrink-0" />
            {selected.length === 0
              ? "No one assigned"
              : selected.map((e) => e.name).join(", ")}
          </span>
          <ChevronDown className="w-4 h-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-2" align="start">
        {(employees ?? []).length === 0 ? (
          <div className="text-sm text-muted-foreground p-2">No active employees.</div>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-1">
            {(employees ?? []).map((emp) => (
              <label
                key={emp.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted cursor-pointer"
                data-testid={`option-employee-${emp.id}`}
              >
                <Checkbox
                  checked={value.includes(emp.id)}
                  onCheckedChange={() => toggle(emp.id)}
                />
                <span className="truncate">{emp.name}</span>
              </label>
            ))}
          </div>
        )}
        {value.length > 0 && (
          <div className="flex justify-between items-center pt-2 mt-1 border-t">
            <Badge variant="secondary">{value.length} selected</Badge>
            <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => onChange([])}>
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
