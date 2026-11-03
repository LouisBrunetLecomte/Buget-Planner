# Buget

Application de budget personnel **local-first** et **100 % gratuite**. Tes données restent sur ton appareil, chiffrées avec ton mot de passe : pas de serveur, pas de compte, pas de télémétrie.

## App Mac (comme Quansi+)

```bash
npm install
./macos/Scripts/install.sh     # fabrique et installe /Applications/Buget.app
```

Buget s'ouvre ensuite comme n'importe quelle app (Launchpad, Spotlight, Dock). C'est une fenêtre native (Swift + WebKit) qui affiche l'app web embarquée, servie uniquement sur `127.0.0.1:47219`.
- **Données** : elles sont chiffrées dans le stockage WebKit propre à l'app (`~/Library/WebKit/local.louloubl.Buget`) et sont conservées quand tu réinstalles une nouvelle version.
- **Téléchargements** (sauvegardes, PDF, CSV) : ils arrivent dans `~/Téléchargements`.
- **Touch ID** : après la création de la base ou un premier déverrouillage au mot de passe, ton empreinte suffit pour ouvrir Buget. Le mot de passe reste utilisable en secours (« Utiliser le mot de passe »). L'option se règle dans Réglages → Touch ID.
- **Prérequis** : macOS 26 et les outils de ligne de commande Xcode (`xcode-select --install`).

## Installer et lancer (navigateur)

Prérequis : Node.js 20 ou plus.

```bash
npm install        # copie aussi les fichiers de l'OCR dans public/ocr
npm run dev        # http://localhost:5173
```

Au premier lancement, choisis un mot de passe (8 caractères minimum) : la base démarre **vide** et un **tutoriel** te guide (comptes, opérations, budget, charges fixes, sauvegarde). Il peut être revu dans Réglages → Apparence et aide. Pour essayer avec 6 mois de données fictives, ouvre l'app dans le navigateur avec `?demo` dans l'adresse (par exemple `http://localhost:5173/?demo`).

⚠️ **Le mot de passe est irrécupérable.** Télécharge régulièrement une sauvegarde (Réglages → Sauvegarde) ; l'accueil te le rappelle après 30 jours.

| Commande | Rôle |
|---|---|
| `npm test` | Tests unitaires et d'intégration (Vitest) |
| `npm run e2e` | Tests de bout en bout + accessibilité (Playwright, ordinateur et mobile). La première fois : `npx playwright install chromium` |
| `npm run check` | Typage + tests + lint |
| `npm run build` | Version de production dans `dist/` (PWA, politique de sécurité du contenu) |
| `npm run db:generate` | Génère une migration après modification de `src/db/schema.ts` |

## Ce que fait l'app

| Écran | Contenu |
|---|---|
| **Accueil** | Solde total, reste à vivre par jour, budget du mois, taux d'épargne, alertes, prochaines échéances, score de santé financière, faits marquants, premiers pas |
| **Opérations** | Saisie rapide (touche `n`), recherche, filtres, actions en masse, ventilation, tags, notes, pièces jointes avec lecture du ticket (OCR) |
| **Budget** | **De paie à paie** : avec un salaire le 12, le budget va du 12 au 11 du mois suivant (réglable dans Réglages → Mois budgétaire). Lignes par catégorie ou **libellé libre**, valables par défaut « tous les mois à partir de » un mois choisi ; exceptions pour un seul mois ; lignes triées de la plus grosse à la plus petite ; report, base zéro, 50/30/20, vue annuelle, projection |
| **Récurrences** | Charges fixes, abonnements, revenus **à date précise** (« le 28 », « le dernier jour du mois ») ; ils alimentent automatiquement budget, calendrier, reste à vivre et prévisions. Les modifier change tout, « à partir de » un mois choisi. Détection automatique, hausses de prix, prélèvements manquants |
| **Analyses** | Solde et prévision à 3, 6 ou 12 mois, revenus/dépenses, Sankey, répartition, comparaison avec l'année précédente |
| **Patrimoine** | Objectifs d'épargne, règles d'arrondi et de pourcentage, crédits (amortissement, remboursement anticipé, boule de neige / avalanche), patrimoine net, placements |
| **Simulations** | Scénarios « et si » comparés (perte de revenu, crédit, déménagement, achat), calendrier jour par jour sur 60 jours |
| Plus → **Import** | CSV, OFX, QIF, relevés PDF ; mapping mémorisé, doublons ignorés, import annulable |
| Plus → **Rapports** | Rapports PDF mensuel et annuel, exports CSV/JSON, récapitulatif fiscal, activité freelance (TVA, notes de frais, export comptable) |
| Plus → **Assistant** | Questions en langage naturel à un modèle d'IA local (optionnel) |
| Plus → **Réglages** | Alertes, notifications, modules, historique et annulation, mot de passe, sauvegarde, taux de change, suppression des données |

