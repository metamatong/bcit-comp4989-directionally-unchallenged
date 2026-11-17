/** Public provider names and submission disclosures; never contains credentials. */
export type AiProviderName = 'gemini' | 'openai' | 'groq';

export function aiProviderDetails(name: AiProviderName = 'gemini') {
  if (name === 'openai')
    return {
      label: 'OpenAI',
      recipient: 'OpenAI',
      dataUse: 'OpenAI API data handling applies.',
    };
  if (name === 'groq')
    return {
      label: 'Groq',
      recipient: 'Groq',
      dataUse:
        'Groq may retain inputs and outputs for up to 30 days for reliability and abuse monitoring.',
    };
  return {
    label: 'Gemini',
    recipient: 'Google Gemini',
    dataUse: 'Google may use free-tier inputs to improve its products.',
  };
}
