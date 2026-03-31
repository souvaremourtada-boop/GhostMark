/**
 * ============================================================
 * GhostMark — formats/word-excel-handler.js
 * Conversion Word (.docx) et Excel (.xlsx) → PDF watermarqué
 * ============================================================
 *
 * STRATÉGIE ADOPTÉE :
 * Word et Excel ne supportent pas nativement le watermarking
 * cryptographique robuste. La solution retenue est :
 *
 *   Word/Excel → HTML (via Mammoth.js / SheetJS)
 *              → PDF (via jsPDF)
 *              → Watermark (via pdf-handler.js)
 *              → PDF watermarqué téléchargeable
 *
 * C'est la pratique standard dans les administrations :
 * les documents officiels sont toujours distribués en PDF,
 * jamais en format éditable (Word/Excel).
 *
 * LIBRAIRIES UTILISÉES :
 *   - Mammoth.js : conversion DOCX → HTML
 *     https://github.com/mwilliamson/mammoth.js
 *   - SheetJS (xlsx) : lecture XLSX → HTML tableau
 *     https://sheetjs.com/
 *   - jsPDF : génération PDF côté client
 *     https://github.com/parallax/jsPDF
 *   - pdf-handler.js : watermarking du PDF généré
 *
 * LIMITATIONS CONNUES (à mentionner au jury) :
 *   - Mammoth.js ne préserve pas les mises en page complexes
 *     (tableaux imbriqués, images flottantes, colonnes multiples)
 *   - Pour les documents simples (texte + tableaux basiques),
 *     la conversion est fidèle
 *   - Solution de production : LibreOffice côté serveur
 * ============================================================
 */

'use strict';

// ─── HANDLER WORD (.docx) ────────────────────────────────────

/**
 * Convertit un fichier Word (.docx) en PDF watermarqué.
 *
 * PIPELINE :
 *   .docx → ArrayBuffer
 *         → Mammoth.js → HTML structuré
 *         → jsPDF → PDF en mémoire
 *         → pdf-handler.js → PDF watermarqué
 *
 * @param {File}     file      - Fichier .docx
 * @param {string}   creatorId - Identifiant de l'institution
 * @param {Function} [onLog]   - Callback de logging
 * @returns {Promise<{ pdfBytes: Uint8Array, payload: string, hash: string }>}
 */
async function watermarkWord(file, creatorId, onLog = () => {}) {
  onLog('📝 Lecture du fichier Word...', 'info');

  // ── Étape 1 : Lecture du fichier en ArrayBuffer ─────────────
  const arrayBuffer = await file.arrayBuffer();

  // ── Étape 2 : Conversion DOCX → HTML via Mammoth.js ─────────
  // mammoth.convertToHtml() lit la structure XML du .docx
  // et produit un HTML sémantique propre
  onLog('🔄 Conversion Word → HTML (Mammoth.js)...', 'info');

  let htmlContent;
  try {
    const result = await mammoth.convertToHtml({ arrayBuffer });
    htmlContent  = result.value;

    // Mammoth peut signaler des avertissements (éléments non supportés)
    if (result.messages && result.messages.length > 0) {
      onLog(`⚠ ${result.messages.length} avertissement(s) de conversion`, 'warn');
    }
  } catch (e) {
    throw new Error(`Mammoth.js: impossible de convertir le fichier Word — ${e.message}`);
  }

  // ── Étape 3 : HTML → PDF via jsPDF ───────────────────────────
  onLog('🔄 Conversion HTML → PDF (jsPDF)...', 'info');

  const pdfBytes = await htmlToPDFBytes(htmlContent, 'portrait');

  // ── Étape 4 : Watermarking du PDF ────────────────────────────
  onLog('🔐 Application du watermark GhostMark...', 'info');

  return await window.GhostMarkPDFHandler.watermarkPDF(
    pdfBytes.buffer,
    creatorId,
    35,
    onLog
  );
}

// ─── HANDLER EXCEL (.xlsx) ───────────────────────────────────

/**
 * Convertit un fichier Excel (.xlsx) en PDF watermarqué.
 *
 * PIPELINE :
 *   .xlsx → ArrayBuffer
 *         → SheetJS → Tableau HTML (première feuille)
 *         → jsPDF → PDF paysage
 *         → pdf-handler.js → PDF watermarqué
 *
 * @param {File}     file      - Fichier .xlsx
 * @param {string}   creatorId - Identifiant de l'institution
 * @param {Function} [onLog]   - Callback de logging
 * @returns {Promise<{ pdfBytes: Uint8Array, payload: string, hash: string }>}
 */
