import { calibrateConfidence, detectConceptDrift, proposeSelfCorrection, rollingCalibration, rollingPerformance } from "../lib/trading/adaptiveCalibration";

export function runAdaptiveCalibrationTest(): void {
  const observations = Array.from({length:100}, (_,i)=>({predictedConfidence:0.7 + (i%5)*0.01, outcome:(i%10)<8?1:0 as 0|1}));
  const report = rollingCalibration(observations, 100);
  if (report.observations !== 100) throw new Error("rolling calibration sample mismatch");
  if (report.actualRate <= 0.7) throw new Error("calibration actual rate missing");
  const calibrated = calibrateConfidence(0.7, observations);
  if (calibrated < 0 || calibrated > 0.99) throw new Error("calibrated confidence out of bounds");

  const recent = observations.slice(-40).map(x=>({...x,outcome:0 as 0|1}));
  const drift = detectConceptDrift(recent, observations.slice(0,40));
  if (drift <= 0) throw new Error("concept drift was not detected");

  const perf = rollingPerformance(observations.map(x=>x.outcome));
  if (perf[20] < 0 || perf[50] < 0 || perf[100] < 0 || perf[200] < 0) throw new Error("rolling performance invalid");

  const proposal = proposeSelfCorrection(observations.slice(0,50), observations.slice(50), 0.7);
  if (!["SHADOW","CANDIDATE","ACTIVATED","REJECTED"].includes(proposal.status)) throw new Error("invalid correction governance state");
  if (proposal.proposedValue < 0.5 || proposal.proposedValue > 0.9) throw new Error("correction escaped bounds");
}
