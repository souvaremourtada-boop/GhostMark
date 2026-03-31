/**
 * ============================================================
 * GhostMark — core/dct.js
 * Transformée en Cosinus Discrète (DCT) 8x8
 * ============================================================
 *
 * La DCT est l'algorithme mathématique au cœur du watermarking
 * fréquentiel. Elle décompose un bloc image en coefficients
 * fréquentiels — exactement comme dans la compression JPEG.
 *
 * POURQUOI LA DCT ?
 * -----------------
 * Une image peut être vue comme une somme de "motifs" de
 * fréquences différentes :
 *   - Basses fréquences  → grandes structures, couleurs de fond
 *   - Fréquences moyennes → détails, contours
 *   - Hautes fréquences  → bruit, grain fin
 *
 * GhostMark cible les FRÉQUENCES MOYENNES pour insérer le
 * watermark car :
 *   ✓ Imperceptibles visuellement (contrairement aux basses)
 *   ✓ Préservées par la compression JPEG (contrairement aux hautes)
 *   ✓ Résistent aux redimensionnements et captures d'écran
 *
 * STRUCTURE DE LA MATRICE DCT 8x8 :
 * ----------------------------------
 *   [DC  , AC01, AC02, AC03, AC04, AC05, AC06, AC07]
 *   [AC10, AC11, AC12, AC13, AC14, AC15, AC16, AC17]
 *   [AC20, AC21, AC22, ...                         ]
 *   ...
 *
 *   DC   = fréquence 0,0 = luminosité moyenne du bloc (basse)
 *   AC0x = fréquences horizontales croissantes
 *   ACx0 = fréquences verticales croissantes
 *
 * INDICES CIBLES (fréquences moyennes en ordre zig-zag JPEG) :
 *   [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13]
 * ============================================================
 */

'use strict';

// ─── CONSTANTES ──────────────────────────────────────────────

/** Taille du bloc DCT (standard JPEG : 8×8 pixels) */
const BLOCK_SIZE = 8;

/**
 * Indices des fréquences moyennes dans la matrice 8×8 aplatie.
 * Ces positions correspondent aux coefficients AC de fréquence
 * intermédiaire — ni trop bas (visible), ni trop haut (fragile).
 *
 * Ordre zig-zag JPEG (lecture diagonale de la matrice) :
 *   Position 0  = DC  (0,0) → ignorée
 *   Position 1  = AC  (0,1) → première fréquence moyenne ✓
 *   Position 2  = AC  (1,0) → ✓
 *   ...
 *   Position 13 = AC  (2,1) → dernière fréquence moyenne ✓
 */
const MID_FREQ_INDICES = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13];

// ─── FONCTIONS UTILITAIRES ───────────────────────────────────

/**
 * Borne une valeur entre 0 et 255 (plage valide d'un pixel).
 *
 * @param {number} v - Valeur à borner
 * @returns {number} Valeur bornée entre 0 et 255
 *
 * @example
 * clamp(300)  // → 255
 * clamp(-10)  // → 0
 * clamp(128)  // → 128
 */
