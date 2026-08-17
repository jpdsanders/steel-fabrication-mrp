import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListJobShipments,
  getListJobShipmentsQueryKey,
  useCreateShipment,
  useDeleteShipment,
  useCreateShipmentNotification,
  useCreateLoadConfirmation,
  useDepartShipment,
  getGetJobQueryKey,
  type Shipment,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/api";
import { Truck, FileText, Plus, Trash2, PenLine, Send } from "lucide-react";

type AssemblyLite = {
  id: number;
  mark: string;
  quantity: number;
  description?: string | null;
  currentStage?: string | null;
  onHold?: boolean;
};

function apiError(error: unknown): string | undefined {
  return (error as { response?: { data?: { error?: string } } })?.response?.data
    ?.error;
}

/**
 * Shipping — shipments built only from Ready-to-Ship assemblies (Inspected,
 * not on hold), with the Phase 6 hard gates surfaced in order:
 * written notification → paperwork (BOL / packing slip) → signed load
 * confirmation → departure.
 */
export default function ShippingCard({
  jobId,
  assemblies,
}: {
  jobId: number;
  assemblies: AssemblyLite[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: shipments } = useListJobShipments(jobId, {
    query: { enabled: !!jobId, queryKey: getListJobShipmentsQueryKey(jobId) },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListJobShipmentsQueryKey(jobId) });
    queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
  };
  const onError = (title: string) => (error: unknown) =>
    toast({ title, description: apiError(error), variant: "destructive" });

  const createShipment = useCreateShipment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Shipment created" });
        setCreateOpen(false);
        setSelected([]);
        invalidate();
      },
      onError: onError("Failed to create shipment"),
    },
  });
  const deleteShipment = useDeleteShipment({
    mutation: {
      onSuccess: () => { toast({ title: "Shipment deleted" }); invalidate(); },
      onError: onError("Failed to delete shipment"),
    },
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [carrier, setCarrier] = useState("");
  const [pickupInfo, setPickupInfo] = useState("");

  // On a shipment already? Exclude from the picker.
  const shippedAssemblyIds = new Set(
    (shipments ?? []).flatMap((s) => s.assemblies.map((a) => a.assemblyId)),
  );
  const rtsAssemblies = assemblies.filter(
    (a) =>
      a.currentStage === "Inspected" && !a.onHold && !shippedAssemblyIds.has(a.id),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Truck className="w-5 h-5" /> Shipping
        </CardTitle>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-new-shipment">
              <Plus className="w-4 h-4 mr-1" /> New Shipment
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Shipment</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground -mt-2">
              Only Ready-to-Ship assemblies (Inspected and not on hold) can be
              added to a shipment.
            </p>
            {rtsAssemblies.length === 0 ? (
              <p className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/40" data-testid="text-no-rts">
                No assemblies are Ready to Ship right now.
              </p>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-2 border rounded-md p-3">
                {rtsAssemblies.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.includes(a.id)}
                      onCheckedChange={(checked) =>
                        setSelected((prev) =>
                          checked ? [...prev, a.id] : prev.filter((id) => id !== a.id),
                        )
                      }
                      data-testid={`checkbox-ship-assembly-${a.id}`}
                    />
                    <span className="font-medium">{a.mark}</span>
                    <span className="text-muted-foreground">× {a.quantity}</span>
                    {a.description && (
                      <span className="text-muted-foreground truncate">{a.description}</span>
                    )}
                  </label>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <Label>Carrier (optional)</Label>
              <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="e.g. ABC Trucking" data-testid="input-shipment-carrier" />
              <Label>Pickup info (optional)</Label>
              <Input value={pickupInfo} onChange={(e) => setPickupInfo(e.target.value)} placeholder="Dock, time window…" data-testid="input-shipment-pickup" />
            </div>
            <DialogFooter>
              <Button
                disabled={selected.length === 0 || createShipment.isPending}
                onClick={() =>
                  createShipment.mutate({
                    jobId,
                    data: {
                      assemblyIds: selected,
                      carrier: carrier.trim() || null,
                      pickupInfo: pickupInfo.trim() || null,
                    },
                  })
                }
                data-testid="button-create-shipment"
              >
                Create Shipment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4">
        {(shipments ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-shipments">
            No shipments yet. Assemblies become eligible once they are Inspected
            and not on hold.
          </p>
        ) : (
          (shipments ?? []).map((s) => (
            <ShipmentRow
              key={s.id}
              shipment={s}
              onInvalidate={invalidate}
              onDelete={() => deleteShipment.mutate({ shipmentId: s.id })}
              onError={onError}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ShipmentRow({
  shipment: s,
  onInvalidate,
  onDelete,
  onError,
}: {
  shipment: Shipment;
  onInvalidate: () => void;
  onDelete: () => void;
  onError: (title: string) => (error: unknown) => void;
}) {
  const { toast } = useToast();
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [shipDate, setShipDate] = useState("");
  const [notifCarrier, setNotifCarrier] = useState(s.carrier ?? "");
  const [notifNotes, setNotifNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signedBy, setSignedBy] = useState("");
  const [discrepancies, setDiscrepancies] = useState("");

  const notify = useCreateShipmentNotification({
    mutation: {
      onSuccess: () => { toast({ title: "Ship notification recorded" }); setNotifyOpen(false); onInvalidate(); },
      onError: onError("Failed to record notification"),
    },
  });
  const confirmLoad = useCreateLoadConfirmation({
    mutation: {
      onSuccess: () => { toast({ title: "Load confirmation signed" }); setConfirmOpen(false); onInvalidate(); },
      onError: onError("Failed to record load confirmation"),
    },
  });
  const depart = useDepartShipment({
    mutation: {
      onSuccess: () => { toast({ title: "Shipment departed — assemblies marked Shipped" }); onInvalidate(); },
      onError: onError("Cannot depart"),
    },
  });

  const departed = s.status === "departed";

  return (
    <div className="border rounded-lg p-4 space-y-3" data-testid={`shipment-${s.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{s.shipperNumber}</span>
        <Badge variant={departed ? "default" : "secondary"} data-testid={`badge-shipment-status-${s.id}`}>
          {departed ? "Departed" : "Planned"}
        </Badge>
        {s.notification ? (
          <Badge variant="outline" className="text-emerald-700 border-emerald-300">Notified</Badge>
        ) : (
          <Badge variant="outline" className="text-amber-700 border-amber-300">Notification required</Badge>
        )}
        {s.loadConfirmation && (
          <Badge variant="outline" className="text-emerald-700 border-emerald-300">Load confirmed</Badge>
        )}
        {!departed && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="ml-auto h-8 w-8 text-destructive" data-testid={`button-delete-shipment-${s.id}`}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete shipment {s.shipperNumber}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the shipment, its notification, and any load
                  confirmation. Assemblies stay Inspected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={onDelete}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="text-sm text-muted-foreground">
        {s.assemblies.map((a) => a.mark).join(", ")}
        {s.notification && (
          <>
            {" · "}ship {s.notification.proposedShipDate} via {s.notification.carrier}
          </>
        )}
        {departed && s.departedAt && (
          <> · departed {new Date(s.departedAt).toLocaleString()}</>
        )}
      </div>
      {s.loadConfirmation && (
        <div className="text-xs text-muted-foreground">
          Load confirmed by {s.loadConfirmation.signedBy} on{" "}
          {new Date(s.loadConfirmation.signedAt).toLocaleString()}
          {s.loadConfirmation.discrepancyNotes && (
            <> — discrepancies: {s.loadConfirmation.discrepancyNotes}</>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {/* Gate 1: written notification */}
        {!s.notification && !departed && (
          <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" data-testid={`button-notify-${s.id}`}>
                <Send className="w-4 h-4 mr-1" /> Record Ship Notification
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Shipment Notification — {s.shipperNumber}</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground -mt-2">
                Required before BOL / packing-slip paperwork can be generated.
              </p>
              <div className="space-y-2">
                <Label>Proposed ship date</Label>
                <Input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} data-testid={`input-ship-date-${s.id}`} />
                <Label>Carrier</Label>
                <Input value={notifCarrier} onChange={(e) => setNotifCarrier(e.target.value)} placeholder="Carrier" data-testid={`input-notif-carrier-${s.id}`} />
                <Label>Notes (optional)</Label>
                <Textarea value={notifNotes} onChange={(e) => setNotifNotes(e.target.value)} rows={2} />
              </div>
              <DialogFooter>
                <Button
                  disabled={!shipDate || !notifCarrier.trim() || notify.isPending}
                  onClick={() =>
                    notify.mutate({
                      shipmentId: s.id,
                      data: {
                        proposedShipDate: shipDate,
                        carrier: notifCarrier.trim(),
                        notes: notifNotes.trim() || null,
                      },
                    })
                  }
                  data-testid={`button-save-notification-${s.id}`}
                >
                  Record Notification
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Paperwork — enabled only once notified */}
        <Button size="sm" variant="outline" asChild disabled={!s.paperworkReady}>
          <a
            href={s.paperworkReady ? getApiUrl(`shipments/${s.id}/bol.pdf`) : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!s.paperworkReady}
            className={!s.paperworkReady ? "pointer-events-none opacity-50" : ""}
            data-testid={`link-bol-${s.id}`}
          >
            <FileText className="w-4 h-4 mr-1" /> BOL
          </a>
        </Button>
        <Button size="sm" variant="outline" asChild disabled={!s.paperworkReady}>
          <a
            href={s.paperworkReady ? getApiUrl(`shipments/${s.id}/packing-slip.pdf`) : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!s.paperworkReady}
            className={!s.paperworkReady ? "pointer-events-none opacity-50" : ""}
            data-testid={`link-packing-slip-${s.id}`}
          >
            <FileText className="w-4 h-4 mr-1" /> Packing Slip
          </a>
        </Button>

        {/* Gate 2: signed load confirmation */}
        {!s.loadConfirmation && !departed && (
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" data-testid={`button-load-confirm-${s.id}`}>
                <PenLine className="w-4 h-4 mr-1" /> Sign Load Confirmation
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Load Confirmation — {s.shipperNumber}</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground -mt-2">
                Required sign-off before the shipment can be marked departed.
              </p>
              <div className="space-y-2">
                <Label>Signed by</Label>
                <Input value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Name" data-testid={`input-signed-by-${s.id}`} />
                <Label>Discrepancy notes (optional)</Label>
                <Textarea value={discrepancies} onChange={(e) => setDiscrepancies(e.target.value)} rows={2} />
              </div>
              <DialogFooter>
                <Button
                  disabled={!signedBy.trim() || confirmLoad.isPending}
                  onClick={() =>
                    confirmLoad.mutate({
                      shipmentId: s.id,
                      data: {
                        signedBy: signedBy.trim(),
                        discrepancyNotes: discrepancies.trim() || null,
                      },
                    })
                  }
                  data-testid={`button-save-load-confirm-${s.id}`}
                >
                  Sign Confirmation
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Gate 3: departure */}
        {!departed && (
          <Button
            size="sm"
            disabled={!s.loadConfirmation || depart.isPending}
            title={!s.loadConfirmation ? "A signed load confirmation is required first" : undefined}
            onClick={() => depart.mutate({ shipmentId: s.id })}
            data-testid={`button-depart-${s.id}`}
          >
            <Truck className="w-4 h-4 mr-1" /> Mark Departed
          </Button>
        )}
      </div>
    </div>
  );
}
