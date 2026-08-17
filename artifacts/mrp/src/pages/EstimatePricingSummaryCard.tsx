import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  useGetEstimatePricing,
  useUpdateEstimate,
  getGetEstimatePricingQueryKey,
  getGetEstimateQueryKey,
  getListEstimatesQueryKey,
  type Estimate
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

export function EstimatePricingSummaryCard({ estimate, onSaved }: { estimate: Estimate, onSaved: () => void }) {
  const { data: pricing, isLoading } = useGetEstimatePricing(estimate.id, {
    query: { enabled: !!estimate.id, queryKey: getGetEstimatePricingQueryKey(estimate.id) }
  });
  
  const [marginPercent, setMarginPercent] = useState(String(estimate.marginPercent));
  const [isEditing, setIsEditing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Keep local state in sync if estimate updates externally
  useEffect(() => {
    if (!isEditing) {
      setMarginPercent(String(estimate.marginPercent));
    }
  }, [estimate.marginPercent, isEditing]);

  const update = useUpdateEstimate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Margin updated" });
        setIsEditing(false);
        queryClient.invalidateQueries({ queryKey: getGetEstimateQueryKey(estimate.id) });
        queryClient.invalidateQueries({ queryKey: getListEstimatesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetEstimatePricingQueryKey(estimate.id) });
        onSaved();
      },
      onError: () => toast({ title: "Failed to update margin", variant: "destructive" })
    }
  });

  const handleSaveMargin = () => {
    const val = Number(marginPercent);
    if (!isNaN(val)) {
      update.mutate({ estimateId: estimate.id, data: { marginPercent: val } });
    }
  };

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!pricing) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pricing Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {pricing.needsQuoteCount > 0 && (
          <div className="bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900/50 p-3 rounded-md flex items-start gap-3 text-sm mb-4">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div>
              <span className="font-semibold">{pricing.needsQuoteCount} {pricing.needsQuoteCount === 1 ? 'item' : 'items'} still need quotes.</span>
              <p>The material cost below excludes items marked "Needs Quote".</p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Material Cost</span>
            <span>${pricing.materialCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Labor Cost</span>
            <span>${pricing.laborCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between border-t pt-2 font-medium">
            <span>Subtotal</span>
            <span>${pricing.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between items-center pt-1">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Margin</span>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Input 
                    type="number" 
                    className="w-20 h-7 text-xs" 
                    value={marginPercent} 
                    onChange={e => setMarginPercent(e.target.value)} 
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveMargin(); if (e.key === 'Escape') { setIsEditing(false); setMarginPercent(String(estimate.marginPercent)); } }}
                    autoFocus
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleSaveMargin} disabled={update.isPending}>Save</Button>
                </div>
              ) : (
                <span 
                  className="text-sm border-b border-dashed border-muted-foreground/50 cursor-pointer hover:text-primary transition-colors"
                  onClick={() => setIsEditing(true)}
                  title="Click to edit margin"
                >
                  {estimate.marginPercent}%
                </span>
              )}
            </div>
            <span className="text-sm text-muted-foreground">${pricing.marginAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="bg-muted/20 border-t pt-6 flex justify-between items-center">
        <div className="font-semibold">Total Price</div>
        <div className="text-2xl font-bold text-primary">${pricing.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      </CardFooter>
    </Card>
  );
}
