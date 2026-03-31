/**
 * ============================================================
 * GhostMark — qr/qr-generator.js
 * Génération du QR code de vérification sur le document
 * ============================================================
 *
 * Le QR code est l'élément CLÉ de la démocratisation.
 * Il est imprimé sur le document watermarqué et permet
 * à n'importe qui de vérifier l'authenticité avec son
 * téléphone — sans installer d'application.
 *
 * CONTENU DU QR CODE :
 * --------------------
 * URL de vérification contenant le hash du document :
 *   https://ghostmark.github.io/verify?h=A3F9C2E1&id=MIN-INTERIEUR&ts=1711234567890
 *
 * La page de vérification (qr-verifier.html) :
 *   1. Lit les paramètres de l'URL
 *   2. Demande à l'utilisateur de re-soumettre le document
 *   3. Extrait le watermark du document soumis
 *   4. Compare le hash extrait avec le hash de l'URL
 *   5. Affiche ✅ Authentique ou ❌ Non certifié
 *
 * POURQUOI CETTE APPROCHE ?
 * -------------------------
 * Le QR code NE contient PAS le document lui-même.
 * Il contient uniquement le hash — une empreinte courte.
 * La vérification nécessite de re-soumettre le document,
 * ce qui garantit que :
 *   - Le vérificateur a bien LE document physique
 *   - Personne ne peut "passer" un faux document en utilisant
 *     le QR code d'un document authentique
 *
 * LIBRAIRIE UTILISÉE :
 *   - QRCode.js (davidshimjs)
 *     https://github.com/davidshimjs/qrcodejs
 * ============================================================
 */

'use strict';

/** URL de base de la page de vérification GhostMark */
const VERIFY_BASE_URL = 'https://ghostmark.github.io/verify';

/**
 * Construit l'URL de vérification GhostMark à encoder dans le QR code.
 *
 * PARAMÈTRES DE L'URL :
 *   h  = hash FNV-1a du payload (8 chars hex)
 *   id = creatorId de l'institution
 *   ts = timestamp Unix en millisecondes
 *   v  = version du format (pour compatibilité future)
 *
 * @param {string} hash      - Hash FNV-1a du payload
 * @param {string} creatorId - Identifiant de l'institution
 * @param {number} timestamp - Horodatage Unix ms
 * @returns {string} URL complète de vérification
 *
 * @example
 * buildVerifyURL('A3F9C2E1', 'MIN-INTERIEUR', 1711234567890)
 * // → "https://ghostmark.github.io/verify?h=A3F9C2E1&id=MIN-INTERIEUR&ts=1711234567890&v=1"
 */
function buildVerifyURL(hash, creatorId, timestamp) {
  const params = new URLSearchParams({
    h:  hash,
    id: creatorId,
    ts: timestamp.toString(),
    v:  '1' // version du protocole GhostMark
  });

  return `${VERIFY_BASE_URL}?${params.toString()}`;
}

/**
 * Génère un QR code dans un élément DOM et retourne son image base64.
 *
 * @param {string} url         - URL à encoder dans le QR code
 * @param {number} [size=120]  - Taille du QR code en pixels
 * @returns {Promise<string>}  Base64 de l'image QR code (PNG)
 */
async function generateQRCode(url, size = 120) {
  return new Promise((resolve, reject) => {
    // Conteneur temporaire hors-écran
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left     = '-9999px';
    document.body.appendChild(container);

    try {
      // Génération du QR code via QRCode.js
      // colorLight blanc + colorDark bleu marine → QR code professionnel
      const qr = new QRCode(container, {
        text:        url,
        width:       size,
        height:      size,
        colorDark:   '#0D1F3C', // bleu marine GhostMark
        colorLight:  '#FFFFFF', // fond blanc
        correctLevel: QRCode.CorrectLevel.H // niveau de correction élevé
        // H = 30% de redondance → le QR code reste lisible
        // même si 30% de sa surface est endommagée (déchirure, tampon)
      });

      // Attente de la génération (légèrement asynchrone)
      setTimeout(() => {
        const img = container.querySelector('img');
        if (img && img.src) {
          const base64 = img.src; // déjà en base64 data URL
          document.body.removeChild(container);
          resolve(base64);
        } else {
          // Fallback : utiliser le canvas généré
          const canvas = container.querySelector('canvas');
          if (canvas) {
            const base64 = canvas.toDataURL('image/png');
            document.body.removeChild(container);
            resolve(base64);
          } else {
            document.body.removeChild(container);
            reject(new Error('QRCode.js n\'a pas généré d\'image'));
          }
        }
      }, 200);
    } catch (e) {
      document.body.removeChild(container);
      reject(new Error(`Erreur génération QR code: ${e.message}`));
    }
  });
}

