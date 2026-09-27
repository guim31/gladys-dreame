# Dreame

Pilotez les robots aspirateurs de votre compte Dreamehome depuis Gladys Assistant.

Cette intégration s'adresse aux robots **appairés dans l'application Dreamehome**.
Elle passe par le cloud Dreamehome, ces robots n'offrant aucune commande sur le
réseau local, et reçoit leurs changements **en temps réel** : un nettoyage qui se
termine, une erreur ou un retour à la base apparaissent aussitôt dans Gladys.

> Un robot Dreame appairé dans l'application **Xiaomi Home** (Mi Home) répond sur
> un autre cloud : il n'est pas pris en charge par cette intégration.

## Fonctionnalités

Pour chaque robot de votre compte :

- **État** — nettoyage, en pause, retour à la base, en charge, sur la base, erreur.
- **Nettoyage** — démarrer un nettoyage complet (ou reprendre celui qui est en
  pause) et l'arrêter.
- **Retour à la base**, **Pause / reprise** (un second appui relance le robot) et
  **Localiser le robot** (il se signale par un son).
- **Puissance d'aspiration** — _Silencieux_, _Standard_, _Intense_ ou _Max_, comme
  dans l'application.
- **Lavage du sol** — l'itinéraire de l'application : _Rapide_, _Standard_, _Intensif_
  ou _En profondeur_, sur les robots qui ont ce réglage (en aspiration seule, seuls
  _Rapide_ et _Standard_ sont acceptés).
- **Batterie**, et **Erreur** : le message du robot en clair (« Brosse principale
  bloquée », « Réservoir d'eau propre vide »…), « Aucune erreur » sinon.
- **Pièce à nettoyer** — les pièces de la carte de votre robot ; en choisir une
  lance son nettoyage, et la liste revient sur « — » une fois la pièce terminée.
- **Raccourcis** — un bouton par raccourci créé dans l'application Dreamehome. Il
  conserve tous ses réglages : pièces, ordre, aspiration, débit d'eau, nombre de
  passages, serpillière.
- **Consommables** — la durée de vie restante, en pourcentage, de chaque pièce
  d'usure que votre robot suit : brosses, filtre, capteurs, serpillières, et selon
  la station, filtre du réservoir, détergent, raclette…

Seules les fonctionnalités que votre robot possède réellement sont proposées.

> Sur le tableau de bord, Gladys affiche le nom générique d'une fonctionnalité quand
> elle est seule de son type : **Mode de fonctionnement** est le nettoyage
> (_Nettoyer_ / _Repos_) et **Texte** le message d'erreur. Vous pouvez renommer ces
> lignes dans la boîte du tableau de bord.

## Configuration

1. Dans l'intégration, boîte **Actions**, remplissez **Lier le compte** : l'e-mail
   (ou le numéro de téléphone) et le mot de passe de votre compte Dreamehome, puis
   sa région — **Europe** pour un compte créé en France — et cliquez sur le bouton.
2. Ouvrez l'onglet **Découverte** et ajoutez vos robots à Gladys.

Le mot de passe ne sert qu'à la connexion. Il n'est jamais enregistré : seule une
empreinte, celle que l'application Dreamehome envoie elle-même, est conservée pour
rouvrir la session sans vous redemander quoi que ce soit. L'action **Délier le
compte** efface tout.

> Un compte créé avec Google, Apple ou un code reçu par SMS n'a pas de mot de
> passe. Définissez-en un d'abord dans l'application Dreamehome (profil, paramètres
> du compte), puis liez le compte ici.

Le paramètre **Langue des noms** choisit la langue des noms de fonctionnalités, des
pièces et des messages d'erreur. Les noms de fonctionnalités sont fixés à la
création de l'appareil.

## Dans les scènes

- Déclencheur sur l'**état** : par exemple, être prévenu quand le robot passe
  « Erreur », puis lire le message de la fonctionnalité **Erreur**.
- Action « Contrôler un appareil » : **Nettoyage** sur _Nettoyer_ pour lancer le
  robot, **Pièce à nettoyer** sur une pièce, ou un bouton de **Raccourci**.

## Signaler un problème

L'action **Diagnostic** affiche ce que l'intégration voit de vos robots : modèle,
firmware, valeurs brutes, lecture de la carte. Copiez son résultat dans un message
du forum Gladys ou une issue GitHub. Il ne contient ni e-mail, ni identifiant, ni
nom de pièce.

## Limites

- Le choix entre aspiration seule et lavage, et le débit d'eau, ne se règlent pas
  encore depuis Gladys : leur codage varie selon les modèles, et une écriture
  erronée modifierait vos réglages. Un raccourci de l'application couvre ce besoin.
- La cartographie se lance depuis l'application Dreamehome, pas depuis Gladys.
- Les robots des applications MOVAhome et Trouver ne sont pas pris en charge.
- Cette intégration a été écrite sans robot sous la main, à partir du protocole de
  l'intégration Home Assistant de référence : vos retours (et le résultat du
  **Diagnostic**) permettent de la valider modèle par modèle.
