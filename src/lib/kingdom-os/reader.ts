import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { STATUS_MAX_BYTES, STATUS_PATH, projectFleetStatus, type FleetProjection } from "./fleet";

/** Root-owned original VPSSentry status file only. No caller-selected path. */
export async function readFleetProjection(): Promise<FleetProjection> {
  const handle = await open(STATUS_PATH, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.uid !== 0 || st.nlink !== 1 ||
        (st.mode & 0o022) !== 0 || st.size <= 0 || st.size > STATUS_MAX_BYTES) {
      throw new Error("untrusted_source_file");
    }
    const raw = await handle.readFile();
    if (raw.length !== st.size) throw new Error("changing_source_file");
    const snapshot = JSON.parse(raw.toString("utf8")) as unknown;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new Error("invalid_source_schema");
    }
    const sha256 = createHash("sha256").update(raw).digest("hex");
    return projectFleetStatus(snapshot, sha256);
  } finally {
    await handle.close();
  }
}
