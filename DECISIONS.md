# Décisions

## D1. SQLite dans le navigateur (sql.js) + Drizzle, base chiffrée en entier
L'app tourne 100 % dans le navigateur, sans serveur. La base SQLite est gardée en mémoire. Elle est chiffrée (AES-256-GCM) en un seul bloc et enregistrée dans IndexedDB : 0,8 s après chaque modification, et aussitôt quand l'onglet passe en arrière-plan.
- Pourquoi pas Dexie : avec Dexie, les champs indexés (dates, montants) resteraient en clair.
- Limite : toute la base est réécrite à chaque sauvegarde. Quelques Mo pour 10 ans de données, donc quelques millisecondes. Au-delà d'environ 50 Mo, il faudra passer à wa-sqlite + OPFS.

## D2. Mot de passe : PBKDF2-SHA256, 600 000 itérations, 8 caractères minimum
- Il n'y a pas de PIN à 4 chiffres : sur une base volée, il se casserait hors ligne en quelques secondes.
- Le mot de passe est irrécupérable (pas de porte dérobée). La sauvegarde est le coffre chiffré tel quel.
- Verrouillage automatique après 15 minutes d'inactivité.
- Changement de mot de passe : pas encore disponible (voir la roadmap).

## D3. Pas de connexion bancaire ni de profils LCL/Revolut
Décision de l'utilisateur : pas de synchro bancaire (Enable Banking abandonné) ni de profils préconfigurés par banque. L'import CSV/OFX/QIF générique, avec détection des colonnes et mapping mémorisé par format de fichier, couvre tous les cas. Aucun backend n'est donc nécessaire.

## D4. Montants en centimes entiers
Ils sont stockés en centimes dans la devise du compte, avec `amount_eur` calculé à l'enregistrement. Les totaux multi-comptes utilisent `amount_eur`.

## D5. Une devise par compte
Un compte Revolut avec plusieurs devises se modélise en plusieurs comptes (« Revolut », « Revolut USD »). Un import dont la colonne devise ne correspond pas au compte est refusé : on évite ainsi des soldes faux.

## D6. Clé de dédoublonnage
`date | montant | libellé normalisé | n° d'occurrence du jour`, unique par compte. Le numéro d'occurrence permet de garder deux cafés identiques le même jour.
- Le FITID de l'OFX n'est pas utilisé, pour que CSV et OFX d'un même compte se dédoublonnent entre eux.
- Limite : si un export coupe une journée au milieu de deux opérations identiques, la deuxième peut être prise pour un doublon au réimport suivant.

## D7. Virements internes : suggérés, jamais automatiques
L'app ne fait que proposer : un « oui » relie les deux opérations et les sort des revenus et dépenses, un « non » est mémorisé. Il n'y a pas de rapprochement automatique silencieux, pour éviter de masquer une vraie dépense.

## D8. Règles apprises
Quand tu changes la catégorie d'une opération, une règle est créée sur les 2 premiers mots significatifs du libellé normalisé (par exemple « BOULANGERIE MARIE »). Elle a la priorité 1, au-dessus des règles par défaut (0) et en dessous des règles manuelles (2). Si une règle donne déjà la bonne catégorie, rien n'est créé.

## D9. Langue
Les textes de l'interface sont écrits en français directement dans les composants, et les nombres et dates sont formatés par `Intl` en `fr-FR`. Aucune bibliothèque i18n tant qu'il n'y a qu'une langue : on extraira les textes le jour où une 2e langue sera demandée.

## D10. Navigation par hash (`#/operations`)
Elle fonctionne sur GitHub Pages ou Cloudflare Pages sans configuration de réécriture d'URL.

## D11. Taux de change : Frankfurter (BCE)
`api.frankfurter.dev` est gratuit, sans clé, et accepte les appels depuis le navigateur (CORS). Une seule requête par import (plage de dates), mise en cache dans la base. Week-ends et jours fériés : on prend le dernier taux publié.

## D12. Budget : un modèle versionné et des exceptions séparées
- `budget_line` porte un montant valable de `valid_from` à `valid_to` (en mois). `budget_exception` remplace ce montant pour **un** mois, avec un motif.
- Les trois portées :
  - « ce mois seulement » crée ou modifie une exception ;
  - « à partir de ce mois » ferme la ligne en cours au mois précédent et remplace les lignes futures ;
  - « tous les mois » remplace tout par une seule ligne.
- Les exceptions des autres mois sont conservées dans tous les cas : ce sont des choix explicites. Seule l'exception du mois modifié est supprimée, sinon elle masquerait la nouvelle valeur.