function clamp(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Convertit les composantes RGB d'un pixel en luminance Y
 * (canal de luminosité perceptif, standard ITU-R BT.601).
 *
 * POURQUOI Y ET PAS RGB DIRECTEMENT ?
 * L'œil humain est bien plus sensible aux variations de
 * luminosité qu'aux variations de couleur. En watermarkant
 * le canal Y uniquement, on minimise la perceptibilité
 * tout en maximisant la robustesse de l'extraction.
 *
 * @param {number} r - Composante rouge (0-255)
 * @param {number} g - Composante verte (0-255)
 * @param {number} b - Composante bleue (0-255)
 * @returns {number} Luminance Y (0-255)
 */
function rgbToY(r, g, b) {
  // Coefficients standard ITU-R BT.601
  // Le vert a le plus grand poids car l'œil y est le plus sensible
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// ─── DCT 8×8 ─────────────────────────────────────────────────

/**
 * Applique la Transformée en Cosinus Discrète (DCT-II) sur un
 * bloc de 64 valeurs (8×8 pixels).
 *
 * FORMULE MATHÉMATIQUE :
 *   DCT[u,v] = (1/4) * C(u) * C(v) * Σ Σ block[x,y]
 *              * cos((2x+1)*u*π/16) * cos((2y+1)*v*π/16)
 *
 *   où C(k) = 1/√2 si k=0, sinon C(k) = 1
 *
 * @param {Float32Array} block - Tableau de 64 valeurs de luminance
 *   Indexation : block[x * BLOCK_SIZE + y] pour le pixel (x,y)
 * @returns {Float32Array} Tableau de 64 coefficients DCT
 *   Indexation identique : coeffs[u * BLOCK_SIZE + v]
 */
function dct8(block) {
  const N = BLOCK_SIZE;
  const out = new Float32Array(64); // 8*8 = 64 coefficients

  for (let u = 0; u < N; u++) {       // u = fréquence verticale (0 à 7)
    for (let v = 0; v < N; v++) {     // v = fréquence horizontale (0 à 7)
      let sum = 0;

      // Somme sur tous les pixels du bloc
      for (let x = 0; x < N; x++) {
        for (let y = 0; y < N; y++) {
          sum += block[x * N + y]                        // valeur pixel (x,y)
            * Math.cos((2 * x + 1) * u * Math.PI / 16)  // base cosinus verticale
            * Math.cos((2 * y + 1) * v * Math.PI / 16); // base cosinus horizontale
        }
      }

      // Facteurs de normalisation C(u) et C(v)
      // → assurent que la DCT est une transformation orthonormée
      const cu = (u === 0) ? 1 / Math.sqrt(2) : 1;
      const cv = (v === 0) ? 1 / Math.sqrt(2) : 1;

      // Stockage du coefficient [u,v]
      out[u * N + v] = 0.25 * cu * cv * sum;
    }
  }

  return out;
}

/**
 * Applique la DCT Inverse (IDCT-III) sur un tableau de 64
 * coefficients fréquentiels pour reconstruire le bloc pixel.
 *
 * FORMULE MATHÉMATIQUE :
 *   pixel[x,y] = (1/4) * Σ Σ C(u)*C(v)*DCT[u,v]
 *                * cos((2x+1)*u*π/16) * cos((2y+1)*v*π/16)
 *
 * La IDCT est l'opération inverse exacte de la DCT.
 * Après DCT puis IDCT, on retrouve le bloc original
 * (aux erreurs d'arrondi flottant près).
 *
 * @param {Float32Array} coeffs - Tableau de 64 coefficients DCT
 * @returns {Float32Array} Tableau de 64 valeurs pixels reconstruites
 */
function idct8(coeffs) {
  const N = BLOCK_SIZE;
  const out = new Float32Array(64);

  for (let x = 0; x < N; x++) {      // x = ligne du pixel reconstruit
    for (let y = 0; y < N; y++) {    // y = colonne du pixel reconstruit
      let sum = 0;

      // Somme sur tous les coefficients fréquentiels
      for (let u = 0; u < N; u++) {
        for (let v = 0; v < N; v++) {
          const cu = (u === 0) ? 1 / Math.sqrt(2) : 1;
          const cv = (v === 0) ? 1 / Math.sqrt(2) : 1;
          sum += cu * cv * coeffs[u * N + v]
            * Math.cos((2 * x + 1) * u * Math.PI / 16)
            * Math.cos((2 * y + 1) * v * Math.PI / 16);
        }
      }

      out[x * N + y] = 0.25 * sum; // valeur pixel reconstruite
    }
  }

  return out;
}

// ─── EXTRACTION D'UN BLOC ────────────────────────────────────

/**
 * Extrait un bloc 8×8 de luminance depuis les données RGBA
 * d'un ImageData (canvas HTML5).
 *
 * @param {Uint8ClampedArray} data - Données RGBA du canvas
 * @param {number} width  - Largeur totale de l'image en pixels
 * @param {number} bx     - Coordonnée X du coin haut-gauche du bloc
 * @param {number} by     - Coordonnée Y du coin haut-gauche du bloc
 * @param {number} imgW   - Largeur image (pour vérification bornes)
 * @param {number} imgH   - Hauteur image (pour vérification bornes)
 * @returns {Float32Array} Bloc de 64 valeurs de luminance
 */
function extractBlock(data, width, bx, by, imgW, imgH) {
  const block = new Float32Array(64);

  for (let dy = 0; dy < BLOCK_SIZE; dy++) {
    for (let dx = 0; dx < BLOCK_SIZE; dx++) {
      const px = Math.min(bx + dx, imgW - 1); // borne à la largeur
      const py = Math.min(by + dy, imgH - 1); // borne à la hauteur
      const idx = (py * width + px) * 4;      // index dans RGBA (×4)

      // Conversion RGB → luminance Y
      block[dy * BLOCK_SIZE + dx] = rgbToY(
        data[idx],     // R
        data[idx + 1], // G
        data[idx + 2]  // B
        // data[idx+3] = Alpha, ignoré
      );
    }
  }

  return block;
}

/**
 * Réinjecte un bloc 8×8 modifié dans les données RGBA du canvas.
 *
 * COMMENT LA MODIFICATION EST APPLIQUÉE :
 * On calcule le delta (différence) entre le bloc original et le
 * bloc modifié, puis on applique ce delta aux 3 canaux RGB avec
 * un facteur d'atténuation (0.3) pour rester imperceptible.
 *
 * Facteur 0.3 → perturbation < 3 niveaux de gris sur 255
 *             → PSNR résultant > 40 dB (imperceptible)
 *
 * @param {Uint8ClampedArray} data     - Données RGBA du canvas (modifiées en place)
 * @param {number}            width    - Largeur totale de l'image
 * @param {number}            bx       - Coordonnée X du bloc
 * @param {number}            by       - Coordonnée Y du bloc
 * @param {Float32Array}      original - Bloc luminance original (64 valeurs)
 * @param {Float32Array}      modified - Bloc luminance modifié après DCT/IDCT (64 valeurs)
 * @param {number}            imgW     - Largeur image (bornes)
 * @param {number}            imgH     - Hauteur image (bornes)
 */
function injectBlock(data, width, bx, by, original, modified, imgW, imgH) {
  const ATTENUATION = 0.3; // facteur d'imperceptibilité

  for (let dy = 0; dy < BLOCK_SIZE; dy++) {
    for (let dx = 0; dx < BLOCK_SIZE; dx++) {
      const px = Math.min(bx + dx, imgW - 1);
      const py = Math.min(by + dy, imgH - 1);
      const idx = (py * width + px) * 4;

      // Delta entre la luminance modifiée et l'originale
      const delta = modified[dy * BLOCK_SIZE + dx]
                  - original[dy * BLOCK_SIZE + dx];

      // Application du delta atténué sur les 3 canaux RGB
      // (on modifie uniformément R, G, B pour préserver la teinte)
      data[idx]     = clamp(data[idx]     + delta * ATTENUATION); // R
      data[idx + 1] = clamp(data[idx + 1] + delta * ATTENUATION); // G
      data[idx + 2] = clamp(data[idx + 2] + delta * ATTENUATION); // B
      // Alpha (idx+3) : inchangé
    }
  }
}

// ─── CALCUL PSNR ─────────────────────────────────────────────

/**
 * Calcule le PSNR (Peak Signal-to-Noise Ratio) entre l'image
 * originale et l'image watermarkée.
 *
 * Le PSNR mesure la qualité de l'image watermarkée :
 *   > 40 dB → imperceptible (excellent)
 *   35-40 dB → quasi-imperceptible (bon)
 *   < 35 dB → dégradation visible (insuffisant)
 *
 * FORMULE : PSNR = 10 * log10(255² / MSE)
 *   MSE = Mean Squared Error = moyenne des (pixel_orig - pixel_wm)²
 *
 * @param {Uint8ClampedArray} original   - Données RGBA originales
 * @param {Uint8ClampedArray} watermarked - Données RGBA watermarkées
 * @returns {number} PSNR en décibels
 */
function computePSNR(original, watermarked) {
  let mse = 0;
  const len = original.length;

  for (let i = 0; i < len; i++) {
    const diff = original[i] - watermarked[i];
    mse += diff * diff; // carré de la différence
  }

  mse /= len; // moyenne

  // Cas parfait : images identiques → PSNR infini
  if (mse === 0) return Infinity;

  // PSNR en décibels
  return 10 * Math.log10((255 * 255) / mse);
}

// ─── EXPORTS ─────────────────────────────────────────────────

// Export pour usage dans Node.js ET dans le navigateur
if (typeof module !== 'undefined' && module.exports) {
  // Node.js
  module.exports = {
    dct8,
    idct8,
    extractBlock,
    injectBlock,
    computePSNR,
    clamp,
    rgbToY,
    BLOCK_SIZE,
    MID_FREQ_INDICES
  };
} else {
  // Navigateur : attacher à window
  window.GhostMarkDCT = {
    dct8,
    idct8,
    extractBlock,
    injectBlock,
    computePSNR,
    clamp,
    rgbToY,
    BLOCK_SIZE,
    MID_FREQ_INDICES
  };
}
