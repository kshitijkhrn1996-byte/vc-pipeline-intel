// Thin Gemini Flash client: structured JSON output, low thinking, retry on rate limits.
import { GEMINI_MODEL } from '../config.js';

export async function generateJson({ system, user, schema }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0,
          thinkingConfig: { thinkingLevel: 'low' } },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (res.status === 429 || res.status >= 500) {          // free-tier rate limit: back off and retry
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(`gemini ${res.status}: ${data.error?.message}`);
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
    return JSON.parse(text);
  }
  throw new Error('gemini: rate limited after retries');
}
