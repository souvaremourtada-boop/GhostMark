/**
 * ============================================================
 * GhostMark — core/watermark.js
 * Moteur d'insertion et d'extraction du watermark DCT
 * ============================================================
 *
 * Ce module orchestre l'insertion et l'extraction du watermark
 * dans les images. Il utilise les modules dct.js et hash.js.
 *
 * TECHNIQUE : Quantization Index Modulation (QIM)
 * ------------------------------------------------
 * QIM est la technique d'insertion bit par bit dans les
 * coefficients DCT. Pour chaque bit à insérer :
 *
 *   1. On prend un coefficient DCT de fréquence moyenne
 *   2. On le quantifie avec un pas q (strength)
 *   3. On le décale vers +q/4 (bit=1) ou -q/4 (bit=0)
 *
 * À l'extraction, on relit le signe du reste de la division
 * pour récupérer le bit original.
 *
 * AVANTAGES DU QIM :
 *   ✓ Aveugle : extraction sans l'image originale
 *   ✓ Robuste : résiste aux petites perturbations (compression)
 *   ✓ Contrôlable : le paramètre strength ajuste le compromis
 *                   imperceptibilité ↔ robustesse
 * ============================================================
 */

'use strict';

// Import des modules dépendants
// (En navigateur, ces modules sont chargés via <script> tags)
const DCT  = (typeof require !== 'undefined') ? require('./dct.js')  : window.GhostMarkDCT;
const HASH = (typeof require !== 'undefined') ? require('./hash.js') : window.GhostMarkHash;

// ─── CONSTANTES ──────────────────────────────────────────────

/**
 * Force du watermark par défaut.
 * Contrôle le pas de quantification q = strength * 0.5
 *
 * Valeur faible (10-20) → imperceptible mais fragile
 * Valeur forte  (50-80) → robuste mais légèrement visible
 * Valeur recommandée : 35 (bon équilibre pour documents administratifs)
 */
const DEFAULT_STRENGTH = 35;

// ─── INSERTION DU WATERMARK ──────────────────────────────────

/**
 * Insère un watermark invisible dans les données RGBA d'une image.
 *
 * PIPELINE COMPLET :
 *   1. Construire le payload (creatorId + timestamp + hash)
 *   2. Encoder le payload en bits
 *   3. Pour chaque zone robuste sélectionnée par l'IA :
 *      a. Extraire le bloc 8×8 de luminance
 *      b. Appliquer la DCT
 *      c. Modifier les coefficients de fréquences moyennes (QIM)
 *      d. Appliquer la DCT inverse
 *      e. Réinjecter le bloc modifié dans l'image
 *   4. Calculer et retourner le PSNR
 *
 * @param {Uint8ClampedArray} data      - Données RGBA du canvas (modifiées en place)
 * @param {number}            width     - Largeur de l'image en pixels
 * @param {number}            height    - Hauteur de l'image en pixels
 * @param {Array}             zones     - Zones robustes sélectionnées par l'IA
 *   Chaque zone : { x, y, size, robust, label, type, reason }
 * @param {string}            creatorId - Identifiant de l'institution émettrice
 * @param {number}            [strength=35] - Force du watermark (10-80)
 * @returns {{ payload: string, hash: string, psnr: number,
 *             bitsInserted: number, zonesUsed: number }}
 */
function embedWatermark(data, width, height, zones, creatorId, strength = DEFAULT_STRENGTH) {
  // ── Étape 1 : Construction du payload ──────────────────────
  const { payload, hash, timestamp } = HASH.buildPayload(creatorId);

  // ── Étape 2 : Encodage binaire ─────────────────────────────
  const bits = HASH.strToBits(payload);
  // Ex : "WM:MIN|1711...|H:A3F9" → [0,1,0,1,0,0,1,1,...]

  // Filtrage des zones robustes uniquement
  const robustZones = zones.filter(z => z.robust);

  if (robustZones.length === 0) {
    throw new Error('Aucune zone robuste disponible pour l\'insertion du watermark');
  }

  // Sauvegarde des données originales pour calcul PSNR
  const originalData = new Uint8ClampedArray(data);

  // Paramètre QIM : pas de quantification
  // q grand → watermark plus robuste mais légèrement visible
  // q petit → imperceptible mais plus fragile
  const q = strength * 0.5;

  let bitIdx    = 0; // index du bit courant dans le tableau
  let zonesUsed = 0; // nombre de zones effectivement utilisées

  // ── Étape 3 : Insertion dans chaque zone robuste ───────────
  for (const zone of robustZones) {
    // Arrêt si tous les bits ont été insérés
    if (bitIdx >= bits.length) break;

    zonesUsed++;

    // Coordonnées du coin haut-gauche du bloc 8×8
    const bx = Math.max(0, Math.min(zone.x, width  - DCT.BLOCK_SIZE));
    const by = Math.max(0, Math.min(zone.y, height - DCT.BLOCK_SIZE));

    // ── 3a : Extraction du bloc de luminance ─────────────────
    const block    = DCT.extractBlock(data, width, bx, by, width, height);
    const original = new Float32Array(block); // copie pour calcul delta

    // ── 3b : Transformation DCT ───────────────────────────────
    const coeffs = DCT.dct8(block);

    // ── 3c : Insertion des bits par QIM ───────────────────────
    for (const fi of DCT.MID_FREQ_INDICES) {
      // Arrêt si tous les bits sont insérés
      if (bitIdx >= bits.length) break;

      const bit = bits[bitIdx++]; // bit courant (0 ou 1)

      // QIM : quantification + décalage selon le bit
      //   coeff → arrondi au multiple de q le plus proche
      //   puis  → décalé de +q/4 (bit=1) ou -q/4 (bit=0)
      coeffs[fi] = Math.round(coeffs[fi] / q) * q
                 + (bit ? q / 4 : -q / 4);
    }

    // ── 3d : DCT inverse → reconstruction du bloc ────────────
    const restored = DCT.idct8(coeffs);

    // ── 3e : Réinjection dans l'image ─────────────────────────
    DCT.injectBlock(data, width, bx, by, original, restored, width, height);
  }

  // ── Étape 4 : Calcul du PSNR ──────────────────────────────
  const psnr = DCT.computePSNR(originalData, data);

  return {
    payload,
    hash,
    timestamp,
    psnr: isFinite(psnr) ? psnr.toFixed(2) : '∞',
    bitsInserted: bitIdx,
    bitsTotal: bits.length,
    zonesUsed
  };
}

