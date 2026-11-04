# Roadmap

- [x] **Phase 0** : architecture.
- [x] **Phase 1** : comptes, opérations, catégories, règles qui apprennent, import CSV/OFX/QIF, dédoublonnage, virements internes, multi-devises, base chiffrée.
- [x] **Phase 2** : récurrences et abonnements, budget sur 12 mois et plus, mode exception, report, reste à vivre.
- [x] **Phase 3** : tableau de bord, graphiques, prévisions, alertes, anomalies, score de santé.
- [x] **Phase 4** : objectifs d'épargne, règles d'épargne, crédits, patrimoine, simulations, calendrier jour par jour.
- ~~**Phase 5** : synchro bancaire~~ (abandonnée à ta demande, voir D3).
- [x] **Phase 6** : PWA, pièces jointes + OCR, relevés PDF, rapports PDF, exports, freelance, fiscal, assistant Ollama.
- [x] **Phase 7** : annulation et historique, changement de mot de passe, mode confidentialité, CSP, accueil guidé, tests Playwright et accessibilité, audit des dépendances, performance.
- [x] **Phase 8** (face à The Budgeting App) : calculatrice dans les montants, calendrier des opérations avec solde jour par jour, défis et séries, résumé de période tenus / à resserrer, rappel quotidien, rythme par semaine sur l'accueil.

## Limites connues
- **Notifications** : seulement quand l'app est ouverte (pas de serveur de push).
- **Pas de fusion entre appareils** : la sauvegarde restaurée remplace la base.
- **Historique d'annulation** : il ne dure que le temps de la session.
- **Relevés PDF** : lecture au mieux, selon la mise en page de la banque.
- **Projections de trésorerie optimistes** : l'épargne versée par virement interne n'est comptée que si tu l'ajoutes comme récurrence.
- **Placements** : valeur saisie à la main, pas de cotation automatique.
- **Fiscal** : estimations indicatives. Le plafond de 20 % du revenu pour les dons n'est pas appliqué.
- **Langue** : textes en français uniquement. L'i18n se fera en extrayant les textes le jour où une 2e langue sera demandée.

## Pistes
- Budgets à la semaine ou à la quinzaine (aujourd'hui : mois ou de paie à paie).
- Icônes de catégories.
- Fusion de deux sauvegardes (usage à deux).
- Règles d'alertes libres (« si… alors… »).
- Contrôle d'accessibilité automatisé en mode sombre.
