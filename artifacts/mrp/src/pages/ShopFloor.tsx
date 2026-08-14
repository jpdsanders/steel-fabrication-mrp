import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useListEmployees,
  useListJobs,
  useGetJob,
  useClockIn,
  useListActivePunches,
  useClockOut,
  getListActivePunchesQueryKey,
  getGetJobQueryKey,
  getGetDashboardSummaryQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ShopFloor() {
  const [step, setStep] = useState(1);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: employees } = useListEmployees({ activeOnly: true });
  const { data: activeJobs } = useListJobs({ status: "active" });
  
  const { data: selectedJob } = useGetJob(selectedJobId as number, {
    query: { enabled: !!selectedJobId, queryKey: getGetJobQueryKey(selectedJobId as number) }
  });

  const { data: activePunches } = useListActivePunches({
    query: {
      refetchInterval: 10000,
      queryKey: getListActivePunchesQueryKey(),
    },
  });

  const clockIn = useClockIn({
    mutation: {
      onSuccess: () => {
        toast({ title: "Successfully clocked in" });
        queryClient.invalidateQueries({ queryKey: getListActivePunchesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        reset();
      }
    }
  });

  const clockOut = useClockOut({
    mutation: {
      onSuccess: () => {
        toast({ title: "Successfully clocked out" });
        queryClient.invalidateQueries({ queryKey: getListActivePunchesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      }
    }
  });

  const reset = () => {
    setStep(1);
    setSelectedEmployeeId(null);
    setSelectedJobId(null);
    setSelectedStageId(null);
  };

  const handleClockIn = () => {
    if (selectedEmployeeId && selectedJobId && selectedStageId) {
      clockIn.mutate({
        data: {
          employeeId: selectedEmployeeId,
          jobId: selectedJobId,
          stageId: selectedStageId
        }
      });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans selection:bg-primary selection:text-primary-foreground">
      <div className="p-4 border-b flex justify-between items-center bg-card shrink-0">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-2">
            <ChevronLeft className="w-4 h-4" /> Back to Office
          </Button>
        </Link>
        <div className="text-xl font-bold tracking-widest text-primary uppercase">SHOP FLOOR KIOSK</div>
        <div className="w-[120px] text-right font-mono text-muted-foreground">
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Wizard Area */}
        <div className="flex-1 p-8 overflow-y-auto border-r flex flex-col">
          {step > 1 && (
            <Button variant="outline" size="lg" className="self-start mb-6 h-14 px-6 text-lg" onClick={() => setStep(step - 1)}>
              <ChevronLeft className="w-6 h-6 mr-2" /> Back
            </Button>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <h1 className="text-4xl font-bold">1. Who are you?</h1>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {employees?.map(emp => (
                  <Button
                    key={emp.id}
                    variant="outline"
                    className="h-32 text-2xl font-bold whitespace-normal"
                    onClick={() => { setSelectedEmployeeId(emp.id); setStep(2); }}
                  >
                    {emp.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <h1 className="text-4xl font-bold">2. What job?</h1>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {activeJobs?.map(job => (
                  <Card 
                    key={job.id} 
                    className="cursor-pointer hover:border-primary transition-colors hover:shadow-lg"
                    onClick={() => { setSelectedJobId(job.id); setStep(3); }}
                  >
                    <CardContent className="p-6 h-40 flex flex-col justify-center">
                      <div className="text-3xl font-black text-primary mb-2">{job.jobNumber}</div>
                      <div className="text-xl font-bold line-clamp-2 leading-tight">{job.name}</div>
                      <div className="text-sm text-muted-foreground mt-2">{job.currentStageName || "Not started"}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <h1 className="text-4xl font-bold">3. What stage?</h1>
              <div className="text-xl text-muted-foreground mb-4">Job: {selectedJob?.jobNumber}</div>
              <div className="grid grid-cols-2 gap-4">
                {selectedJob?.stages.map(stage => (
                  <Button
                    key={stage.id}
                    variant="outline"
                    className={`h-24 text-2xl font-bold ${stage.status === 'in_progress' ? 'border-primary border-2 text-primary' : ''}`}
                    onClick={() => { setSelectedStageId(stage.id); setStep(4); }}
                  >
                    {stage.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-8 flex flex-col items-center justify-center flex-1">
              <h1 className="text-4xl font-bold">4. Confirm</h1>
              
              <div className="bg-muted p-8 rounded-xl w-full max-w-xl space-y-6 text-center border-2 border-border">
                <div>
                  <div className="text-sm text-muted-foreground uppercase tracking-wider font-bold mb-1">Employee</div>
                  <div className="text-3xl font-bold">{employees?.find(e => e.id === selectedEmployeeId)?.name}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground uppercase tracking-wider font-bold mb-1">Job</div>
                  <div className="text-3xl font-bold">{activeJobs?.find(j => j.id === selectedJobId)?.jobNumber}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground uppercase tracking-wider font-bold mb-1">Stage</div>
                  <div className="text-3xl font-bold">{selectedJob?.stages.find(s => s.id === selectedStageId)?.name}</div>
                </div>
              </div>

              <Button 
                size="lg" 
                className="w-full max-w-xl h-24 text-3xl font-black uppercase tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground shadow-xl"
                onClick={handleClockIn}
                disabled={clockIn.isPending}
              >
                {clockIn.isPending ? "Clocking In..." : "CLOCK IN"}
              </Button>
            </div>
          )}
        </div>

        {/* Active Punches Area */}
        <div className="w-1/3 min-w-[350px] max-w-[500px] p-6 bg-muted/30 overflow-y-auto">
          <h2 className="text-2xl font-bold mb-6 flex items-center justify-between">
            On The Floor
            <Badge variant="secondary" className="text-lg px-3 py-1">{activePunches?.length || 0}</Badge>
          </h2>

          <div className="space-y-4">
            {activePunches?.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground border-2 border-dashed rounded-xl">
                No one currently clocked in.
              </div>
            ) : (
              activePunches?.map(punch => (
                <Card key={punch.id} className="border-2 shadow-sm">
                  <CardContent className="p-4 flex justify-between items-center gap-4">
                    <div className="min-w-0">
                      <div className="font-bold text-lg truncate">{punch.employeeName}</div>
                      {punch.employeeTitle && <div className="text-xs text-muted-foreground truncate">{punch.employeeTitle}</div>}
                      <div className="text-sm text-primary font-bold">{punch.jobNumber}</div>
                      <div className="text-xs text-muted-foreground truncate">{punch.stageName}</div>
                    </div>
                    <Button 
                      variant="destructive" 
                      size="lg"
                      className="h-16 px-6 font-bold uppercase tracking-wider shrink-0 shadow-sm"
                      onClick={() => clockOut.mutate({ data: { entryId: punch.id } })}
                    >
                      OUT
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
