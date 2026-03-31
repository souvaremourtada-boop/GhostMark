/**
 * ============================================================
 * GhostMark — core/zone-analyzer.js
 * Analyse statistique des zones (fallback sans API IA)
 * ============================================================
 *
 * Ce module fournit une analyse de zones basée sur des calculs
 * statistiques locaux — utilisé comme FALLBACK quand l'API
 * Claude Vision est indisponible.
 *
 * DIFFÉRENCE AVEC L'IA (claude-vision.js) :
 * ------------------------------------------
 * L'IA comprend SÉMANTIQUEMENT le document :
 *   "Cette zone contient un logo officiel → fragile"
 *   "Cette zone est la marge gauche → robuste"
 *
 * L'analyse statistique ne comprend PAS le contenu :
 *   "La variance de cette zone est 850 → robuste"
 *   "La variance de cette zone est 45  → fragile"
 *
 * Les deux approches conduisent souvent au même résultat
 * pour les documents administratifs standards (fond blanc,
 * texte noir, marges claires).
 *
 * SCORE DE ROBUSTESSE :
 * ----------------------
 * Une zone est "robuste" si sa variance locale est dans la
 * plage [MIN_VARIANCE, MAX_VARIANCE] :
 *   - Trop faible : zone uniforme (fond blanc) → le watermark
 *     serait détectable comme une légère variation de couleur
 *   - Trop forte  : zone complexe (texte dense, logo) → le
 *     watermark serait visible comme une perturbation du contenu
 *   - Plage idéale : zone avec légère texture ou gradient
 *     → watermark invisible et robuste
 * ============================================================
 */

'use strict';

// ─── CONSTANTES ──────────────────────────────────────────────

/** Variance minimale pour qu'une zone soit robuste */
const MIN_VARIANCE = 50;

/** Variance maximale pour qu'une zone soit robuste */
const MAX_VARIANCE = 3000;

/**
 * Positions relatives des zones candidates (en % de l'image).
 * Couvrent les marges et zones intermédiaires typiques d'un
 * document administratif standard.
 *
 * Chaque position : { x, y } entre 0 et 1
 * La zone analysée commence à ce point et s'étend de `size` pixels
 */
const ZONE_POSITIONS = [
  { x: 0.05, y: 0.05, label: 'Marge Haut-Gauche',  type: 'margin' },
  { x: 0.75, y: 0.05, label: 'Marge Haut-Droite',  type: 'margin' },
  { x: 0.05, y: 0.75, label: 'Marge Bas-Gauche',   type: 'margin' },
  { x: 0.75, y: 0.75, label: 'Marge Bas-Droite',   type: 'margin' },
  { x: 0.40, y: 0.10, label: 'En-tête Centre',     type: 'header' },
  { x: 0.40, y: 0.85, label: 'Pied de page',       type: 'footer' },
  { x: 0.25, y: 0.40, label: 'Zone Milieu-Gauche', type: 'background' },
  { x: 0.60, y: 0.40, label: 'Zone Milieu-Droite', type: 'background' },
];

// ─── CALCUL DE VARIANCE ──────────────────────────────────────

/**
 * Calcule la variance locale des pixels dans une zone rectangulaire.
 *
 * La variance mesure la "dispersion" des valeurs de luminance :
 *   variance = moyenne des (pixel - moyenne_pixels)²
 *
 * Interprétation :
 *   variance ≈ 0      → zone uniforme (fond blanc pur)
 *   variance ≈ 100    → légère texture → idéal pour watermark
 *   variance ≈ 5000   → zone complexe (texte dense)
 *
 * @param {Uint8ClampedArray} data   - Données RGBA du canvas
 * @param {number}            width  - Largeur totale de l'image
 * @param {number}            x      - Coin X de la zone
 * @param {number}            y      - Coin Y de la zone
 * @param {number}            size   - Taille de l'échantillon (pixels)
 * @returns {number} Variance locale
 */
function computeLocalVariance(data, width, x, y, size) {
  const samples = [];
  let sum = 0;

  // Échantillonnage de la zone (max 16×16 pixels pour la rapidité)
  const sampleSize = Math.min(size, 16);

  for (let dy = 0; dy < sampleSize; dy++) {
    for (let dx = 0; dx < sampleSize; dx++) {
      const idx = ((y + dy) * width + (x + dx)) * 4;
      // Luminance Y du pixel
      const gray = 0.299 * data[idx]
                 + 0.587 * data[idx + 1]
                 + 0.114 * data[idx + 2];
      samples.push(gray);
      sum += gray;
    }
  }

  const mean = sum / samples.length;

  // Calcul de la variance : moyenne des carrés des écarts
  let variance = 0;
  for (const s of samples) {
    variance += (s - mean) ** 2;
  }
  variance /= samples.length;

  return variance;
}

