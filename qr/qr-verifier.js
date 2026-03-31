/**
 * ============================================================
 * GhostMark — qr/qr-verifier.js
 * Page de vérification via QR code
 * ============================================================
 *
 * Cette page est celle qui s'ouvre quand quelqu'un scanne
 * le QR code imprimé sur un document GhostMark.
 *
 * URL reçue :
 *   https://ghostmark.github.io/verify?h=A3F9C2E1&id=MIN-INTERIEUR&ts=1711234567890&v=1
 *
 * PROCESSUS DE VÉRIFICATION EN 3 ÉTAPES :
 * ─────────────────────────────────────────
 *
 * ÉTAPE 1 — Lecture des paramètres URL
 *   Le hash attendu, le creatorId et le timestamp sont lus
 *   depuis les paramètres de l'URL du QR code.
 *
 * ÉTAPE 2 — Soumission du document par l'utilisateur
 *   L'utilisateur soumet le document qu'il veut vérifier.
 *   → Image : extraction DCT du watermark
 *   → PDF   : lecture des métadonnées XMP
 *
 * ÉTAPE 3 — Comparaison et résultat
 *   Le hash extrait du document est comparé au hash de l'URL.
 *   Si identiques → ✅ AUTHENTIQUE
 *   Si différents → ❌ NON CERTIFIÉ
 *
 * SÉCURITÉ DE LA VÉRIFICATION :
 * ───────────────────────────────
 * On ne peut PAS tromper le système avec juste le QR code :
 *   - Le QR code contient uniquement le hash (8 chars hex)
 *   - Pour réussir la vérification, il faut le document réel
 *     dont le watermark produit exactement ce hash
 *   - Un faux document produira un hash différent → ❌
 * ============================================================
 */

'use strict';

/**
 * Classe principale de vérification via QR code.
 * Orchestre les 3 étapes du processus de vérification.
 */
class GhostMarkVerifier {

  constructor() {
    // Paramètres extraits du QR code (URL)
    this.expectedHash   = null;
    this.expectedId     = null;
    this.expectedTs     = null;
    this.protocolVersion = null;
  }

  // ─── ÉTAPE 1 : Lecture des paramètres URL ──────────────────

  /**
   * Lit et valide les paramètres du QR code depuis l'URL.
   *
   * @returns {{ valid: boolean, error?: string,
   *             hash?: string, creatorId?: string,
   *             date?: string }}
   */
  readURLParams() {
    const params = new URLSearchParams(window.location.search);

    const h  = params.get('h');   // hash attendu
    const id = params.get('id');  // creatorId attendu
    const ts = params.get('ts');  // timestamp attendu
    const v  = params.get('v');   // version protocole

    // Validation des paramètres requis
    if (!h || !id || !ts) {
      return {
        valid: false,
        error: 'QR code invalide : paramètres manquants. Ce document n\'utilise peut-être pas GhostMark.'
      };
    }

    // Validation du format du hash (8 chars hexadécimaux)
    if (!/^[0-9A-F]{8}$/i.test(h)) {
      return {
        valid: false,
        error: `Hash malformé : "${h}" n\'est pas un hash GhostMark valide.`
      };
    }

    const timestamp = parseInt(ts, 10);
    if (isNaN(timestamp) || timestamp <= 0) {
      return { valid: false, error: 'Horodatage invalide dans le QR code.' };
    }

    // Stockage pour les étapes suivantes
    this.expectedHash    = h.toUpperCase();
    this.expectedId      = id;
    this.expectedTs      = timestamp;
    this.protocolVersion = v || '1';

    // Formatage de la date pour l'affichage
    const date = new Date(timestamp).toLocaleString('fr-FR', {
      day:    '2-digit',
      month:  '2-digit',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit'
    });

    return {
      valid:     true,
      hash:      this.expectedHash,
      creatorId: this.expectedId,
      timestamp: this.expectedTs,
      date
    };
  }

  // ─── ÉTAPE 2 : Vérification du document soumis ─────────────

