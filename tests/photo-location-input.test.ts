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
  const buttons = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const match = buttons.find((item) => item.replace(/<[^>]+>/g, '').trim() === label);
  expect(match, `Expected the ${label} button`).toBeDefined();
  return match!;
}

describe('inline photo input (Node rendering, no browser)', () => {
  it('keeps Go available without the long provider notice or a dangling description', () => {
    const { markup, props } = renderInput({
      photo,
      step: 'destination',
      destination: 'SW03 2082',
    });
    expect(markup).not.toContain('Tapping Go sends');
    expect(markup).not.toContain('API data handling applies');
    expect(markup).not.toContain('photo-submission-note');
    expect(button(markup, 'Get Directions')).not.toContain('aria-describedby');
    expect(button(markup, 'Get Directions')).not.toContain('disabled');
    expect(props.onAnalyze).not.toHaveBeenCalled();
  });
  it('exposes upload and native capture before the destination step', () => {
    const { markup, props } = renderInput();
    expect(markup).toContain('<h1 id="location-heading">Snap a nearby room sign</h1>');
    expect(markup).toContain('SE12 · SW03 · SW05 · SW01');
    expect(button(markup, 'Upload photo')).not.toContain('disabled');
    expect(button(markup, 'Take a photo')).not.toContain('disabled');
    expect(markup).toContain('capture="environment"');
    expect(markup).not.toContain('id="trip-destination"');
    expect(markup).not.toContain('<dialog');
    expect(markup).not.toContain('Analyze a photo');
    expect(markup).not.toContain('aria-label="Photo analysis"');
    expect(props.onAnalyze).not.toHaveBeenCalled();
  });
  it('renders the clean destination screen with elevator switch and no building pills', () => {
    const { markup } = renderInput({
      photo,
      step: 'destination',
      destination: 'SW03 2605',
      preferElevators: false,
    });
    expect(markup).toContain('<h1 id="location-heading">Where are you headed?</h1>');
    expect(markup).toContain('Prefer elevators');
    expect(markup).toContain('role="switch"');
    expect(markup).not.toContain('building-chips');
    expect(button(markup, 'Get Directions')).not.toContain('disabled');
  });
  it('keeps the preview local before Next and submits only after Go', () => {
    const { markup, props } = renderInput({ photo });
    expect(markup).toContain(photo.preview);
    expect(button(markup, 'Next')).not.toContain('disabled');
    expect(button(markup, 'Remove photo')).not.toContain('disabled');
    const submission = renderInput({ photo, step: 'destination', destination: 'SE12 302' }).markup;
    expect(markup).not.toContain('type="checkbox"');
    expect(submission).not.toContain('photo-submission-note');
    expect(button(submission, 'Get Directions')).not.toContain('disabled');
    expect(props.onAnalyze).not.toHaveBeenCalled();
  });
  it('shows the failed stage and cause beside the retained photo and offers an explicit retry', () => {
    const error =
      'Comparing the floor plans stopped. Gemini timed out before completing the response.';
    const { markup, props } = renderInput({
      photo,
      step: 'destination',
      destination: 'SE12 302',
      status: 'Comparing plans…',
      error,
    });
    expect(markup).toContain('role="alert">' + error + '</p>');
    expect(markup).toContain(photo.preview);
    expect(markup).not.toContain('Comparing plans…');
    expect(button(markup, 'Try again')).not.toContain('disabled');
    expect(props.onAnalyze).not.toHaveBeenCalled();
  });
  it('offers route finding as soon as the photo and destination are ready', () => {
    expect(
      button(
        renderInput({ photo, step: 'destination', destination: 'SW03 3615' }).markup,
        'Get Directions',
      ),
    ).not.toContain('disabled');
    expect(
      button(
        renderInput({ photo, step: 'destination', destination: '  ' }).markup,
        'Get Directions',
      ),
    ).toContain('disabled');
  });
  it('keeps submission disabled while preparing a replacement photo', () => {
    const { markup, props } = renderInput({
      photo,
      step: 'destination',
      reading: true,
      destination: 'SW03 2082',
    });
    expect(button(markup, 'Get Directions')).toContain('disabled');
    expect(props.onAnalyze).not.toHaveBeenCalled();
  });
  it('can edit a destination using the accepted photo result without offering a second submission', () => {
    const { markup } = renderInput({
      photo: null,
      step: 'destination',
      destination: 'SW03 2082',
      canUsePhotoResult: true,
    });
    expect(markup).toContain('SW03 2082');
    expect(markup).not.toContain('aria-label="Photo analysis"');
    expect(markup).not.toContain('class="go-button"');
    expect(markup).not.toContain('photo-submission-note');
    expect(button(markup, 'Use a different photo')).not.toContain('disabled');
  });
  it('keeps local upload available while provider configuration is unavailable', () => {
    const { markup } = renderInput({ photo, ready: false });
    expect(button(markup, 'Upload photo')).not.toContain('disabled');
    const destinationStep = renderInput({
      photo,
      step: 'destination',
      destination: 'SE12 302',
      ready: false,
    }).markup;
    expect(button(destinationStep, 'Get Directions')).toContain('disabled');
  });
  it('keeps cancellation available while analysis locks submission and replacement', () => {
    const { markup } = renderInput({
      photo,
      step: 'destination',
      destination: 'SE12 302',
      busy: true,
      status: 'Comparing plans…',
    });
    expect(markup).toMatch(/aria-label="Upload campus photo" disabled/);
    expect(markup).toMatch(/aria-label="Capture phone photo" disabled/);
    expect(button(markup, 'Finding your route…')).toContain('disabled');
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
  it('renders photo preparation errors as a high-visibility alert on the photo step', () => {
    const { markup } = renderInput({
      step: 'photo',
      error: 'Choose a photo smaller than 8 MB.',
      status: 'Preparing your photo locally…',
    });
    expect(markup).toContain(
      '<p class="photo-failure" role="alert">Choose a photo smaller than 8 MB.</p>',
    );
    expect(markup).not.toContain('class="photo-status"');
  });
});
