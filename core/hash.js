/**
 * ============================================================
 * GhostMark — core/hash.js
 * Gestion du payload et de l'empreinte cryptographique
 * ============================================================
 *
 * Ce module gère deux responsabilités :
 *
 * 1. CONSTRUCTION DU PAYLOAD
 *    Le payload est la donnée qu'on va cacher dans le watermark.
 *    Structure : "WM:[CreatorID]|[Timestamp]|H:[Hash]"
 *    Exemple   : "WM:MIN-INTERIEUR|1711234567890|H:A3F9C2E1"
 *
 * 2. HASH D'INTÉGRITÉ (FNV-1a 32 bits)
 *    Le hash permet de vérifier que le payload extrait n'a pas
 *    été corrompu lors de l'impression, compression, etc.
 *    Si le hash recalculé ≠ hash stocké → document altéré.
 *
 * POURQUOI FNV-1a ET PAS SHA-256 ?
 * ----------------------------------
 * FNV-1a est un algorithme non cryptographique mais très rapide,
 * implémentable en quelques lignes sans librairie externe.
 * Dans notre contexte, on n'a pas besoin de résistance aux
 * attaques intentionnelles (c'est le watermark DCT qui protège),
 * juste d'une vérification d'intégrité basique.
 *
 * En V2 production : remplacer par SHA-256 via Web Crypto API.
 * ============================================================
 */

'use strict';

// ─── CONSTANTES ──────────────────────────────────────────────

/** Préfixe identifiant un watermark GhostMark valide */
const WM_PREFIX = 'WM:';

/** Séparateur de champs dans le payload */
const SEPARATOR = '|';

/** Préfixe du champ hash dans le payload */
const HASH_PREFIX = 'H:';

// ─── ALGORITHME FNV-1a 32 bits ───────────────────────────────

/**
 * Calcule le hash FNV-1a 32 bits d'une chaîne de caractères.
 *
 * ALGORITHME FNV-1a :
 *   hash = offset_basis (valeur initiale fixe)
 *   Pour chaque octet de la chaîne :
 *     hash = hash XOR octet    (XOR avec l'octet courant)
 *     hash = hash × FNV_prime  (multiplication FNV)
 *
 * CONSTANTES MAGIQUES FNV-1a 32 bits (standards, non modifiables) :
 *   offset_basis = 2166136261 (0x811c9dc5)
 *   FNV_prime    = 16777619   (0x01000193)
 *
 * Le opérateur >>> 0 force le résultat en entier non signé 32 bits,
 * évitant les débordements JavaScript.
 *
 * @param {string} str - Chaîne à hacher
 * @returns {string} Hash en hexadécimal majuscule, 8 caractères
 *
 * @example
 * fnv1a('MIN-INTERIEUR|1711234567890') // → "A3F9C2E1"
 */
function fnv1a(str) {
  let hash = 0x811c9dc5; // offset_basis FNV-1a 32 bits

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i); // XOR avec le code ASCII du caractère
    hash = (hash * 0x01000193) >>> 0; // multiplication FNV + masque 32 bits
  }

  // Conversion en hexadécimal, majuscule, complété à 8 chars
  return hash.toString(16).toUpperCase().padStart(8, '0');
}

// ─── CONSTRUCTION DU PAYLOAD ─────────────────────────────────

/**
 * Construit le payload complet à insérer dans le watermark.
 *
 * STRUCTURE DU PAYLOAD :
 *   "WM:[creatorId]|[timestamp]|H:[hash]"
 *
 *   - WM:         → préfixe d'identification GhostMark
 *   - creatorId   → identifiant de l'institution émettrice
 *   - timestamp   → horodatage Unix en millisecondes
 *   - H:[hash]    → empreinte FNV-1a du couple (creatorId|timestamp)
 *
 * Le hash couvre creatorId ET timestamp ensemble pour garantir
 * qu'on ne peut pas modifier l'un sans invalider l'autre.
 *
 * @param {string} creatorId - Identifiant de l'institution
 *   (ex: "MIN-INTERIEUR", "UNIV-DAKAR", "SMSI-GOV-2026")
 * @param {number} [timestamp] - Horodatage Unix ms (défaut: maintenant)
 * @returns {{ payload: string, creatorId: string,
 *             timestamp: number, hash: string }}
 *
 * @example
 * buildPayload('MIN-INTERIEUR')
 * // → {
 * //     payload: "WM:MIN-INTERIEUR|1711234567890|H:A3F9C2E1",
 * //     creatorId: "MIN-INTERIEUR",
 * //     timestamp: 1711234567890,
 * //     hash: "A3F9C2E1"
 * //   }
 */
function buildPayload(creatorId, timestamp = Date.now()) {
  // Nettoyage du creatorId (suppression du préfixe WM: si déjà présent)
  const cleanId = creatorId.replace(WM_PREFIX, '').trim();

  // Données à hacher : creatorId + timestamp
  const dataToHash = `${cleanId}${SEPARATOR}${timestamp}`;

  // Calcul de l'empreinte
  const hash = fnv1a(dataToHash);

  // Construction du payload final
  const payload = `${WM_PREFIX}${cleanId}${SEPARATOR}${timestamp}${SEPARATOR}${HASH_PREFIX}${hash}`;

  return { payload, creatorId: cleanId, timestamp, hash };
}

// ─── PARSING DU PAYLOAD ──────────────────────────────────────

