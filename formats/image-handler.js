/**
 * ============================================================
 * GhostMark — formats/image-handler.js
 * Traitement des images PNG et JPG
 * ============================================================
 *
 * Pipeline complet pour les images :
 *
 *   Image (PNG/JPG)
 *       │
 *       ▼
 *   Chargement dans un canvas HTML5
 *       │
 *       ▼
 *   Analyse IA (Claude Vision) → zones robustes
 *       │
 *       ▼
 *   Insertion watermark DCT dans les zones
 *       │
 *       ▼
 *   Export PNG watermarqué + QR code
 *
 * Le canvas HTML5 est le "terrain de jeu" des pixels.
 * Il permet de lire et modifier chaque pixel individuellement
 * via getImageData() et putImageData().
 * ============================================================
 */

'use strict';

/**
 * Charge un fichier image dans un canvas et retourne
 * les données RGBA + les dimensions.
 *
 * @param {File} file - Fichier image (PNG, JPG, JPEG)
 * @param {number} [maxDim=800] - Dimension maximale (redimensionnement)
 * @returns {Promise<{
 *   canvas: HTMLCanvasElement,
 *   ctx: CanvasRenderingContext2D,
 *   imageData: ImageData,
 *   width: number,
 *   height: number,
 *   base64: string
 * }>}
 */
async function loadImageToCanvas(file, maxDim = 800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        // Calcul des dimensions avec redimensionnement si nécessaire
        let w = img.width;
        let h = img.height;

        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round(h * maxDim / w);
            w = maxDim;
          } else {
            w = Math.round(w * maxDim / h);
            h = maxDim;
          }
        }

        // Création du canvas aux bonnes dimensions
        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        // Extraction des données RGBA (4 octets par pixel)
        const imageData = ctx.getImageData(0, 0, w, h);

        // Génération du base64 pour l'API Claude Vision
        const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

        resolve({ canvas, ctx, imageData, width: w, height: h, base64 });
      };

      img.onerror = () => reject(new Error('Impossible de charger l\'image'));
      img.src = e.target.result;
    };

    reader.onerror = () => reject(new Error('Impossible de lire le fichier'));
    reader.readAsDataURL(file);
  });
}

/**
 * Applique le watermark sur une image et retourne le canvas résultant.
 *
 * @param {ImageData} imageData  - Données RGBA originales
 * @param {number}    width      - Largeur
 * @param {number}    height     - Hauteur
 * @param {Array}     zones      - Zones robustes (IA ou fallback)
 * @param {string}    creatorId  - ID de l'institution
 * @param {number}    strength   - Force du watermark
 * @returns {{ canvas: HTMLCanvasElement, result: Object }}
 */
function applyImageWatermark(imageData, width, height, zones, creatorId, strength) {
  // Copie des données pour ne pas modifier l'original
  const data = new Uint8ClampedArray(imageData.data);

  // Insertion du watermark DCT
  const WM = window.GhostMarkWatermark;
  const result = WM.embedWatermark(data, width, height, zones, creatorId, strength);

  // Création du canvas de sortie avec les données watermarkées
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width  = width;
  outputCanvas.height = height;
  const ctx = outputCanvas.getContext('2d');
  ctx.putImageData(new ImageData(data, width, height), 0, 0);

  return { canvas: outputCanvas, result };
}

/**
 * Exporte le canvas watermarqué en blob PNG téléchargeable.
 *
 * @param {HTMLCanvasElement} canvas   - Canvas watermarqué
 * @param {string}            filename - Nom du fichier
 */
function downloadWatermarkedImage(canvas, filename = 'ghostmark_secured.png') {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { loadImageToCanvas, applyImageWatermark, downloadWatermarkedImage };
} else {
  window.GhostMarkImageHandler = { loadImageToCanvas, applyImageWatermark, downloadWatermarkedImage };
}
