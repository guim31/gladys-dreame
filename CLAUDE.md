# CLAUDE.md — Dreame

Aspirateurs robots Dreamehome : nettoyage, aspiration, serpillière, pièces, raccourcis.

Intégration externe pour [Gladys Assistant](https://gladysassistant.com), bâtie sur le template officiel `GladysAssistant/integration-template-js` (SDK `@gladysassistant/integration-sdk` ^0.14.0, `gladys_version` `>=5.1.0`). Mainteneur : Guilhem (`guim31`).

Ce fichier rassemble ce qu'une session de code doit savoir et qui ne se lit pas dans le code : choix de conception, faits vérifiés en réel, pièges déjà payés. Le compléter quand un nouveau piège est découvert.

## État au 03/10/2026

Version 0.5.0 publiée. **Pas de topic** `gladys-assistant-integration` : Guilhem a choisi de
l'attendre jusqu'à la v1, et l'intégration s'installe par « Installer depuis GitHub ». Le même
slug reprendra la main une fois le topic posé.

Guilhem n'a pas de Dreame. Tout retour réel vient du testeur **Chris75** (`dreame.vacuum.r2449a`,
firmware `4.3.9_1771`), sur le fil https://community.gladysassistant.com/t/10910 (lisible en JSON
par `/t/10910.json`). Pat, sur le fil 10713, a aussi un laveur Dreame.

Validé chez Chris75 jusqu'à la 0.4.0 : connexion, MQTT, état, retour base, localiser,
consommables, batterie, raccourcis, pause/reprise, pièces, tous les réglages serpillière (mode,
max, humidité, fréquence, itinéraire, sélection multi-pièces), widgets, carte juste avec la
position du robot suivie en direct, clés d'action de widget numérotées, boutons multi-pièces,
pièces d'usure filtrées par modèle.

Le widget `robot_setting` (un réglage par widget, en boutons) a été **jugé inadapté** par Chris75
le 02/10/2026 : trop de place, pas de liste ni de curseur, et la boîte « Appareils » du cœur fait
mieux pour les réglages. Sa clé est publiée, donc gardée ; la documentation renvoie les réglages
vers la boîte Appareils. **À confirmer sur la 0.5.0** : aucun bouton en style `primary`
(invisible en mode sombre), coche sur la tâche en cours, fonctionnalités « Dernier nettoyage -
surface / durée », carte relue quand l'état du robot change.

Le 03/10/2026, Chris75 a montré son tableau de bord (widget Robot, Nettoyage express, Entretien,
boîtes Appareils des réglages et de la sélection des pièces) et une maquette plus compacte, reprise
sur `main` après la 0.5.0 : batterie en tête de la liste du widget Robot au lieu d'une tuile,
liste de l'usure de toutes les pièces par défaut, bouton _Nettoyer_ qui nettoie la sélection
quand des pièces sont cochées, « Retour base » au lieu de « Base ».

