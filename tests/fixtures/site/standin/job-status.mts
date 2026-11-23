// Stand-in (see _standin.mts). Not product code.
import { standIn } from "./_standin.mts";
export const createJobStatusHandler = standIn("job-status", { method: "GET", id: "job" });
