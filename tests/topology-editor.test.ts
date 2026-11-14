import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import TopologyEditor from '../src/TopologyEditor';
import { ReviewPanel, EdgeForm } from '../src/components/TopologyForms';
import { topologyPlans } from '../server/topology';
import type { TopologyNode } from '../src/topology';

it('renders a separate editor with source-plan choices and honest empty-state onboarding (Node only)', () => {
  const markup = renderToStaticMarkup(
    createElement(TopologyEditor, {
      initialView: 'manual',
      initialData: {
        document: {
          schemaVersion: 1,
          revision: 0,
          updatedAt: null,
          nodes: [],
          edges: [],
          candidateAnswers: [],
          floorObservations: [],
        },
        plans: topologyPlans,
        eligibility: { nodeIds: [], edgeIds: [], issues: [] },
        candidates: [],
      },
    }),
  );
  expect(markup).toContain('How to enter the first connections');
  expect(markup).toContain('No connections have been prefilled');
  expect(markup).toContain('SW03 · Floor 4');
  expect(markup).toContain('SW01 · Floor 1');
  expect(markup).toContain('0 connections eligible for routing');
  expect(markup).toContain('Add point on plan');
  expect(markup).toContain('Original BCIT PDF');
  expect(markup).not.toContain('type="file"');
});
it('keeps review controls disabled for unsaved edits', () => {
  const record: TopologyNode = {
    id: '00000000-0000-4000-8000-000000000001',
    version: 1,
    planId: 'SE12-F3-p1',
    sourceSha256: 'a'.repeat(64),
    label: 'Fixture only',
    kind: 'door',
    point: { x: 0.5, y: 0.5 },
    notes: '',
    evidence: { basis: 'plan', note: 'Fixture evidence', observedOn: null },
    review: null,
    reviewHistory: [],
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
  };
  const markup = renderToStaticMarkup(
    createElement(ReviewPanel, {
      record,
      target: 'node',
      disabled: true,
      reviewer: 'Test',
      onReviewer: vi.fn(),
      onReview: vi.fn(),
    }),
  );
  expect(markup).toContain('Save or discard edits before reviewing');
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Approve for routing/);
});
it('offers explicit direction, cross-plan endpoint selection and optional measured costs without uploading photos', () => {
  const markup = renderToStaticMarkup(
    createElement(EdgeForm, {
      value: {
        fromNodeId: '',
        toNodeId: '',
        kind: 'corridor',
        direction: 'both',
        notes: '',
        distanceMeters: null,
        distanceEvidence: '',
        evidence: { basis: 'plan', note: '', observedOn: null },
      },
      nodes: [],
      plans: topologyPlans,
      busy: false,
      picking: null,
      onChange: vi.fn(),
      onSave: vi.fn(),
      onDelete: vi.fn(),
      onPick: vi.fn(),
      onShow: vi.fn(),
    }),
  );
  expect(markup).toContain('From → To only');
  expect(markup).toContain('Pick to on plan');
  expect(markup).toContain('Page pixels are not metres');
  expect(markup).not.toContain('type="file"');
});
