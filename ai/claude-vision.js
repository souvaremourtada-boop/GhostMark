/**
 * ============================================================
 * GhostMark — ai/claude-vision.js
 * Analyse sémantique des zones par Claude Vision API
 * ============================================================
 *
 * C'est ici que réside la VRAIE IA du projet.
 * Claude Vision (claude-sonnet) analyse l'image du document
 * et comprend SÉMANTIQUEMENT son contenu pour identifier
 * les meilleures zones de watermarking.
 *
 * DIFFÉRENCE FONDAMENTALE AVEC LE FALLBACK STATISTIQUE :
 * -------------------------------------------------------
 * Fallback : "variance = 850 → robuste"
 *   → ne sait pas ce qu'est cette zone
 *
 * Claude Vision : "c'est la marge gauche du document,
 *   elle est robuste car elle contient peu d'information
 *   essentielle et résistera aux compressions"
 *   → comprend le contenu et le contexte
 *
 * FLUX D'APPEL :
 * ──────────────
 *   Image (base64)
 *       │
 *       ▼
 *   Prompt structuré → Claude Vision API
 *       │
 *       ▼
 *   Réponse JSON → Parsing → Zones avec coordonnées
 *       │
 *       ▼
 *   Conversion % → pixels → Rendu sur canvas
 *
 * GESTION DES ERREURS :
 * ─────────────────────
 *   Si l'API échoue → retour automatique au fallback statistique
 *   (zone-analyzer.js) pour assurer la continuité du service
 * ============================================================
 */

'use strict';

// ─── CONSTANTES ──────────────────────────────────────────────

/** Endpoint de l'API Anthropic */
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/** Modèle Claude utilisé pour l'analyse visuelle */
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

/** Nombre maximum de tokens dans la réponse */
const MAX_TOKENS = 1000;

/**
 * Prompt système envoyé à Claude Vision.
 *
 * PRINCIPES DE CONCEPTION DU PROMPT :
 * 1. Rôle clair → "Tu es un expert en watermarking"
 * 2. Format strict → "Retourne UNIQUEMENT le JSON"
 *    (évite tout texte parasite qui casserait le parsing)
 * 3. Règles métier précises → quels types sont robustes/fragiles
 * 4. Format de sortie explicite → structure JSON exacte attendue
 */
const ANALYSIS_PROMPT = `Tu es un expert en watermarking de documents administratifs officiels.

Analyse cette image de document et identifie les zones optimales pour insérer un watermark numérique invisible.

RÈGLES DE ROBUSTESSE :
- "background" (arrière-plan clair/blanc) → robust: true ✓
- "margin" (marge vide) → robust: true ✓
- "footer" (pied de page peu chargé) → robust: true ✓
- "header" (en-tête léger) → robust: true ✓
- "text" (zone de texte dense) → robust: false ✗
- "logo" (logo ou sceau officiel) → robust: false ✗
- "signature" (zone de signature) → robust: false ✗
- "photo" (photo ou illustration) → robust: false ✗

Retourne UNIQUEMENT ce JSON, sans aucun texte avant ou après, sans backticks :
{
  "zones": [
    {
      "x_percent": 0.05,
      "y_percent": 0.05,
      "width_percent": 0.15,
      "height_percent": 0.12,
      "type": "margin",
      "label": "Marge supérieure gauche",
      "robust": true,
      "reason": "Marge vide, aucun contenu critique"
    }
  ],
  "document_type": "Attestation administrative",
  "security_score": 85,
  "language": "fr"
}

Identifie entre 5 et 8 zones couvrant l'ensemble du document.
Les coordonnées sont en pourcentage de la taille totale (0.0 à 1.0).`;

// ─── ANALYSE IA ──────────────────────────────────────────────

/**
 * Envoie l'image à Claude Vision et récupère l'analyse des zones.
 *
 * @param {string} base64Image - Image encodée en base64 (sans le préfixe data:)
 * @param {number} width       - Largeur de l'image en pixels
 * @param {number} height      - Hauteur de l'image en pixels
 * @param {Function} [onLog]   - Callback de logging (msg, type) → void
 * @returns {Promise<{
 *   zones: Array,
 *   documentType: string,
 *   securityScore: number,
 *   language: string,
 *   source: string
 * }>}
 * @throws {Error} Si l'appel API échoue ou si la réponse est invalide
 */
