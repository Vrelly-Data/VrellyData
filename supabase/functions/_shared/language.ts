// Lightweight, deterministic language detection for short replies.
// Intent: distinguish common English vs Spanish in inbound reply_text without external services.
// Non-blocking: callers should treat null as "unknown".
//
// Heuristic v1:
// - If the text contains at least 2 distinct Spanish stopwords/markers or diacritics → 'es'
// - Else if it contains at least 2 distinct English stopwords → 'en'
// - Else null
//
// This is intentionally conservative to avoid false certainty on tiny samples.

const SPANISH_MARKERS = [
  'hola', 'gracias', 'buenos', 'buenas', 'por favor', 'porfavor', 'disculpa',
  'perdón', 'perdon', 'mañana', 'manana', 'semana', 'sí', 'si', 'no estoy',
  'hablar', 'llamar', 'reunión', 'reunion', 'correo', 'grac', 'saludos',
];

const ENGLISH_MARKERS = [
  'hello', 'thanks', 'thank you', 'hi ', 'hi,', 'please', 'sorry', 'tomorrow',
  'next week', 'meeting', 'call', "i'm", "i am", "we're", "we are", 'best,', 'regards',
];

export function detectLanguageCode(text: string | null | undefined): { code: 'en' | 'es' | null, method: string } {
  if (!text) return { code: null, method: 'heuristic_v1' };
  const t = String(text).toLowerCase();
  // Quick diacritic check that strongly hints Spanish
  const hasSpanishDiacritics = /[áéíóúñ]/.test(t);
  let esHits = hasSpanishDiacritics ? 1 : 0;
  let enHits = 0;
  const seenEs = new Set<string>();
  const seenEn = new Set<string>();
  for (const w of SPANISH_MARKERS) {
    if (!seenEs.has(w) && t.includes(w)) {
      seenEs.add(w);
      esHits++;
    }
  }
  for (const w of ENGLISH_MARKERS) {
    if (!seenEn.has(w) && t.includes(w)) {
      seenEn.add(w);
      enHits++;
    }
  }
  if (esHits >= 2) return { code: 'es', method: 'heuristic_v1' };
  if (enHits >= 2) return { code: 'en', method: 'heuristic_v1' };
  return { code: null, method: 'heuristic_v1' };
}

