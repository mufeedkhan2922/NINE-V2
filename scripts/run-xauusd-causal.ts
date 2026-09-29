import fs from "node:fs";
import { causalResearchSummary } from "../lib/trading/causalLearning";

const result={
  version:"0.5.22",
  symbol:"XAUUSD",
  generatedAt:Date.now(),
  failureModes:causalResearchSummary("XAUUSD"),
  safety:[
    "Causal learning does not create trades.",
    "Repeated failures require statistical evidence before blocking.",
    "Counterfactual outcomes are stored separately from realized outcomes.",
    "Old failure patterns can recover when new evidence changes the statistics.",
    "Sentinel remains the final authority."
  ]
};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/xauusd-causal-learning.json",JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