En haut à droite : **annuler** la dernière modification (⌘Z / Ctrl+Z), **masquer les montants** (mode confidentialité), thème, verrouillage.

## Importer un relevé bancaire

1. Dans l'espace client de ta banque, exporte tes opérations en **CSV**, **OFX** ou **QIF**. L'OFX est le plus fiable quand il est proposé. À défaut, le relevé **PDF** fonctionne aussi, au mieux : vérifie l'aperçu.
2. Dans l'app : **Plus → Import**, choisis le compte, puis le fichier.
3. Pour un CSV, vérifie les colonnes devinées. Le réglage est mémorisé pour les prochains fichiers qui ont les mêmes en-têtes.
4. Clique sur **Importer**.

À savoir :
- **Doublons** : réimporter un fichier qui chevauche le précédent ne crée pas de doublons.
- **Saisie manuelle puis import** : une opération saisie à la main puis importée est signalée sur l'accueil.
- **Virements entre tes comptes** : ils sont proposés dans Opérations. Une fois confirmés, ils ne comptent ni en revenu ni en dépense.
- **Encodage** : les fichiers en UTF-8 et en Windows-1252 sont reconnus.
- **Comptes en devise** : crée un compte par devise. La conversion utilise le taux BCE du jour (frankfurter.dev, gratuit) ou un taux manuel.

## Sur ton téléphone

L'app est une **PWA** : elle s'installe comme une application et marche hors ligne.

1. **Héberger le code** gratuitement (tes données n'y vont pas, elles restent sur chaque appareil) :
   - **GitHub Pages** : `npm run build`, puis publie le dossier `dist/` (par exemple avec l'action officielle « Deploy static content to Pages »). Les chemins sont relatifs : un sous-dossier `/budget/` fonctionne.
   - **Cloudflare Pages** : commande de build `npm run build`, dossier de sortie `dist`.
2. Ouvre l'adresse sur ton téléphone :
   - iPhone : Safari → Partager → « Sur l'écran d'accueil » ;
   - Android : Chrome → menu → « Installer l'application ».
3. **Passer tes données d'un appareil à l'autre** : Réglages → **Télécharger une sauvegarde**, transfère le fichier (AirDrop, iCloud Drive…), puis à l'écran de déverrouillage de l'autre appareil choisis **Restaurer une sauvegarde**, avec le même mot de passe.

Le réseau local seul (`npx vite --host`) ne suffit pas : le chiffrement exige HTTPS. Il faut un certificat local, par exemple avec [mkcert](https://github.com/FiloSottile/mkcert).

**Utilisation à deux** : la même sauvegarde peut être restaurée sur l'appareil de l'autre personne. Il n'y a pas de fusion automatique : c'est la dernière sauvegarde restaurée qui fait foi.

## Assistant IA local (optionnel)

1. Installe [Ollama](https://ollama.com) (gratuit), puis : `ollama pull llama3.2`.
2. Réglages → Modules optionnels → coche **Assistant IA local**, puis clique sur **Tester**.
3. L'app hébergée sur une autre adresse que `localhost` doit être autorisée par Ollama : lance `OLLAMA_ORIGINS="https://ton-site.pages.dev" ollama serve`.

L'assistant ne reçoit qu'un résumé chiffré (totaux, catégories, échéances, objectifs), jamais la liste de tes opérations. Il ne parle qu'à une adresse locale ou du réseau local.

## Sécurité et vie privée

- **Chiffrement** : base chiffrée en AES-256-GCM, clé dérivée du mot de passe (PBKDF2, 600 000 itérations).
- **Verrouillage** : automatique après 15 minutes d'inactivité.
- **Aucune télémétrie, aucun tracker.** Seuls appels réseau : les taux BCE (devise et dates uniquement) et Ollama en local. La politique de sécurité du contenu (CSP) de la version de production bloque tout le reste.
- **RGPD** : export complet (CSV, JSON), sauvegarde chiffrée, suppression de toutes les données (Réglages).
- **Préférences hors base** : seules le thème, le mode confidentialité et le dernier compte utilisé sont en clair dans le navigateur ; ce ne sont pas des données bancaires.

## Structure

```
src/core/        logique pure testée : montants, dates, parsers, dédoublonnage, budget, récurrences, crédits, alertes, chiffrement
src/db/          schéma Drizzle, migrations SQL, accès aux données, démo
src/app/         coffre chiffré, état, thème, OCR, PDF, notifications, PWA
src/features/    un dossier par écran
e2e/             tests Playwright
```

Voir aussi [DECISIONS.md](DECISIONS.md), [ROADMAP.md](ROADMAP.md) et [COUTS.md](COUTS.md).