/**
 * Parse et valide un payload extrait du watermark.
 *
 * ÉTAPES DE VALIDATION :
 *   1. Vérifier que le payload commence par "WM:"
 *   2. Extraire les 3 champs (creatorId, timestamp, hash)
 *   3. Recalculer le hash depuis creatorId + timestamp
 *   4. Comparer avec le hash stocké
 *   5. Si identiques → payload valide, document authentique
 *
 * @param {string} payload - Payload brut extrait du watermark
 * @returns {{ valid: boolean, creatorId?: string,
 *             timestamp?: number, date?: string,
 *             hash?: string, error?: string }}
 *
 * @example
 * parsePayload('WM:MIN-INTERIEUR|1711234567890|H:A3F9C2E1')
 * // → { valid: true, creatorId: 'MIN-INTERIEUR',
 * //     timestamp: 1711234567890,
 * //     date: '30/03/2026 à 10:00:00',
 * //     hash: 'A3F9C2E1' }
 *
 * parsePayload('WM:MIN-INTERIEUR|1711234567890|H:FFFFFFFF')
 * // → { valid: false, error: 'Hash invalide — document altéré' }
 */
function parsePayload(payload) {
  // Étape 1 : vérification du préfixe GhostMark
  if (!payload || !payload.startsWith(WM_PREFIX)) {
    return { valid: false, error: 'Préfixe WM: absent — pas un watermark GhostMark' };
  }

  // Étape 2 : extraction des champs
  // Format attendu : "WM:CREATOR|TIMESTAMP|H:HASH"
  const withoutPrefix = payload.replace(WM_PREFIX, '');
  const parts = withoutPrefix.split(SEPARATOR);

  if (parts.length < 3) {
    return { valid: false, error: 'Structure du payload invalide' };
  }

  const creatorId  = parts[0];
  const timestamp  = parseInt(parts[1], 10);
  const hashField  = parts[2]; // "H:A3F9C2E1"

  // Vérification du format du champ hash
  if (!hashField.startsWith(HASH_PREFIX)) {
    return { valid: false, error: 'Champ hash manquant ou malformé' };
  }

  const storedHash = hashField.replace(HASH_PREFIX, '');

  // Vérification que le timestamp est un nombre valide
  if (isNaN(timestamp) || timestamp <= 0) {
    return { valid: false, error: 'Horodatage invalide' };
  }

  // Étape 3 : recalcul du hash
  const dataToHash       = `${creatorId}${SEPARATOR}${timestamp}`;
  const recomputedHash   = fnv1a(dataToHash);

  // Étape 4 : comparaison des hashes
  if (recomputedHash !== storedHash) {
    return {
      valid: false,
      error: `Hash invalide — document potentiellement altéré (attendu: ${recomputedHash}, trouvé: ${storedHash})`
    };
  }

  // Étape 5 : formatage de la date pour affichage
  const date = new Date(timestamp).toLocaleString('fr-FR', {
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  return { valid: true, creatorId, timestamp, date, hash: storedHash };
}

// ─── ENCODAGE BINAIRE ────────────────────────────────────────

/**
 * Convertit une chaîne de caractères en tableau de bits (0 et 1).
 * Chaque caractère ASCII est encodé sur 8 bits (big-endian).
 *
 * C'est ce tableau de bits qui sera inséré dans les coefficients
 * DCT du document — un bit par coefficient de fréquence moyenne.
 *
 * @param {string} str - Chaîne à encoder
 * @returns {number[]} Tableau de bits (0 ou 1)
 *
 * @example
 * strToBits('A')
 * // 'A' = ASCII 65 = 0b01000001
 * // → [0, 1, 0, 0, 0, 0, 0, 1]
 */
function strToBits(str) {
  const bits = [];

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i); // code ASCII du caractère

    // Extraction des 8 bits, du plus significatif au moins significatif
    for (let b = 7; b >= 0; b--) {
      bits.push((code >> b) & 1); // décalage et masque pour isoler le bit
    }
  }

  return bits;
}

/**
 * Convertit un tableau de bits en chaîne de caractères ASCII.
 * Opération inverse de strToBits().
 *
 * S'arrête au premier caractère null (code ASCII 0) pour éviter
 * de lire du bruit après la fin du payload.
 *
 * @param {number[]} bits - Tableau de bits (0 ou 1)
 * @returns {string} Chaîne reconstruite
 *
 * @example
 * bitsToStr([0, 1, 0, 0, 0, 0, 0, 1]) // → 'A'
 */
function bitsToStr(bits) {
  let str = '';

  // Traitement par groupes de 8 bits
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let code = 0;

    // Reconstruction du code ASCII depuis les 8 bits
    for (let b = 0; b < 8; b++) {
      code = (code << 1) | bits[i + b]; // décalage gauche + ajout du bit
    }

    // Arrêt au caractère null (marqueur de fin de payload)
    if (code === 0) break;

    str += String.fromCharCode(code);
  }

  return str;
}

// ─── EXPORTS ─────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fnv1a,
    buildPayload,
    parsePayload,
    strToBits,
    bitsToStr,
    WM_PREFIX,
    SEPARATOR,
    HASH_PREFIX
  };
} else {
  window.GhostMarkHash = {
    fnv1a,
    buildPayload,
    parsePayload,
    strToBits,
    bitsToStr,
    WM_PREFIX,
    SEPARATOR,
    HASH_PREFIX
  };
}
