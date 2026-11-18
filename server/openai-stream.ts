/** Consume Responses SSE in memory and expose only the terminal response to tool validation. */
import { ProviderError } from './provider';

export async function readOpenAiResponse(
  response: Response,
  onEvent: (hasOutput: boolean) => void,
): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return response.json();
  if (!response.body)
    throw new ProviderError('OpenAI returned an empty stream.', 502, 'response', true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 2 * 1024 * 1024)
        throw new ProviderError(
          'OpenAI returned an oversized stream event.',
          502,
          'response',
          false,
        );
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data || data === '[DONE]') continue;
        const event = JSON.parse(data);
        onEvent(
          (event.type === 'response.output_text.delta' ||
            event.type === 'response.function_call_arguments.delta') &&
            typeof event.delta === 'string' &&
            event.delta.length > 0,
        );
        if (['response.completed', 'response.incomplete', 'response.failed'].includes(event.type))
          return event.response;
        if (event.type === 'error')
          throw new ProviderError(
            'OpenAI interrupted the response stream. Please retry.',
            503,
            'unavailable',
            true,
          );
      }
      if (chunk.done) break;
    }
    throw new ProviderError(
      'OpenAI ended the stream before completing the response.',
      502,
      'response',
      true,
    );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
