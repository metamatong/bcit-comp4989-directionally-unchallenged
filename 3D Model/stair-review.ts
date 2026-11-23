/** Selecting endpoints prepares a question only, never a graph edge or route approval. */
export type StairMarker = {
  id: string;
  planId: string;
  sourceSha256: string;
  label: string;
  point: { x: number; y: number };
  category: "reviewed" | "proposed" | "label";
  reference: string;
  version?: number;
  number?: number;
};
export function pairProblem(
  a: StairMarker | undefined,
  b: StairMarker | undefined,
  plans: { id: string; building: string; floor: string }[],
) {
  if (!a || !b) return "Select both endpoints to prepare a review draft.";
  const from = plans.find((p) => p.id === a.planId),
    to = plans.find((p) => p.id === b.planId);
  if (!from || !to) return "Both endpoints need known source plans.";
  if (from.building !== to.building)
    return "Choose two floors of the same building for a direct stair connection.";
  if (from.floor === to.floor)
    return "These points are on the same floor. Select a different floor for a stair transfer.";
  return null;
}