  /**
   * Vérifie le document soumis par l'utilisateur.
   *
   * Détecte automatiquement le format et applique la méthode
   * d'extraction appropriée.
   *
   * @param {File}     file   - Document soumis par l'utilisateur
   * @param {Array}    [zones] - Zones pour l'extraction DCT (images)
   * @param {Function} [onLog] - Callback de logging
   * @returns {Promise<{
   *   authentic: boolean,
   *   extractedHash?: string,
   *   creatorId?: string,
   *   date?: string,
   *   method?: string,
   *   error?: string
   * }>}
   */
  async verifyDocument(file, zones = null, onLog = () => {}) {
    if (!this.expectedHash) {
      return { authentic: false, error: 'Paramètres URL non initialisés. Scannez à nouveau le QR code.' };
    }

    const ext = file.name.split('.').pop().toLowerCase();
    onLog(`🔍 Vérification du document (format: .${ext})...`, 'info');

    let extractionResult;

    try {
      if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) {
        // ── Vérification image : extraction DCT ───────────────
        extractionResult = await this._verifyImage(file, zones, onLog);

      } else if (ext === 'pdf') {
        // ── Vérification PDF : lecture métadonnées XMP ─────────
        extractionResult = await this._verifyPDF(file, onLog);

      } else {
        return {
          authentic: false,
          error: `Format .${ext} non supporté pour la vérification. Soumettez l'image ou le PDF du document.`
        };
      }
    } catch (e) {
      return { authentic: false, error: `Erreur d'extraction : ${e.message}` };
    }

    if (!extractionResult.found) {
      return { authentic: false, error: extractionResult.error };
    }

    // ── ÉTAPE 3 : Comparaison des hashes ──────────────────────
    return this._compareHashes(extractionResult, onLog);
  }

  /**
   * Vérifie une image en extrayant le watermark DCT.
   * @private
   */
  async _verifyImage(file, zones, onLog) {
    onLog('📐 Extraction du watermark DCT...', 'info');

    const handler = window.GhostMarkImageHandler;
    const WM      = window.GhostMarkWatermark;
    const ZA      = window.GhostMarkZoneAnalyzer;

    // Chargement de l'image dans un canvas
    const { imageData, width, height, base64 } = await handler.loadImageToCanvas(file);

    // Sélection des zones d'extraction
    let extractZones = zones;
    if (!extractZones || extractZones.length === 0) {
      // Si pas de zones fournies, utiliser le fallback statistique
      onLog('⚠ Zones IA non disponibles → fallback statistique', 'warn');
      extractZones = ZA.analyzeZonesFallback(imageData.data, width, height);
    }

    // Extraction du watermark
    return WM.extractWatermark(imageData.data, width, height, extractZones);
  }

  /**
   * Vérifie un PDF en lisant ses métadonnées XMP.
   * @private
   */
  async _verifyPDF(file, onLog) {
    onLog('📄 Lecture des métadonnées PDF...', 'info');

    const arrayBuffer = await file.arrayBuffer();
    return await window.GhostMarkPDFHandler.verifyPDFWatermark(arrayBuffer);
  }

  /**
   * Compare le hash extrait avec le hash attendu du QR code.
   * @private
   */
  _compareHashes(extractionResult, onLog) {
    const extractedHash = extractionResult.hash?.toUpperCase();

    onLog(`🔐 Hash extrait   : ${extractedHash}`, 'info');
    onLog(`🔐 Hash attendu   : ${this.expectedHash}`, 'info');

    if (extractedHash !== this.expectedHash) {
      onLog('❌ Les hashes ne correspondent pas', 'error');
      return {
        authentic:     false,
        extractedHash,
        expectedHash:  this.expectedHash,
        error: `Hashes différents — ce document ne correspond pas au QR code scanné, ou il a été altéré.`
      };
    }

    // Vérification additionnelle : le creatorId correspond-il ?
    if (extractionResult.creatorId &&
        extractionResult.creatorId !== this.expectedId) {
      onLog('⚠ CreatorID différent de celui du QR code', 'warn');
    }

    onLog('✅ Hashes identiques — document authentique !', 'info');

    return {
      authentic:     true,
      extractedHash,
      creatorId:     extractionResult.creatorId || this.expectedId,
      date:          extractionResult.date,
      timestamp:     extractionResult.timestamp || this.expectedTs,
      method:        extractionResult.method    || 'dct',
      confidence:    extractionResult.confidence || 100
    };
  }
}

// ─── INITIALISATION ──────────────────────────────────────────

// Instance globale du vérificateur
const ghostMarkVerifier = new GhostMarkVerifier();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GhostMarkVerifier };
} else {
  window.GhostMarkVerifier  = GhostMarkVerifier;
  window.ghostMarkVerifier  = ghostMarkVerifier;
}
