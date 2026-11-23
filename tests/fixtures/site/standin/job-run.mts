// Stand-in (see _standin.mts). Not product code.
import { standIn } from "./_standin.mts";
export const createJobRunHandler = standIn("job-run", { method: "POST", secretReader: true });