async function analyzeWithClaudeVision(base64Image, width, height, onLog = () => {}) {
  onLog('🧠 Envoi du document à Claude Vision...', 'info');

  // ── Construction de la requête API ─────────────────────────
  const requestBody = {
    model:      CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          {
            // Bloc image : envoyé en base64 avec type MIME
            type: 'image',
            source: {
              type:       'base64',
              media_type: 'image/jpeg', // toujours JPEG pour compresser
              data:       base64Image
            }
          },
          {
            // Bloc texte : le prompt d'analyse
            type: 'text',
            text: ANALYSIS_PROMPT
          }
        ]
      }
    ]
  };

  // ── Appel API ──────────────────────────────────────────────
  const response = await fetch(ANTHROPIC_API_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Claude Vision erreur ${response.status}: ${errorText}`);
  }

  const apiData = await response.json();

  // ── Extraction du texte de la réponse ─────────────────────
  // La réponse peut contenir plusieurs blocs de contenu
  const responseText = apiData.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  onLog(`✅ Réponse Claude Vision reçue (${responseText.length} chars)`, 'info');

  // ── Parsing JSON ───────────────────────────────────────────
  // Nettoyage des éventuels backticks markdown
  const cleanJson = responseText
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleanJson);
  } catch (parseError) {
    throw new Error(`Réponse Claude invalide (pas du JSON valide): ${cleanJson.substring(0, 200)}`);
  }

  // ── Validation de la structure ─────────────────────────────
  if (!parsed.zones || !Array.isArray(parsed.zones) || parsed.zones.length === 0) {
    throw new Error('Réponse Claude invalide : champ "zones" absent ou vide');
  }

  // ── Conversion coordonnées % → pixels ─────────────────────
  const zones = parsed.zones
    .filter(z => {
      // Filtrage des zones avec coordonnées invalides
      return z.x_percent >= 0 && z.x_percent <= 1
          && z.y_percent >= 0 && z.y_percent <= 1
          && z.width_percent  > 0
          && z.height_percent > 0;
    })
    .map(z => ({
      // Coordonnées en pixels
      x:    Math.floor(z.x_percent * width),
      y:    Math.floor(z.y_percent * height),
      size: Math.floor(
        Math.max(z.width_percent, z.height_percent)
        * Math.min(width, height)
      ),
      // Propriétés sémantiques
      type:        z.type    || 'unknown',
      label:       z.label   || 'Zone sans nom',
      robust:      z.robust  === true,
      reason:      z.reason  || '',
      robustScore: z.robust ? 85 : 20,
      source:      'claude-vision' // indique l'origine IA
    }));

  onLog(`📊 ${zones.length} zones identifiées par Claude Vision`, 'info');
  onLog(`📄 Type de document détecté : "${parsed.document_type}"`, 'info');

  zones.forEach(z => {
    const icon = z.robust ? '🟢' : '🔴';
    onLog(`  ${icon} ${z.label} (${z.type}) — ${z.reason}`, 'detail');
  });

  return {
    zones,
    documentType:  parsed.document_type  || 'Document administratif',
    securityScore: parsed.security_score || 75,
    language:      parsed.language        || 'fr',
    source:        'claude-vision'
  };
}

/**
 * Convertit un canvas HTML5 en base64 JPEG optimisé pour l'API.
 *
 * La qualité JPEG 0.8 offre un bon compromis entre :
 *   - Taille de la requête (bande passante API)
 *   - Qualité d'analyse (Claude doit voir les détails)
 *
 * @param {HTMLCanvasElement} canvas  - Canvas avec l'image du document
 * @param {number}            [quality=0.8] - Qualité JPEG (0 à 1)
 * @returns {string} Base64 sans le préfixe "data:image/jpeg;base64,"
 */
function canvasToBase64(canvas, quality = 0.8) {
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  // Suppression du préfixe pour l'API (qui n'attend que les données)
  return dataUrl.split(',')[1];
}

// ─── EXPORTS ─────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    analyzeWithClaudeVision,
    canvasToBase64,
    CLAUDE_MODEL,
    ANTHROPIC_API_URL
  };
} else {
  window.GhostMarkAI = {
    analyzeWithClaudeVision,
    canvasToBase64,
    CLAUDE_MODEL,
    ANTHROPIC_API_URL
  };
}