async function watermarkExcel(file, creatorId, onLog = () => {}) {
  onLog('📊 Lecture du fichier Excel...', 'info');

  // ── Étape 1 : Lecture du fichier en ArrayBuffer ─────────────
  const arrayBuffer = await file.arrayBuffer();

  // ── Étape 2 : Parsing XLSX → workbook via SheetJS ───────────
  // XLSX.read() parse le fichier binaire Excel et retourne
  // un objet workbook contenant toutes les feuilles
  onLog('🔄 Parsing Excel (SheetJS)...', 'info');

  let workbook;
  try {
    workbook = XLSX.read(arrayBuffer, { type: 'array' });
  } catch (e) {
    throw new Error(`SheetJS: impossible de lire le fichier Excel — ${e.message}`);
  }

  // Traitement de la première feuille uniquement
  // En V2 : traiter toutes les feuilles en pages PDF séparées
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Le fichier Excel ne contient aucune feuille');
  }

  onLog(`📋 Feuille traitée : "${sheetName}"`, 'info');
  const worksheet = workbook.Sheets[sheetName];

  // Conversion de la feuille en tableau HTML
  // sheet_to_html() génère un <table> HTML avec les données
  const htmlTable = XLSX.utils.sheet_to_html(worksheet, {
    id: 'ghostmark-excel-table' // ID pour le styling CSS
  });

  // Ajout du CSS pour un rendu propre du tableau
  const styledHtml = `
    <style>
      table { border-collapse: collapse; width: 100%; font-size: 10px; }
      th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
      th { background-color: #1e3a5f; color: white; font-weight: bold; }
      tr:nth-child(even) { background-color: #f5f5f5; }
    </style>
    <h3 style="font-family:Arial;color:#1e3a5f;">${sheetName}</h3>
    ${htmlTable}
  `;

  // ── Étape 3 : HTML → PDF paysage via jsPDF ───────────────────
  // Paysage car les tableaux Excel sont souvent larges
  onLog('🔄 Conversion tableau → PDF (jsPDF)...', 'info');

  const pdfBytes = await htmlToPDFBytes(styledHtml, 'landscape');

  // ── Étape 4 : Watermarking du PDF ────────────────────────────
  onLog('🔐 Application du watermark GhostMark...', 'info');

  return await window.GhostMarkPDFHandler.watermarkPDF(
    pdfBytes.buffer,
    creatorId,
    35,
    onLog
  );
}

// ─── UTILITAIRE : HTML → PDF (jsPDF) ─────────────────────────

/**
 * Convertit du HTML en PDF via jsPDF et retourne les bytes.
 *
 * jsPDF.html() utilise html2canvas en interne pour rasteriser
 * le HTML en image, puis insère cette image dans le PDF.
 *
 * @param {string} htmlContent  - Contenu HTML à convertir
 * @param {'portrait'|'landscape'} orientation - Orientation du PDF
 * @returns {Promise<Uint8Array>} Bytes du PDF généré
 */
async function htmlToPDFBytes(htmlContent, orientation = 'portrait') {
  return new Promise((resolve, reject) => {
    // Création d'un conteneur temporaire pour le HTML
    // (nécessaire pour que jsPDF puisse le mesurer)
    const container = document.createElement('div');
    container.style.cssText = `
      position: absolute;
      left: -9999px;
      top: 0;
      width: ${orientation === 'landscape' ? '297mm' : '210mm'};
      padding: 15mm;
      font-family: Arial, sans-serif;
      font-size: 11px;
      background: white;
    `;
    container.innerHTML = htmlContent;
    document.body.appendChild(container);

    // Création du document jsPDF
    const doc = new jsPDF({
      orientation,
      unit:   'mm',
      format: 'a4'
    });

    // Conversion HTML → PDF
    doc.html(container, {
      callback: (pdf) => {
        document.body.removeChild(container);
        // Retourne les bytes du PDF
        const bytes = pdf.output('arraybuffer');
        resolve(new Uint8Array(bytes));
      },
      margin:   [15, 15, 15, 15], // marges en mm
      autoPaging: 'text',
      x: 0,
      y: 0,
      width:      orientation === 'landscape' ? 267 : 180, // largeur en mm
      windowWidth: orientation === 'landscape' ? 1122 : 794 // largeur écran équivalente
    });
  });
}

/**
 * Détecte le type de fichier soumis et appelle le handler approprié.
 *
 * @param {File}     file      - Fichier soumis par l'utilisateur
 * @param {string}   creatorId - Identifiant de l'institution
 * @param {Function} [onLog]   - Callback de logging
 * @returns {Promise<Object>} Résultat du watermarking
 */
async function watermarkDocument(file, creatorId, onLog = () => {}) {
  const ext = file.name.split('.').pop().toLowerCase();

  switch (ext) {
    case 'docx':
    case 'doc':
      return await watermarkWord(file, creatorId, onLog);

    case 'xlsx':
    case 'xls':
    case 'csv':
      return await watermarkExcel(file, creatorId, onLog);

    case 'pdf':
      const pdfBuffer = await file.arrayBuffer();
      return await window.GhostMarkPDFHandler.watermarkPDF(
        pdfBuffer, creatorId, 35, onLog
      );

    default:
      throw new Error(`Format non supporté : .${ext}. Formats acceptés : PDF, DOCX, XLSX`);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { watermarkWord, watermarkExcel, watermarkDocument, htmlToPDFBytes };
} else {
  window.GhostMarkDocHandler = { watermarkWord, watermarkExcel, watermarkDocument, htmlToPDFBytes };
}