Les pièges du cœur rencontrés ici ont été remontés à Pierre-Gilles (sujet
https://community.gladysassistant.com/t/10940) : il a confirmé et ouvert les issues #3153 à
#3156, corrigées par son automatisation, sans PR de notre part. Il a accueilli l'idée d'une **carte
aspirateur dans la boîte Appareils du cœur** (regroupement comme les lumières, PR #2975) :
demande de fonctionnalité https://community.gladysassistant.com/t/10945, PR
GladysAssistant/Gladys#3160 ouverte le 03/10/2026 (une ligne par robot, et un panneau avec ses
autres fonctionnalités). Le libellé générique d'une fonctionnalité seule de son type n'a pas eu
d'issue.

## Protocole

- Cloud Dreamehome `<région>.iot.dreame.tech:13267`, repris de Tasshack/dreame-vacuum v2.0.0b25
  (MIT). Ses chaînes obfusquées sont ici en clair, dans `src/constants.js` (`DREAME_CLOUD`).
- Vérifié sans compte : un login refusé répond HTTP 400 `invalid_user`, pour un compte inconnu
  comme pour un mauvais mot de passe. La région ne se devine donc pas, d'où le champ région.
  Jeton expiré = 401 ; refresh token mort = 401 `invalid_token`.
- Temps réel par MQTT (un client par robot, TLS non vérifié comme l'appli officielle), poll de
  60 s en filet, publication des seuls changements.
- L'action **Diagnostic** (sans e-mail, did, uid, MAC ni nom de pièce) est l'outil de débogage à
  faire coller par le testeur. Son bloc de résultat défile : lui demander de tout copier.

## Choix de conception non évidents

- Mode de nettoyage Gladys = puissance d'aspiration (4.4), comme Roborock et Xiaomi. Elle est
  aussi exposée en `text/select` Silencieux/Standard/Intense/Max : la liste clean-mode de Gladys,
  sept choix figés, déroutait le testeur.
- 4.23 est une valeur groupée dont l'octet 0 est le mode, avec une **numérotation inversée sur
  les serpillières relevables** (2 aspiration, 0 aspiration + lavage, 1 lavage, 3 lavage après
  aspiration), et l'octet 1 la fréquence de lavage (m² ou minutes). Vérifié : 3841 = lavage, zone
  15 m² ; 3842 = aspiration. 4.26 = « personnaliser par pièce », 28.1 = humidité (1 à 32),
  `BackWashType` = 1 zone, 2 heure, 3 pièce. L'itinéraire est `CleanRoute` dans 4.50 (1 standard,
  2 intensif, 3 profond, 4 rapide), écrit par une seule clé `{"k","v"}`.
- Mot de passe jamais stocké : seul `md5(mdp + sel)` (ce qu'envoie l'appli) et le refresh token,
  hors schéma, avec repli automatique sur l'empreinte quand Dreame invalide le refresh token.
- Pièces lues dans la carte chiffrée (AES-CBC, IV par modèle dans `src/data/models.json`, extrait
  de la table de Home Assistant par `tools/extract-models.py`, avec les `capabilities` de chaque
  modèle). Sur r2449a, les pièces ne sont pas dans la carte courante (`seg_inf` absent) mais dans
  la carte sauvegardée imbriquée `rism` : repli en place.
- Pièces d'usure filtrées par capacité du modèle : un robot répond pour des pièces qu'il n'a pas
  (roues à 0 % sur r2449a).
- Carte dessinée sans dépendance (`src/dreame/render.js`, PNG palette écrit à la main), relue
  seulement quand un tableau de bord la demande : 50 s si le robot roule, 30 min sinon.
- « Cartographier » est volontairement refusé : la cartographie rapide peut écraser la carte.
- Widget Robot : la batterie ouvre la liste, parce que le cœur range toute tuile (`value`,
  `gauge`) **au-dessus** de l'image, sur une ligne à elle. La liste montre par défaut l'usure de
  chaque pièce (maquette du testeur) ; le paramètre `list` = `settings` rend l'ancienne liste
  (réglages en cours, dernier nettoyage, pièce la plus usée).
- Son bouton _Nettoyer_ nettoie les pièces cochées (interrupteurs « Sélection ») quand il y en a,
  décidé **au moment de l'appui** (`cleansSelection()`) : le libellé peut retarder de 10 s sur un
  interrupteur. Le `run-mode` (scènes, boîte Appareils) nettoie toujours tout le logement : une
  scène ne doit pas dépendre d'une sélection oubliée.
- Nettoyage express : **4 boutons au plus**, règle du cœur (une rangée de pastilles) ; pour
  davantage, un second widget dont on nomme les boutons. Un nom qui ne correspond à rien est
  signalé avec la liste des noms reconnus (`knownNames()`), faute de pouvoir les proposer en liste
  (voir les pièges du cœur).
- Un raccourci en cours a `state` « 0 » ou « 1 » dans 4.48 (« -1 » sinon), comme le lit Home
  Assistant : seul ce drapeau change quand il démarre ou s'arrête, les appareils découverts ne
  sont republiés que si un raccourci est ajouté, retiré ou renommé.

## Pièges déjà payés

- Sous Node 24, `mkdirSync(..., { recursive: true })` sur un chemin de `/proc` ne rend jamais la
  main.
- Prettier retire les guillemets des clés `'2.1'` d'un objet littéral, et `4.10` devient `4.1` :
  utiliser des paires `[clé, valeur]`.
- La table de modèles doit lister **tous** les modèles connus, sinon un vieux modèle sans IV passe
  pour récent (mauvaise numérotation des états au-delà de 18).

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test` (`node --test`). Prettier contrôle **aussi le Markdown** : lancer `npm run format`
  après avoir modifié ce fichier ou le README, sinon la CI tombe.
- La CI tourne en Node 24. Une session cloud a Node 22 par défaut, ce qui suffit (`engines` :
  `>=20`).
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel passe par
  Guilhem ou par les testeurs du forum. Le dire, plutôt que de conclure que « ça marche ».
- **Publier est un geste de Guilhem** : Actions → Release (patch, minor ou major) construit
  l'image `ghcr.io/guim31/<dépôt>`, monte la version du manifeste et pose le tag. Un correctif
  poussé sur `main` sans Release n'atteint aucune installation : le signaler.
- Le workflow Release réindente le manifeste sans relancer la CI : passer `npm run format` au
  commit suivant.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys (communs aux intégrations de guim31)

Vérifiés dans le code du cœur ou payés sur une intégration publiée. Ils valent pour toutes.

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe (1000, 2000, 10000, 15000, 30000, 60000 ms).
  Publier seulement `poll_frequency` donne un appareil accepté mais jamais interrogé. Pour une
  cadence hors liste, publier `should_poll: false` et pousser les états depuis le conteneur, en
  gardant un `onPoll` de repli.
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié (`getDeviceFeatureName` du front).
- **Aucune commande d'appareil ne permet un choix multiple** : un `text/select` n'a qu'un choix
  actif (`AdaptiveOptionControl` : rangée de boutons quand tout tient sur une ligne, liste
  déroulante sinon). D'où un interrupteur « Sélection » par pièce. Une liste à choix multiples
  serait une évolution du cœur (proposée le 03/10/2026 ; Matter `ServiceArea` en aurait besoin
  aussi).
- Les contrôles `vacuum-cleaner` / `clean-mode` et `run-mode` affichent toujours toutes les valeurs
  et ignorent `supported_options` (GladysAssistant/Gladys#3156). Le `run-mode` de l'intégration
  déclare déjà Repos et Nettoyer : « Cartographier » disparaîtra avec la correction. Les
  `supported_options` d'un appareil créé ne se mettent à jour qu'avec « Mettre à jour », donc lors
  d'un changement de structure.
- Depuis Gladys 4.84, un changement de structure fait proposer « Mettre à jour » dans l'onglet
  Découverte (`structure_changed`) : plus besoin de supprimer et recréer l'appareil. Un
  changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language`. Le superviseur injecte `TZ`, le
  fuseau de Gladys, dans le conteneur. La sandbox est limitée à 256 Mo.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus en `<input type="number" min max>` **sans `step`** (le
  manifeste n'en accepte pas) : le navigateur n'accepte alors que `min + k`. Min et défaut
  **entiers** seulement ; une valeur décimale passe par un `select` ou par un `string` parsé
  (virgule acceptée).
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir (la saisie
  s'efface à chaque frappe), et une action n'applique **aucun `default`**, ni à l'affichage ni
  côté serveur, tout en exigeant les champs `required` (422). Issues GladysAssistant/Gladys#3154
  et #3155, ouvertes par Pierre-Gilles le 03/10/2026 : une fois la correction publiée, le mot de
  passe pourra repasser en `secret` et la région en `required` avec défaut, en montant
  `gladys_version` à la version corrigée.

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- Un réglage de widget ne propose en liste que les **appareils** de l'intégration (`source:
"devices"`, seule source dynamique) : ni pièces ni raccourcis à cliquer, ils s'écrivent.
- Budget du cœur : **8 composants par widget, dont 2 textes au plus**. Le validateur du SDK le
  signale ; `validateWidgetContent` est exporté pour les tests.
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées, ce que fait
  le bouton dans ses paramètres.
- Le vocabulaire des widgets n'a ni liste ni curseur, **par choix** : la spec du cœur
  (`dashboard-widgets.md`, « Out of scope ») réserve les réglages aux boîtes d'appareils. Ne pas
  essayer de les recréer en boutons pour tous les réglages : le testeur préfère la boîte
  « Appareils ». Seul un bouton `device_feature` numérique a un état actif natif.
- **En mode sombre, le style `primary` d'un bouton de widget ne se voit pas** : la règle
  `.dark-mode .button` du cœur écrase le fond de `.buttonPrimary`, sans règle sombre pour lui (ni
  pour l'état actif). Signaler un choix courant par l'icône (`check-circle`), jamais par le style.
  Issue GladysAssistant/Gladys#3153.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil (Kp > 6) reste le travail
  d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- Passer `gladys_version` à `>=5.1.0` coupe les mises à jour des cœurs plus anciens, qui
  refusent les champs inconnus du manifeste.

## Publication et store

- Avant de demander une Release ou le topic, lancer le validateur officiel depuis la racine :
  `npx -y github:GladysAssistant/integration-store`. Il vérifie le schéma, la `description`
  (**100 caractères au plus par langue**), la documentation (300 caractères au moins), l'image
  Docker et la cover (**150 Ko au plus**).
- Le topic `gladys-assistant-integration` fait indexer le dépôt ; Guilhem le pose (le jeton de
  l'agent n'en a pas le droit). L'indexeur passe à H:13 chaque heure, souvent avec une demi-heure
  de retard, et rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  l'index `https://integration-store-storage.gladysassistant.com/index.json`.
- Sans topic, on installe par la carte « Installer depuis GitHub » (URL du dépôt, Gladys ≥ 4.84) :
  le cœur lit le manifeste sur `main` et propose les mises à jour à chaque rafraîchissement du
  catalogue.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi. Avant de pousser un dépôt neuf, tester sur
  un `git clone` propre, pas sur la copie de travail.
