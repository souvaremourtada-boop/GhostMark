# GhostMark — Adaptive AI Watermarking

> **Un document, une identité. Invisible mais indestructible.**

[![iSAFE Hackathon 2026](https://img.shields.io/badge/iSAFE-Hackathon%202026-blue)](https://cyberchallenge.net)
[![Track](https://img.shields.io/badge/Track-01%20Detect%20the%20Deceptive-red)](https://cyberchallenge.net)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![AI Powered](https://img.shields.io/badge/AI-Claude%20Vision-purple)](https://anthropic.com)

---

## Présentation

**GhostMark** est un système de protection et d'authentification des documents administratifs numériques combinant **intelligence artificielle** et **watermarking invisible par transformée DCT**.

Il permet à n'importe quelle institution (université, administration, banque) de certifier ses documents numériques avec une signature invisible, robuste et vérifiable par tous — gratuitement, sans infrastructure centralisée.

---

## Problème Adressé

- Les faux diplômes, attestations et documents officiels sont produits facilement avec des éditeurs d'images standards
- Les solutions existantes (Digimarc, Imatag) coûtent des milliers de dollars et réservent la vérification aux abonnés
- Dans les pays en développement, les administrations n'ont pas les moyens de déployer ces infrastructures

**GhostMark résout les trois problèmes à la fois.**

---

## Architecture du Projet

```
ghostmark/
├── core/
│   ├── dct.js              # Transformée DCT 8×8 + IDCT (algo principal)
│   ├── watermark.js        # Insertion + extraction watermark (QIM)
│   ├── hash.js             # Payload FNV-1a + encodage binaire
│   └── zone-analyzer.js    # Analyse statistique des zones (fallback)
│
├── ai/
│   └── claude-vision.js    # Analyse sémantique par Claude Vision API
│
├── formats/
│   ├── image-handler.js    # PNG/JPG → DCT watermark
│   ├── pdf-handler.js      # PDF → métadonnées XMP + annotation
│   └── word-excel-handler.js # DOCX/XLSX → PDF → watermark
│
├── qr/
│   ├── qr-generator.js     # Génération QR code sur le document
│   └── qr-verifier.js      # Page de vérification via QR
│
├── poc/
│   └── index.html          # Interface web complète (PoC démontrable)
│
└── extension/
    ├── manifest.json       # Extension Chrome/Firefox (Manifest V3)
    ├── popup.html          # Interface de l'extension
    └── popup.js            # Logique de vérification
```

---

## Pipeline Technique

```
┌─────────────────────────────────────────────────────────┐
│                    ÉMISSION (Institution)                │
│                                                         │
│  Document (Image/PDF/Word/Excel)                        │
│         │                                               │
│         ▼                                               │
│  ① Claude Vision API                                    │
│     → Analyse sémantique du document                    │
│     → Détection zones : texte, logo, marge, signature   │
│     → Sélection des zones robustes (invisible + résist.)│
│         │                                               │
│         ▼                                               │
│  ② DCT Watermarking (images) OU PDF-lib (PDF/Word/Excel)│
│     → Payload = CreatorID | Timestamp | Hash FNV-1a     │
│     → Encodage binaire du payload                       │
│     → Insertion QIM dans fréquences moyennes DCT        │
│     → Perturbation < 3/255 → PSNR > 40 dB              │
│         │                                               │
│         ▼                                               │
│  ③ QR Code de vérification                             │
│     → URL = ghostmark.io/verify?h=HASH&id=CREATOR       │
│     → Imprimé/intégré sur le document certifié          │
│         │                                               │
│         ▼                                               │
│  Document certifié + QR code → Distribution            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                 VÉRIFICATION (N'importe qui)             │
│                                                         │
│  Scan QR code → Page de vérification                    │
│         │                                               │
│         ▼                                               │
│  Soumission du document à vérifier                      │
│         │                                               │
│         ├── Image → Extraction DCT → Hash               │
│         └── PDF   → Lecture métadonnées XMP → Hash      │
│         │                                               │
│         ▼                                               │
│  Comparaison hash extrait vs hash QR code               │
│         │                                               │
│         ├── ✅ Identiques → Document AUTHENTIQUE        │
│         └── ❌ Différents → Document NON CERTIFIÉ       │
└─────────────────────────────────────────────────────────┘
```

---

## Algorithme DCT — Explication

La **Transformée en Cosinus Discrète (DCT)** est l'algorithme mathématique au cœur du watermarking GhostMark.

### Pourquoi la DCT ?

Une image peut être vue comme une superposition de motifs fréquentiels :
- **Basses fréquences** → structures globales, couleurs de fond
- **Fréquences moyennes** → détails, contours → **CIBLE DU WATERMARK**
- **Hautes fréquences** → bruit, grain fin

Les fréquences moyennes sont le point d'équilibre parfait :
- Imperceptibles visuellement (contrairement aux basses fréquences)
- Résistantes à la compression JPEG (contrairement aux hautes fréquences)

### Technique QIM

La **Quantization Index Modulation** insère chaque bit du payload :

```
Pour chaque bit b ∈ {0,1} :
  coefficients[fi] = round(coeff / q) × q + (b ? +q/4 : -q/4)

Extraction :
  rem = coeff % q
  bit = (rem > q/2) ? 1 : 0
```

---

## Formats Supportés

| Format | Méthode watermarking | Survit impression+scan |
|--------|---------------------|----------------------|
| PNG/JPG | DCT fréquentiel | ✅ Oui |
| PDF | Métadonnées XMP + annotation | ⚠ Partiellement |
| Word (.docx) | → Converti en PDF → XMP | ⚠ Partiellement |
| Excel (.xlsx) | → Converti en PDF → XMP | ⚠ Partiellement |

---

## Étude Concurrentielle

| Critère | Digimarc | Adobe C2PA | Imatag | **GhostMark** |
|---------|----------|------------|--------|---------------|
| Open source | ✗ | ✗ | ✗ | **✓** |
| Documents admin | ~ | ✗ | ~ | **✓** |
| IA adaptative zones | ✗ | ✗ | ✗ | **✓** |
| Vérification gratuite | ✗ | ✗ | ✗ | **✓** |
| Déployable sans serveur | ✗ | ✗ | ✗ | **✓** |
| QR code vérification | ✗ | ✗ | ✗ | **✓** |
| Pays en développement | ✗ | ✗ | ✗ | **✓** |

---

## Installation et Utilisation

### PoC Web (démo instantanée)

```bash
git clone https://github.com/[USERNAME]/ghostmark.git
cd ghostmark/poc
# Ouvrir index.html dans un navigateur
# Aucune installation requise
```


### Utilisation des modules core (Node.js)

```javascript
const { buildPayload, parsePayload } = require('./core/hash');
const { embedWatermark, extractWatermark } = require('./core/watermark');
const { analyzeZonesFallback } = require('./core/zone-analyzer');

// Construction du payload
const { payload, hash } = buildPayload('MIN-INTERIEUR');
// → "WM:MIN-INTERIEUR|1711234567890|H:A3F9C2E1"

// Validation d'un payload extrait
const result = parsePayload(payload);
// → { valid: true, creatorId: 'MIN-INTERIEUR', date: '30/03/2026...', hash: 'A3F9C2E1' }
```

---

## Librairies Utilisées

| Librairie | Usage | CDN |
|-----------|-------|-----|
| Anthropic API | Claude Vision — analyse zones | api.anthropic.com |
| PDF-lib.js | Watermarking PDF natif | cdn.jsdelivr.net |
| Mammoth.js | Conversion Word → HTML | cdn.jsdelivr.net |
| SheetJS | Lecture Excel | cdn.sheetjs.com |
| jsPDF | Génération PDF | cdn.jsdelivr.net |
| QRCode.js | Génération QR codes | cdn.jsdelivr.net |

---


## Licence

MIT License — Libre d'utilisation, modification et distrib

*GhostMark — iSAFE Hackathon 2026 — WSIS Forum — AI for Good*
