/** Public provider names and submission disclosures; never contains credentials. */
export type AiProviderName = 'gemini' | 'openai';

export function aiProviderDetails(name: AiProviderName = 'gemini') {
  return name === 'openai'
    ? {
        label: 'OpenAI',
        recipient: 'OpenAI',
        dataUse: 'OpenAI API data handling applies.',
      }
    : {
        label: 'Gemini',
        recipient: 'Google Gemini',
        dataUse: 'Google may use free-tier inputs to improve its products.',
      };
}
