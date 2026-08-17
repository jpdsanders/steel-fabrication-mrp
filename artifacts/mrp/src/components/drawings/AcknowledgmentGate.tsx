import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAcknowledgeDrawingRevision,
  getListJobDrawingsQueryKey,
  type DrawingListItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";

/**
 * A BLOCKING modal that interrupts the drawings area whenever any active
 * revision requires acknowledgment. It cannot be dismissed (no X, no ESC, no
 * outside click) — the user must acknowledge each revision explicitly.
 */
export default function AcknowledgmentGate({
  jobId,
  drawings,
}: {
  jobId: number;
  drawings: DrawingListItem[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const listQueryKey = getListJobDrawingsQueryKey(jobId);

  const pending = drawings.filter((d) => d.ackRequired && d.activeRevision);

  const acknowledge = useAcknowledgeDrawingRevision({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: listQueryKey });
      },
      onError: (error) => {
        const detail =
          (error as { response?: { data?: { error?: string } } })?.response?.data
            ?.error;
        toast({
          title: "Failed to acknowledge revision",
          description: detail,
          variant: "destructive",
        });
      },
    },
  });

  if (pending.length === 0) return null;

  return (
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:rounded-lg"
        >
          <div className="flex flex-col space-y-1.5">
            <DialogPrimitive.Title className="text-lg font-semibold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Acknowledgment Required
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm text-muted-foreground">
              You must acknowledge each active drawing revision before you can view
              or download drawings for this job.
            </DialogPrimitive.Description>
          </div>

          <div className="space-y-3 max-h-[50vh] overflow-y-auto">
            {pending.map((drawing) => {
              const rev = drawing.activeRevision!;
              return (
                <div
                  key={rev.id}
                  className="border rounded-md p-3 space-y-2"
                  data-testid={`ack-item-${rev.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">
                      {drawing.drawingNumber}{" "}
                      <span className="text-muted-foreground font-normal">
                        Rev {rev.revisionLabel}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      className="gap-1 shrink-0"
                      disabled={acknowledge.isPending}
                      onClick={() =>
                        acknowledge.mutate({ revisionId: rev.id })
                      }
                      data-testid={`button-acknowledge-${rev.id}`}
                    >
                      {acknowledge.isPending &&
                      acknowledge.variables?.revisionId === rev.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="w-4 h-4" />
                      )}
                      I acknowledge
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {rev.changeSummary || "Initial issue"}
                  </p>
                </div>
              );
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
