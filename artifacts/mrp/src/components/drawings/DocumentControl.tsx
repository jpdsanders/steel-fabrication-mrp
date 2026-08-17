import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DrawingsCard from "./DrawingsCard";
import RfisCard from "./RfisCard";
import EcnsCard from "./EcnsCard";
import TransmittalsCard from "./TransmittalsCard";
import CloseoutCard from "./CloseoutCard";

/**
 * Groups the Phase 1 document-control surface (drawings + revision control,
 * RFIs, ECNs, transmittals, and the closeout package) under a single tabbed
 * area so JobDetail stays manageable.
 */
export default function DocumentControl({ jobId }: { jobId: number }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Documents &amp; Control</h2>
      <Tabs defaultValue="drawings">
        <TabsList>
          <TabsTrigger value="drawings" data-testid="tab-drawings">
            Drawings
          </TabsTrigger>
          <TabsTrigger value="rfis" data-testid="tab-rfis">
            RFIs
          </TabsTrigger>
          <TabsTrigger value="ecns" data-testid="tab-ecns">
            ECNs
          </TabsTrigger>
          <TabsTrigger value="transmittals" data-testid="tab-transmittals">
            Transmittals
          </TabsTrigger>
          <TabsTrigger value="closeout" data-testid="tab-closeout">
            Closeout
          </TabsTrigger>
        </TabsList>
        <TabsContent value="drawings" className="mt-4">
          <DrawingsCard jobId={jobId} />
        </TabsContent>
        <TabsContent value="rfis" className="mt-4">
          <RfisCard jobId={jobId} />
        </TabsContent>
        <TabsContent value="ecns" className="mt-4">
          <EcnsCard jobId={jobId} />
        </TabsContent>
        <TabsContent value="transmittals" className="mt-4">
          <TransmittalsCard jobId={jobId} />
        </TabsContent>
        <TabsContent value="closeout" className="mt-4">
          <CloseoutCard jobId={jobId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