## D13. Une méthode de budget, plusieurs lectures
Le même modèle (un montant par catégorie et par mois) sert les quatre méthodes demandées :
- **plafonds par catégorie** : le prévu et la barre de consommation ;
- **enveloppes** : le prévu, plus le report activable par catégorie ;
- **base zéro** : l'indicateur « reste à affecter » (revenus prévus − dépenses prévues) ;
- **50/30/20** : classement besoin/envie par catégorie, l'épargne étant ce qui reste. Pour le mois en cours et les mois futurs, le calcul utilise le prévu, sinon tout ce qui n'est pas encore dépensé passerait pour de l'épargne.

## D14. Rattachement des dépenses au budget
Une opération compte pour sa catégorie si celle-ci a une ligne de budget ce mois-là, sinon pour sa catégorie parente. Sans ni l'une ni l'autre, elle est « hors budget » et affichée à part. On peut donc budgéter « Alimentation » en bloc, ou « Courses » et « Restaurants » séparément.

## D15. Report (rollover)
- Il ne concerne que les dépenses.
- Il s'accumule depuis le premier mois du budget (réglage `budgetStart`) : reste du mois = prévu + report − réel, et ce reste devient le report du mois suivant. Le déficit se reporte aussi.

## D16. Récurrences
- **Rapprochement** : une échéance est « payée » si une opération de même sens, dont le libellé contient le motif, tombe à ±6 jours (±2 pour l'hebdomadaire).
- **Hausse de prix** : le dernier prélèvement retrouvé est au moins 1 % au-dessus du précédent.
- **Détection automatique** : au moins 3 occurrences (2 pour l'annuel), intervalles réguliers et montants stables.
  - Les virements internes, confirmés ou en attente de confirmation, en sont exclus.
  - Une suggestion ignorée est mémorisée.

## D17. Reste à vivre et projection
- **Reste à vivre** = solde des comptes courant, carte et espèces + échéances récurrentes non encore réglées d'ici la fin du mois (revenus attendus et charges à venir), divisé par le nombre de jours restants. Il ne dépend pas du budget, pour rester un chiffre de trésorerie concret.
- **Projection** = solde total + pour le mois en cours, ce qu'il reste à recevoir et à dépenser selon le budget ; pour les mois suivants, revenus prévus − dépenses prévues. Elle repose sur le budget et non sur les récurrences, pour ne pas compter deux fois les charges fixes.

## D18. Alertes calculées à la volée
- Les alertes ne sont pas stockées : elles sont recalculées à partir de l'état courant (budget, soldes, échéances, anomalies). Seules les alertes masquées et celles déjà notifiées sont mémorisées, par identifiant stable (par exemple `budget80:<catégorie>:<mois>`).
- Une alerte masquée ne revient pas. Une nouvelle situation (autre mois, autre échéance) en crée une nouvelle.
- Le « moteur de règles personnalisables » se limite pour l'instant à activer chaque type d'alerte et régler ses seuils (% de budget, solde bas, jours avant prélèvement). Des règles libres (« si X alors Y ») n'apportaient rien de plus pour un usage solo.

## D19. Notifications système
- Elles utilisent l'API Notification du navigateur, sur demande d'autorisation. Les alertes « info » ne sont pas notifiées, sauf les prélèvements à venir.
- Sans service worker, elles ne partent que lorsque l'app est ouverte : vérification 2 s après chaque modification et toutes les 30 min. Le service worker de la PWA (phase 6) lèvera cette limite.

## D20. Anomalies
- **Doublon** : seulement une saisie manuelle et une opération importée de même montant, sur le même compte, à 3 jours d'écart au plus. Deux opérations importées identiques sont légitimes (deux cafés), elles ne sont pas signalées.
- **Montant inhabituel** : plus de 2 fois la médiane chez le même marchand (au moins 3 précédents) et plus de 20 € d'écart.
- **Frais bancaires** : la catégorie « Frais bancaires » ou un libellé contenant FRAIS, COMMISSION, AGIOS, COTISATION…

## D21. Score de santé (sur 100)
- Taux d'épargne : 30 points, 20 % visés.
- Épargne de précaution : 25 points, 3 mois de dépenses sur les comptes épargne.
- Respect du budget : 20 points, part des enveloppes tenues le mois dernier.
- Absence de découvert sur 90 jours : 15 points.
- Frais bancaires : 10 points (0 € → 10, 30 € ou moins → 5).

Chaque critère affiche comment gagner des points. Les seuils sont des conventions de finances personnelles, pas une norme.

## D22. Graphiques
- Recharts (MIT), avec la palette de référence déjà validée pour le daltonisme et le contraste : bleu pour les revenus et le solde, orange pour les dépenses, gris pour le contexte. Le mode sombre a ses propres teintes.
- La répartition utilise des barres classées d'une seule teinte, pas un camembert.
- L'année précédente apparaît en gris (emphase). La prévision est en pointillés dans la même teinte que le réel.
- Chaque graphique a une vue tableau et une info-bulle, et il n'y a jamais de double axe.

## D23. Valorisation des comptes en devise
- Les soldes (aujourd'hui comme dans l'historique) sont valorisés au dernier taux connu. Les totaux de revenus et de dépenses utilisent le taux du jour de chaque opération.
- Un écart d'arrondi de quelques centimes est possible dans l'historique.

## D24. Prévision
- La courbe porte sur tous les comptes.
- L'alerte de découvert, elle, projette seulement les comptes courants sur 3 mois.
- Limite connue : l'épargne versée chaque mois par virement interne n'est pas dans le budget, donc la projection des comptes courants est optimiste. Il faut l'inscrire comme récurrence ou la budgéter si l'on veut en tenir compte.

## D25. Crédits et simulations
- La mensualité est arrondie au centime supérieur, ce qui évite une dernière échéance de quelques centimes.
- Le remboursement anticipé simulé démarre le mois en cours, pas au début du prêt.
- Les scénarios partent du solde des comptes courants et des flux nets du budget prévu (à défaut, de la moyenne des 3 derniers mois).
- On compare au plus 2 scénarios en plus de la base, soit 3 couleurs distinguables par tout le monde.
- Le calendrier jour par jour = échéances suivies + dépense courante moyenne hors charges fixes.

## D26. Patrimoine
Patrimoine net = soldes des comptes + valeur des biens et placements (saisie manuelle datée) − capital restant dû des crédits. Pas de cotation automatique : aucune API boursière gratuite, sans clé et fiable n'a été retenue.

## D27. Pièces jointes et OCR
- **Stockage** : les pièces jointes sont dans la base chiffrée. Les photos sont réduites à 1 600 px en JPEG, 5 Mo maximum. Les SVG et le HTML sont refusés : ils pourraient exécuter du code.
- **Lecture des données binaires** : directement via sql.js. Drizzle décode les BLOB en texte dans le navigateur, faute de `Buffer`, ce qui corrompait les images. Un test le vérifie sans `Buffer`.
- **OCR** : Tesseract.js, avec ses fichiers copiés dans `public/ocr` au moment de `npm install`. Aucun CDN, aucune image envoyée. Ces 12 Mo sont mis en cache au premier usage, pas à l'installation de l'app.

## D28. Relevés PDF
pdf.js extrait le texte positionné. Une opération = une ligne qui commence par une date et contient un montant. Le sens vient de la colonne Débit/Crédit la plus proche. Le résultat est présenté comme « au mieux », avec un aperçu à vérifier : CSV et OFX restent recommandés.

## D29. Freelance et fiscal
- **Freelance** : chaque opération porte un drapeau pro, un taux de TVA et un drapeau « note de frais ». Le HT et la TVA sont calculés à partir du TTC. L'export comptable en CSV est au format Excel français (`;`, virgule décimale), avec une protection contre l'injection de formules.
- **Fiscal** : catégories marquées don / garde / domicile. Les barèmes et plafonds 2026 sont indicatifs et la limite de 20 % du revenu pour les dons n'est pas appliquée.

## D30. Foyer à deux
Pas de serveur, donc pas de synchronisation en temps réel. Le partage passe par la sauvegarde chiffrée, restaurée sur l'autre appareil, sans fusion : la dernière restaurée fait foi. Une fusion par fichier (par identifiant et date de modification) reste possible plus tard si le besoin se confirme.

## D31. Annulation et historique
- **Fonctionnement** : avant chaque modification, un instantané de la base est gardé en mémoire (50 au maximum, 60 Mo au plus) et effacé au verrouillage. Revenir à un point restaure exactement la base de ce moment.
- **Pourquoi pas un journal d'audit en base** : il demanderait d'écrire l'inverse de chaque opération, une source de bugs. L'historique ne dure donc que le temps de la session.
- **Atomicité** : chaque modification s'exécute dans une transaction, si bien qu'une erreur n'enregistre jamais un état à moitié écrit.

## D32. Mode confidentialité
`formatMoney` masque les montants (••••) quand le mode est actif, sur tous les écrans et dans les notifications. Les exports et les rapports PDF utilisent `formatRaw` et ne sont jamais masqués.

## D33. Thème sans next-themes
Un petit module remplace next-themes, dont le script en ligne était incompatible avec la CSP (et provoquait un avertissement React).

## D34. PWA et mises à jour
- Une nouvelle version est **proposée**, jamais imposée : rien n'est rechargé pendant une saisie, et la base est sauvegardée avant la mise à jour.
- Les notifications ne partent que lorsque l'app est ouverte. Les envoyer app fermée demanderait un serveur de push, ce qui est contraire au principe local-first.

## D35. App Mac « Buget »
- **Principe** : une enveloppe Swift (WebKit) plutôt qu'Electron, sur le modèle de Quansi+. Elle pèse quelques Mo au lieu de plus de 150 Mo et n'ajoute aucune dépendance.
- **Pourquoi un mini serveur local** : le chiffrement (WebCrypto) et IndexedDB exigent un contexte sécurisé, que `file://` et un schéma personnalisé n'offrent pas, alors que `http://127.0.0.1` oui.
  - Le port est fixe (47219) : l'origine reste la même, donc les données aussi.
  - Le serveur n'écoute que sur la boucle locale, en lecture seule, et refuse toute sortie du dossier web.
- **Comportement de l'enveloppe** :
  - dialogues JavaScript, choix de fichiers et téléchargements sont gérés en natif ;
  - les liens externes s'ouvrent dans le navigateur ;
  - pas de service worker (inutile dans une app locale) ;
  - `NSAllowsLocalNetworking` seulement, sans exception HTTP générale.
- **Limite** : les notifications du navigateur ne sont pas disponibles dans WebKit intégré ; les alertes restent visibles dans l'app.

## D36. Déverrouillage par Touch ID (app Mac)
- **Mécanisme** : le mot de passe est chiffré (AES-GCM) avec une clé issue d'un échange ECDH, dont la clé privée est générée et gardée dans la **Secure Enclave**.
  - Elle n'est utilisable qu'après une empreinte, sur ce Mac uniquement (`.biometryCurrentSet`).
  - Si les empreintes changent (ajout d'un doigt), elle est invalidée.
  - Le fichier stocké (`~/Library/Application Support/Buget/touchid.json`, droits 600) est donc inexploitable sans empreinte.
  - Pas de trousseau : le trousseau « protégé par biométrie » exige un compte développeur Apple, alors que la Secure Enclave via CryptoKit fonctionne avec la signature locale.
- **Le mot de passe reste nécessaire en secours** : c'est lui qui chiffre la base, et sans lui un Mac fermé avec clavier externe, un doigt mouillé ou de nouvelles empreintes bloqueraient l'accès.
  - Touch ID se (ré)active automatiquement à la création de la base, au déverrouillage par mot de passe, au changement de mot de passe et à la restauration d'une sauvegarde.
  - Il est oublié lors de l'effacement total des données.
- **Pont JavaScript ↔ Swift** : il n'accepte que les messages de la page principale servie par 127.0.0.1:47219.

## D37. Démarrage à vide et tutoriel
- **Base vide** : une nouvelle base ne contient que les catégories et règles par défaut, sans comptes, opérations ni budget. Les données de démonstration ne sont proposées qu'avec `?demo` dans l'adresse ; les tests de bout en bout s'en servent.
- **Tutoriel** (5 étapes, chacune pouvant être passée) :
  - les étapes « comptes » et « revenu mensuel » s'enregistrent pour de vrai ;
  - le choix « importer » ou « saisir » emmène au bon écran à la fin ;
  - il propose la première sauvegarde.
- Le tutoriel est marqué comme vu dans la base (`tutorialDone`) et peut être revu depuis les Réglages.

## D38. Budget : libellés, portée par défaut, tri
- **Libellés** : un nouveau libellé crée une catégorie principale du même nom, ou réutilise celle qui existe déjà avec ce nom et ce type. Il reste donc utilisable pour catégoriser les opérations.
- **Portée par défaut** : « tous les mois à partir de [mois] », mois réglable. L'exception d'un seul mois et le « tous les mois, passé compris » restent proposés.
- **Tri** :
  - vue mois : du plus grand de (prévu + report, réel) au plus petit, revenus et dépenses séparément ;
  - vue année : du plus gros total annuel au plus petit.