// ─── ANALYSE PRINCIPALE ──────────────────────────────────────

/**
 * Analyse statistiquement les zones d'un document et détermine
 * lesquelles sont optimales pour l'insertion du watermark.
 *
 * Cette fonction est le FALLBACK de claude-vision.js.
 * Elle est appelée quand l'API Claude Vision est indisponible
 * ou en mode hors-ligne.
 *
 * @param {Uint8ClampedArray} data   - Données RGBA du canvas
 * @param {number}            width  - Largeur de l'image en pixels
 * @param {number}            height - Hauteur de l'image en pixels
 * @returns {Array} Tableau de zones avec leurs propriétés
 *   Chaque zone : {
 *     x, y        : coordonnées en pixels
 *     size        : taille du bloc en pixels
 *     type        : type de zone (margin, header, etc.)
 *     label       : nom lisible de la zone
 *     robust      : boolean — true si optimale pour watermark
 *     variance    : variance locale calculée
 *     reason      : explication de la décision
 *     robustScore : score numérique 0-100
 *   }
 */
function analyzeZonesFallback(data, width, height) {
  // Taille des blocs : 1/6 de la plus petite dimension
  const blockSize = Math.max(
    50,
    Math.floor(Math.min(width, height) / 6)
  );

  const zones = [];

  for (const pos of ZONE_POSITIONS) {
    // Conversion des coordonnées relatives en pixels
    const px = Math.floor(pos.x * width);
    const py = Math.floor(pos.y * height);

    // Vérification que la zone est dans les bornes de l'image
    if (px + blockSize > width || py + blockSize > height) continue;
    if (px < 0 || py < 0) continue;

    // Calcul de la variance locale
    const variance = computeLocalVariance(data, width, px, py, blockSize);

    // Décision de robustesse
    const robust = variance >= MIN_VARIANCE && variance <= MAX_VARIANCE;

    // Score numérique de robustesse (0-100)
    let robustScore;
    if (variance < MIN_VARIANCE) {
      // Zone trop uniforme → score proportionnel à variance/MIN_VARIANCE
      robustScore = Math.round((variance / MIN_VARIANCE) * 50);
    } else if (variance > MAX_VARIANCE) {
      // Zone trop complexe → score décroissant
      robustScore = Math.max(0, Math.round(50 - (variance - MAX_VARIANCE) / 100));
    } else {
      // Zone optimale → score 50-100 selon position dans la plage
      const range = MAX_VARIANCE - MIN_VARIANCE;
      const pos_in_range = variance - MIN_VARIANCE;
      // Pic à variance = (MIN+MAX)/2
      robustScore = 50 + Math.round(
        50 * (1 - Math.abs(pos_in_range / range - 0.5) * 2)
      );
    }

    // Explication de la décision
    let reason;
    if (variance < MIN_VARIANCE) {
      reason = `Zone trop uniforme (variance=${Math.round(variance)}) — watermark détectable`;
    } else if (variance > MAX_VARIANCE) {
      reason = `Zone trop complexe (variance=${Math.round(variance)}) — watermark visible`;
    } else {
      reason = `Zone optimale (variance=${Math.round(variance)}) — watermark invisible et robuste`;
    }

    zones.push({
      x:           px,
      y:           py,
      size:        blockSize,
      type:        pos.type,
      label:       pos.label,
      robust,
      variance:    Math.round(variance),
      reason,
      robustScore,
      source:      'statistical' // indique que c'est le fallback
    });
  }

  // Tri : zones robustes en premier, puis par score décroissant
  zones.sort((a, b) => {
    if (a.robust !== b.robust) return b.robust - a.robust;
    return b.robustScore - a.robustScore;
  });

  return zones;
}

// ─── EXPORTS ─────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    analyzeZonesFallback,
    computeLocalVariance,
    MIN_VARIANCE,
    MAX_VARIANCE,
    ZONE_POSITIONS
  };
} else {
  window.GhostMarkZoneAnalyzer = {
    analyzeZonesFallback,
    computeLocalVariance,
    MIN_VARIANCE,
    MAX_VARIANCE,
    ZONE_POSITIONS
  };
}
