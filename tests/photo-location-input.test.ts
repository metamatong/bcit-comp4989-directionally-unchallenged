import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PhotoLocationInput } from '../src/components/PhotoLocationInput';
import type { PreparedPhoto } from '../src/photo';

const photo: PreparedPhoto = {
  mimeType: 'image/jpeg',
  data: 'local-preview-fixture',
  preview: 'data:image/jpeg;base64,local-preview-fixture',
  width: 100,
  height: 100,
  detailCrops: [],
};

function renderInput(overrides: Partial<ComponentProps<typeof PhotoLocationInput>> = {}) {
  const props: ComponentProps<typeof PhotoLocationInput> = {
    photo: null,
    consent: false,
    ready: true,
    reading: false,
    busy: false,
    status: '',
    onPhoto: vi.fn(),
    onConsent: vi.fn(),
    onAnalyze: vi.fn(),
    onDiscard: vi.fn(),
    ...overrides,
  };
  return { markup: renderToStaticMarkup(createElement(PhotoLocationInput, props)), props };
}

function button(markup: string, label: string) {
  const match = markup.match(
    new RegExp(`<button\\b[^>]*>(?:(?!</button>)[\\s\\S])*${label}</button>`),
  );
  expect(match, `Expected the ${label} button`).not.toBeNull();
  return match![0];
}

describe('inline photo input (Node rendering, no browser)', () => {
  it('exposes upload and native capture immediately under Find my location', () => {
    const { markup, props } = renderInput();
    expect(markup).toContain('<h1 id="location-heading">Find my location</h1>');
    expect(button(markup, 'Upload photo')).not.toContain('disabled');
    expect(button(markup, 'Take a photo')).not.toContain('disabled');
    expect(markup).toContain('capture="environment"');
    expect(markup).not.toContain('<dialog');
    expect(markup).not.toContain('Analyze a photo');
    expect(markup).not.toContain('aria-label="Photo analysis"');
    expect(props.onAnalyze).not.toHaveBeenCalled();
  });
  it('shows a local preview while requiring separate photo consent before analysis', () => {
    const { markup, props } = renderInput({ photo });
    expect(markup).toContain(photo.preview);
    expect(markup).toContain('Send this photo and its detail views to Google Gemini');
    expect(markup).not.toContain('checked=""');
    expect(button(markup, 'Analyze photo against BCIT plans')).toContain('disabled');
    expect(button(markup, 'Remove photo')).not.toContain('disabled');
    expect(props.onAnalyze).not.toHaveBeenCalled();
  });
  it('enables analysis only after the photo is consented and the provider is ready', () => {
    const { markup } = renderInput({ photo, consent: true });
    expect(button(markup, 'Analyze photo against BCIT plans')).not.toContain('disabled');
  });
  it('keeps local upload available while provider configuration is unavailable', () => {
    const { markup } = renderInput({ photo, consent: true, ready: false });
    expect(button(markup, 'Upload photo')).not.toContain('disabled');
    expect(button(markup, 'Analyze photo against BCIT plans')).toContain('disabled');
    expect(markup).toMatch(/type="checkbox"[^>]*disabled=""/);
  });
  it('keeps cancellation available while analysis locks submission and replacement', () => {
    const { markup } = renderInput({
      photo,
      consent: true,
      busy: true,
      status: 'Comparing plans…',
    });
    expect(button(markup, 'Upload photo')).toContain('disabled');
    expect(button(markup, 'Take a photo')).toContain('disabled');
    expect(button(markup, 'Analyze photo against BCIT plans')).toContain('disabled');
    expect(button(markup, 'Cancel analysis')).not.toContain('disabled');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Comparing plans…');
  });
  it('allows cancelling preparation before a preview exists', () => {
    const { markup } = renderInput({ reading: true, status: 'Preparing your photo locally…' });
    expect(button(markup, 'Upload photo')).toContain('disabled');
    expect(button(markup, 'Cancel photo preparation')).not.toContain('disabled');
    expect(markup).not.toContain('aria-label="Photo analysis"');
  });
});
