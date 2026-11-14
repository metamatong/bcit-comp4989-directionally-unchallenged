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
    ready: true,
    reading: false,
    busy: false,
    status: '',
    destination: '',
    onDestinationChange: vi.fn(),
    onPhoto: vi.fn(),
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
    expect(markup).toContain('<label for="trip-destination">Destination</label>');
    expect(markup).toContain('DirectionallyUnchallenged does not save photos');
    expect(markup).not.toContain('<dialog');
    expect(markup).not.toContain('Analyze a photo');
    expect(markup).not.toContain('aria-label="Photo analysis"');
    expect(props.onAnalyze).not.toHaveBeenCalled();
  });
  it('shows a local preview and explains what submitting the prepared photo sends', () => {
    const { markup, props } = renderInput({ photo });
    expect(markup).toContain(photo.preview);
    expect(markup).toContain('Submitting sends this photo and its detail views to Google Gemini.');
    expect(markup).not.toContain('type="checkbox"');
    expect(button(markup, 'Analyze photo against BCIT plans')).toContain(
      'aria-describedby="photo-submission-note"',
    );
    expect(button(markup, 'Analyze photo against BCIT plans')).not.toContain('disabled');
    expect(button(markup, 'Remove photo')).not.toContain('disabled');
    expect(props.onAnalyze).not.toHaveBeenCalled();
  });
  it('shows the failed stage and cause beside the retained photo and offers an explicit retry', () => {
    const error =
      'Comparing the floor plans stopped. Gemini timed out before completing the response.';
    const { markup, props } = renderInput({
      photo,
      status: 'Comparing plans…',
      error,
    });
    expect(markup).toContain('role="alert">' + error + '</p>');
    expect(markup).toContain(photo.preview);
    expect(markup).not.toContain('Comparing plans…');
    expect(button(markup, 'Retry with this photo')).not.toContain('disabled');
    expect(props.onAnalyze).not.toHaveBeenCalled();
  });
  it('offers route finding as soon as the photo and destination are ready', () => {
    expect(
      button(renderInput({ photo, destination: 'SW03 3615' }).markup, 'Find my route'),
    ).not.toContain('disabled');
  });
  it('keeps submission disabled while preparing a replacement photo', () => {
    const { markup, props } = renderInput({ photo, reading: true, destination: 'SW03 2082' });
    expect(button(markup, 'Find my route')).toContain('disabled');
    expect(props.onAnalyze).not.toHaveBeenCalled();
  });
  it('can edit a destination using the accepted photo result without offering a second submission', () => {
    const { markup } = renderInput({
      photo,
      destination: 'SW03 2082',
      canUsePhotoResult: true,
    });
    expect(markup).toContain('SW03 2082');
    expect(markup).not.toContain('aria-label="Photo analysis"');
    expect(button(markup, 'Upload photo')).not.toContain('disabled');
  });
  it('keeps local upload available while provider configuration is unavailable', () => {
    const { markup } = renderInput({ photo, ready: false });
    expect(button(markup, 'Upload photo')).not.toContain('disabled');
    expect(button(markup, 'Analyze photo against BCIT plans')).toContain('disabled');
  });
  it('keeps cancellation available while analysis locks submission and replacement', () => {
    const { markup } = renderInput({
      photo,
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