/**
 * Ajoute le QR code de vérification sur un canvas image watermarqué.
 *
 * POSITIONNEMENT :
 *   Le QR code est placé dans le coin BAS-DROIT du document,
 *   avec une marge de 10px. Un bandeau blanc semi-transparent
 *   assure la lisibilité même sur fond coloré.
 *
 * @param {HTMLCanvasElement} documentCanvas - Canvas du document watermarqué
 * @param {string}            hash           - Hash du watermark
 * @param {string}            creatorId      - ID de l'institution
 * @param {number}            timestamp      - Horodatage
 * @param {number}            [qrSize=100]   - Taille du QR en pixels
 * @returns {Promise<HTMLCanvasElement>} Canvas avec QR code intégré
 */
async function addQRCodeToCanvas(documentCanvas, hash, creatorId, timestamp, qrSize = 100) {
  // Génération de l'URL et du QR code
  const url    = buildVerifyURL(hash, creatorId, timestamp);
  const qrBase64 = await generateQRCode(url, qrSize);

  // Création du canvas de sortie (même dimensions)
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width  = documentCanvas.width;
  outputCanvas.height = documentCanvas.height;

  const ctx = outputCanvas.getContext('2d');

  // Copie du document watermarqué
  ctx.drawImage(documentCanvas, 0, 0);

  // Chargement de l'image QR code
  const qrImage = await loadImage(qrBase64);

  // Position : coin bas-droit avec marge
  const margin = 10;
  const qrX = documentCanvas.width  - qrSize - margin;
  const qrY = documentCanvas.height - qrSize - margin - 20; // 20px pour le label

  // Bandeau blanc semi-transparent derrière le QR code
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fillRect(
    qrX - 6,
    qrY - 6,
    qrSize + 12,
    qrSize + 30 // espace pour le label
  );

  // Bordure fine bleu marine
  ctx.strokeStyle = '#0D1F3C';
  ctx.lineWidth   = 1;
  ctx.strokeRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 30);

  // Dessin du QR code
  ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

  // Label "Vérifier" sous le QR code
  ctx.fillStyle  = '#0D1F3C';
  ctx.font       = `bold ${Math.floor(qrSize * 0.1)}px Arial`;
  ctx.textAlign  = 'center';
  ctx.fillText(
    '🔍 Vérifier l\'authenticité',
    qrX + qrSize / 2,
    qrY + qrSize + 16
  );

  return outputCanvas;
}

/**
 * Ajoute le QR code sur un PDF watermarqué via PDF-lib.
 *
 * @param {Uint8Array} pdfBytes   - Bytes du PDF watermarqué
 * @param {string}     hash       - Hash du watermark
 * @param {string}     creatorId  - ID de l'institution
 * @param {number}     timestamp  - Horodatage
 * @returns {Promise<Uint8Array>} PDF avec QR code intégré
 */
async function addQRCodeToPDF(pdfBytes, hash, creatorId, timestamp) {
  const { PDFDocument } = PDFLib;

  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages  = pdfDoc.getPages();

  // Génération du QR code en base64 PNG
  const url      = buildVerifyURL(hash, creatorId, timestamp);
  const qrBase64 = await generateQRCode(url, 80); // 80px = taille compacte

  // Conversion base64 → bytes pour PDF-lib
  // On extrait les bytes de l'image PNG
  const qrDataUrl    = qrBase64;
  const qrBase64Pure = qrDataUrl.split(',')[1];
  const qrBytes      = Uint8Array.from(atob(qrBase64Pure), c => c.charCodeAt(0));

  // Embedding de l'image dans le PDF
  const qrImage = await pdfDoc.embedPng(qrBytes);

  // Ajout sur CHAQUE page (coin bas-droit)
  for (const page of pages) {
    const { width, height } = page.getSize();
    const qrSize = 60; // 60 points ≈ 2.1cm
    const margin = 15;

    page.drawImage(qrImage, {
      x:      width  - qrSize - margin,
      y:      margin,
      width:  qrSize,
      height: qrSize
    });

    // Label sous le QR code
    const font = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    page.drawText('Vérifier authenticité', {
      x:     width - qrSize - margin,
      y:     margin - 10,
      size:  6,
      font,
      color: PDFLib.rgb(0.05, 0.12, 0.24) // bleu marine
    });
  }

  return await pdfDoc.save();
}

// ─── UTILITAIRE ──────────────────────────────────────────────

/**
 * Charge une image depuis une URL ou base64 et retourne un HTMLImageElement.
 * @param {string} src - URL ou data URL de l'image
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Impossible de charger l\'image QR'));
    img.src = src;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildVerifyURL,
    generateQRCode,
    addQRCodeToCanvas,
    addQRCodeToPDF,
    VERIFY_BASE_URL
  };
} else {
  window.GhostMarkQR = {
    buildVerifyURL,
    generateQRCode,
    addQRCodeToCanvas,
    addQRCodeToPDF,
    VERIFY_BASE_URL
  };
}
