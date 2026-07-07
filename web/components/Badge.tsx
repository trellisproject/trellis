import type { AssertionStatus } from "@/lib/api";

export function Badge({ status }: { status: AssertionStatus | string }) {
  return <span className={`badge ${status}`}>{status}</span>;
}