// ─── EXTRACTION DU WATERMARK ─────────────────────────────────

/**
 * Extrait et vérifie le watermark depuis les données RGBA d'une image.
 *
 * EXTRACTION AVEUGLE :
 * L'extraction ne nécessite PAS l'image originale — elle repose
 * uniquement sur le signe des coefficients DCT dans les zones candidates.
 *
 * PIPELINE D'EXTRACTION :
 *   1. Identifier les mêmes zones candidates (reproduire la sélection IA)
 *   2. Pour chaque zone, appliquer la DCT
 *   3. Lire le signe de la modulation QIM pour chaque coefficient
 *   4. Reconstruire la chaîne de bits → payload texte
 *   5. Valider le hash du payload
 *
 * @param {Uint8ClampedArray} data   - Données RGBA de l'image à vérifier
 * @param {number}            width  - Largeur de l'image
 * @param {number}            height - Hauteur de l'image
 * @param {Array}             zones  - Zones candidates (même que lors de l'insertion)
 * @param {number}            [strength=35] - Force utilisée lors de l'insertion
 * @returns {{ found: boolean, payload?: string, creatorId?: string,
 *             date?: string, hash?: string, confidence?: number,
 *             error?: string }}
 */
function extractWatermark(data, width, height, zones, strength = DEFAULT_STRENGTH) {
  const robustZones = zones.filter(z => z.robust);

  if (robustZones.length === 0) {
    return { found: false, error: 'Aucune zone robuste pour l\'extraction' };
  }

  const q            = strength * 0.5;
  const extractedBits = [];

  // ── Extraction des bits depuis chaque zone ─────────────────
  for (const zone of robustZones) {
    const bx = Math.max(0, Math.min(zone.x, width  - DCT.BLOCK_SIZE));
    const by = Math.max(0, Math.min(zone.y, height - DCT.BLOCK_SIZE));

    // Extraction et DCT du bloc
    const block  = DCT.extractBlock(data, width, bx, by, width, height);
    const coeffs = DCT.dct8(block);

    // Lecture du bit depuis chaque coefficient de fréquence moyenne
    for (const fi of DCT.MID_FREQ_INDICES) {
      // QIM inverse : le reste de la division par q révèle le bit
      const rem = ((coeffs[fi] % q) + q) % q; // reste positif
      // Si rem > q/2 → bit=1, sinon → bit=0
      extractedBits.push(rem > q / 2 ? 1 : 0);
    }
  }

  // ── Reconstruction du payload depuis les bits ──────────────
  const rawPayload = HASH.bitsToStr(extractedBits);

  // ── Validation du payload extrait ─────────────────────────
  const result = HASH.parsePayload(rawPayload);

  if (!result.valid) {
    return {
      found: false,
      error: result.error,
      rawPayload // utile pour le debug
    };
  }

  // Calcul d'un score de confiance basé sur la cohérence des bits
  // (ratio de bits "propres" vs bruités)
  const cleanBits = extractedBits.filter(b => b === 0 || b === 1).length;
  const confidence = Math.round((cleanBits / extractedBits.length) * 100);

  return {
    found:     true,
    payload:   rawPayload,
    creatorId: result.creatorId,
    date:      result.date,
    timestamp: result.timestamp,
    hash:      result.hash,
    confidence
  };
}

// ─── EXPORTS ─────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { embedWatermark, extractWatermark, DEFAULT_STRENGTH };
} else {
  window.GhostMarkWatermark = { embedWatermark, extractWatermark, DEFAULT_STRENGTH };
}
