/** Stateless OpenAI/Groq input serialization and schema conversion. */
import sharp from 'sharp';
import { ProviderError, type ModelContent } from './provider';

// Shared tool declarations use Gemini's uppercase schema types. Convert schema nodes only;
// property names and literal enum values (including exact room identifiers) remain untouched.
export function jsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result = { ...schema };
  delete result.nullable;
  if (typeof result.type === 'string') result.type = result.type.toLowerCase();
  if (result.properties && typeof result.properties === 'object')
    result.properties = Object.fromEntries(
      Object.entries(result.properties).map(([name, value]) => [
        name,
        jsonSchema(value as Record<string, unknown>),
      ]),
    );
  if (result.items && typeof result.items === 'object')
    result.items = jsonSchema(result.items as Record<string, unknown>);
  return schema.nullable === true ? { anyOf: [result, { type: 'null' }] } : result;
}

export function inputMessages(contents: ModelContent[], provider = 'OpenAI') {
  return contents.map((message) => ({
    role: message.role === 'model' ? 'assistant' : 'user',
    content: message.parts.map((part) => {
      if (part.thought || part.functionCall || part.functionResponse)
        throw new ProviderError(
          `${provider} photo requests require fresh text and image input.`,
          502,
          'configuration',
          false,
        );
      if (part.inlineData)
        return {
          type: 'input_image',
          detail: 'high',
          image_url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        };
      if (part.text !== undefined) return { type: 'input_text', text: part.text };
      throw new ProviderError(`Unsupported ${provider} photo input.`, 502, 'configuration', false);
    }),
  }));
}

function escapeSvg(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[character];
  });
}

export async function groqInputMessages(contents: ModelContent[]) {
  const converted = [];
  for (const message of contents) {
    const texts: string[] = [];
    const images: Array<{ data: Buffer; label: string }> = [];
    let label = 'Image';
    for (const part of message.parts) {
      if (part.thought || part.functionCall || part.functionResponse)
        throw new ProviderError(
          'Groq photo requests require fresh text and image input.',
          502,
          'configuration',
          false,
        );
      if (part.text !== undefined) {
        texts.push(part.text);
        label = part.text.replace(/\s+/g, ' ').slice(0, 110) || label;
      } else if (part.inlineData) {
        images.push({ data: Buffer.from(part.inlineData.data, 'base64'), label });
      } else {
        throw new ProviderError('Unsupported Groq photo input.', 502, 'configuration', false);
      }
    }
    const content: unknown[] = [];
    if (texts.length) content.push({ type: 'input_text', text: texts.join('\n\n') });
    if (images.length) {
      const columns = 3;
      const cellWidth = 480;
      const cellHeight = 400;
      const rows = Math.ceil(images.length / columns);
      const composites = await Promise.all(
        images.map(async (image, index) => {
          const left = (index % columns) * cellWidth;
          const top = Math.floor(index / columns) * cellHeight;
          const labelSvg = Buffer.from(
            `<svg width="${cellWidth}" height="44"><rect width="100%" height="100%" fill="#f0f3f2"/><text x="10" y="28" font-size="16" font-family="sans-serif" fill="#173d37">${escapeSvg(image.label)}</text></svg>`,
          );
          const resized = await sharp(image.data)
            .resize(cellWidth - 12, cellHeight - 56, { fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer();
          const imageMeta = await sharp(resized).metadata();
          return [
            { input: labelSvg, left, top },
            {
              input: resized,
              left: left + Math.floor((cellWidth - (imageMeta.width ?? 0)) / 2),
              top: top + 44 + Math.floor((cellHeight - 44 - (imageMeta.height ?? 0)) / 2),
            },
          ];
        }),
      );
      const sheet = await sharp({
        create: {
          width: columns * cellWidth,
          height: rows * cellHeight,
          channels: 3,
          background: '#ffffff',
        },
      })
        .composite(composites.flat())
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      content.push({
        type: 'input_image',
        detail: 'high',
        image_url: `data:image/jpeg;base64,${sheet.toString('base64')}`,
      });
    }
    converted.push({ role: message.role === 'model' ? 'assistant' : 'user', content });
  }
  return converted;
}
