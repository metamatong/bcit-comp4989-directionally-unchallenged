/** Review drafts only: source regions are not landing points and never approve routes. */
export function buildRelationshipQuestions(snapshot, definitions) {
  return definitions.questions.map((question) => {
    const issues = [];
    for (const side of ["from", "to"]) {
      const endpoint = question[side];
      if (!endpoint) continue;
      const plan = snapshot.plans.find((p) => p.id === endpoint.planId);
      if (!plan || plan.sourceSha256 !== endpoint.sourceSha256)
        issues.push(`${side}: source changed or unavailable`);
      if (endpoint.node) {
        const current = snapshot.document.nodes.find(
          (n) => n.id === endpoint.node.id,
        );
        if (
          !current ||
          !snapshot.eligibility.nodeIds.includes(current.id) ||
          current.version !== endpoint.node.version ||
          current.planId !== endpoint.planId ||
          current.sourceSha256 !== endpoint.sourceSha256 ||
          JSON.stringify(current.point) !== JSON.stringify(endpoint.node.point)
        )
          issues.push(`${side}: reviewed landing changed or ineligible`);
      }
    }
    if (question.existingEdge) {
      const reference = question.existingEdge;
      const edge = snapshot.document.edges.find((e) => e.id === reference.id);
      if (
        !edge ||
        !snapshot.eligibility.edgeIds.includes(edge.id) ||
        ["version", "direction", "fromNodeId", "toNodeId"].some(
          (k) => edge[k] !== reference[k],
        )
      )
        issues.push(
          "Existing direction record changed; regenerate review question",
        );
    }
    return {
      ...question,
      answer: null,
      permittedDirection: null,
      routeEligible: false,
      currentSource: issues.length === 0,
      issues,
      referenceRevision: definitions.sourceRevision,
      currentRevision: snapshot.publishedRevision,
    };
  });
}
