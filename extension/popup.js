/**
 * ============================================================
 * GhostMark — extension/popup.js
 * Logique de l'extension navigateur Chrome/Firefox
 * ============================================================
 *
 * L'extension permet de vérifier un document GhostMark
 * directement depuis la barre d'outils du navigateur,
 * sans ouvrir de site web externe.
 *
 * AVANTAGE POUR LES AGENTS PROFESSIONNELS :
 *   - Toujours accessible en 1 clic
 *   - Pas besoin de naviguer vers le site GhostMark
 *   - Interface minimaliste adaptée au workflow
 * ============================================================
 */

'use strict';

let currentFile      = null;
let currentImageData = null;
let currentZones     = null;

/**
 * Journalise un message dans la zone de log de l'extension.
 */
function log(msg) {
  const box = document.getElementById('logBox');
  const now  = new Date();
  const time = `${String(now.getSeconds()).padStart(2,'0')}s`;
  box.innerHTML += `<div>[${time}] ${msg}</div>`;
  box.scrollTop = box.scrollHeight;
}

/**
 * Gère le fichier sélectionné par l'utilisateur.
 */
async function handleFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Reset de l'UI
  document.getElementById('resultOk').style.display   = 'none';
  document.getElementById('resultFail').style.display  = 'none';
  document.getElementById('logBox').innerHTML = '';

  currentFile = file;

  log(`📂 Fichier chargé : ${file.name}`);
  log(`📏 Taille : ${(file.size / 1024).toFixed(1)} Ko`);

  const ext = file.name.split('.').pop().toLowerCase();

  // Pour les images : préchargement + analyse zones (fallback)
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    try {
      const result = await loadImageForExtension(file);
      currentImageData = result.imageData;
      // Analyse des zones par fallback statistique
      // (pas d'appel API Claude Vision dans l'extension pour rapidité)
      currentZones = window.GhostMarkZoneAnalyzer.analyzeZonesFallback(
        result.imageData.data,
        result.width,
        result.height
      );
      const robustCount = currentZones.filter(z => z.robust).length;
      log(`📊 ${robustCount} zones robustes détectées`);
    } catch (e) {
      log(`⚠ Erreur chargement image : ${e.message}`);
    }
  }

  document.getElementById('verifyBtn').disabled = false;
}

/**
 * Lance la vérification du document chargé.
 */
async function verifyDoc() {
  if (!currentFile) return;

  document.getElementById('verifyBtn').disabled = true;
  document.getElementById('resultOk').style.display   = 'none';
  document.getElementById('resultFail').style.display  = 'none';

  log('🔍 Vérification en cours...');

  const ext = currentFile.name.split('.').pop().toLowerCase();

  try {
    let result;

    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      // Extraction DCT watermark
      result = window.GhostMarkWatermark.extractWatermark(
        currentImageData.data,
        currentImageData.width,
        currentImageData.height,
        currentZones
      );
    } else if (ext === 'pdf') {
      // Lecture métadonnées XMP
      const buffer = await currentFile.arrayBuffer();
      result = await window.GhostMarkPDFHandler.verifyPDFWatermark(buffer);
    } else {
      showFail('Format non supporté par l\'extension.');
      return;
    }

    if (result.found) {
      log(`✅ Watermark extrait — ${result.creatorId}`);
      showSuccess(result);
    } else {
      log(`❌ ${result.error}`);
      showFail(result.error);
    }

  } catch (e) {
    log(`⚠ Erreur : ${e.message}`);
    showFail(e.message);
  }

  document.getElementById('verifyBtn').disabled = false;
}

function showSuccess(result) {
  document.getElementById('rCreator').textContent = result.creatorId || '—';
  document.getElementById('rDate').textContent    = result.date      || '—';
  document.getElementById('rHash').textContent    = result.hash      || '—';
  document.getElementById('resultOk').style.display = 'block';
}

function showFail(error) {
  document.getElementById('rError').textContent         = error;
  document.getElementById('resultFail').style.display   = 'block';
}

/**
 * Charge une image depuis un File et retourne ImageData.
 */
async function loadImageForExtension(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const max    = 600;
        let w = img.width, h = img.height;
        if (w > max || h > max) {
          if (w > h) { h = Math.round(h * max / w); w = max; }
          else       { w = Math.round(w * max / h); h = max; }
        }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ imageData: ctx.getImageData(0,0,w,h), width: w, height: h });
      };
      img.onerror = () => reject(new Error('Image invalide'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Lecture impossible'));
    reader.readAsDataURL(file);
  });
}
