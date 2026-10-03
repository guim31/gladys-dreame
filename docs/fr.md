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
  pause) et l'arrêter. Le robot nettoie toute la maison selon le **Mode de
  nettoyage** et les réglages en cours.
- **Retour à la base**, **Pause / reprise** (un second appui relance le robot) et
  **Localiser le robot** (il se signale par un son).
- **Mode de nettoyage** — _Aspiration_, _Lavage du sol_, _Aspiration et lavage du
  sol_, _Lavage du sol après aspiration_ ou _Personnaliser le nettoyage des pièces_
  (chaque pièce garde les réglages choisis pour elle dans l'application), comme
  dans l'application. Proposé sur les robots dont les serpillières se relèvent.
- **Puissance d'aspiration** — _Silencieux_, _Standard_, _Intense_ ou _Max_, et
  **Puissance d'aspiration maximale** (valable pour le prochain nettoyage
  seulement, comme dans l'application).
- **Humidité de la serpillière** — de 1 (légèrement sèche) à 32 (mouillée).
- **Fréquence de lavage de la serpillière** — _Par zone_, _Par heure_ ou _Par
  pièce_, avec deux curseurs : la surface (en m²) entre deux lavages _par zone_, et
  la durée (en minutes) _par heure_. Chaque curseur agit quand sa fréquence est
  choisie ; sinon sa valeur est gardée pour le jour où elle le sera. Plus la
  serpillière est humide, plus les lavages sont rapprochés : au-delà de 26
  d'humidité, pas plus de 20 m² ou 20 minutes entre deux lavages.
- **Itinéraire** — _Rapide_, _Standard_, _Intensif_ ou _En profondeur_, sur les
  robots qui ont ce réglage. Dans un mode avec aspiration, seuls _Rapide_ et
  _Standard_ existent : passer en aspiration ramène un itinéraire _Intensif_ ou
  _En profondeur_ sur _Standard_, comme l'application.
- **Batterie**, et **Erreur** : le message du robot en clair (« Brosse principale
  bloquée », « Réservoir d'eau propre vide »…), « Aucune erreur » sinon.
- **Dernier nettoyage - surface** et **Dernier nettoyage - durée** — en m² et en
  minutes, celles du nettoyage en cours pendant qu'il a lieu, avec leur historique.
- **Pièce à nettoyer** — les pièces de la carte de votre robot ; en choisir une
  lance son nettoyage, et la liste revient sur « — » une fois la pièce terminée.
- **Plusieurs pièces** — un interrupteur **Sélection** par pièce, et le bouton
  **Nettoyer la sélection** qui lance le nettoyage des pièces allumées, dans
  l'ordre de la carte. La sélection est conservée d'un nettoyage à l'autre.
- **Raccourcis** — un bouton par raccourci créé dans l'application Dreamehome. Il
  conserve tous ses réglages : pièces, ordre, aspiration, débit d'eau, nombre de
  passages, serpillière.
- **Consommables** — la durée de vie restante, en pourcentage, de chaque pièce
  d'usure que votre robot suit : brosses, filtre, capteurs, serpillières, et selon
  la station, filtre du réservoir, détergent, raclette… Seules les pièces que votre
  modèle possède sont proposées, comme dans l'application.

Seules les fonctionnalités que votre robot possède réellement sont proposées.

Les réglages s'appliquent au prochain nettoyage, lancé depuis Gladys ou
l'application, sauf quand **CleanGenius** est activé dans l'application : le robot
choisit alors lui-même.

> Sur le tableau de bord, Gladys affiche le nom générique d'une fonctionnalité quand
> elle est seule de son type : **Mode de fonctionnement** est le nettoyage
> (_Nettoyer_ / _Repos_ ; _Cartographier_ n'est pas pris en charge) et **Texte** le
> message d'erreur. Vous pouvez renommer ces lignes dans la boîte du tableau de bord.

## Widgets du tableau de bord

Avec Gladys 5.1 ou plus récent, l'intégration propose quatre widgets (**Modifier le
tableau de bord** → **Ajouter un widget**). Chacun affiche le robot choisi dans ses
réglages, ou le premier robot du compte.

> Les widgets de Gladys se lisent et se touchent : ils n'ont, par choix, ni liste
> déroulante ni curseur. Pour **tous les réglages** avec leurs listes et leurs
> curseurs, ajoutez à côté du widget **Robot aspirateur** une boîte **Appareils**
> avec les fonctionnalités de réglage du robot (mode, aspiration, aspiration
> maximale, itinéraire, humidité, fréquence et intervalles de lavage).

- **Robot aspirateur** — le nom et l'état du robot, la **carte du logement** (pièces
  en couleurs, base en vert, robot en blanc, cerclé de vert quand il est sur sa
  base), une liste et quatre boutons : _Nettoyer_, _Pause_, _Retour base_,
  _Localiser_. La liste donne la batterie puis l'usure de chaque pièce, de la plus
  usée à la moins usée ; le paramètre **Liste** du widget la remplace par la
  batterie, les réglages en cours (mode, aspiration, itinéraire, humidité), le
  dernier nettoyage et la pièce la plus usée. _Nettoyer_ nettoie tout le logement,
  ou seulement les pièces dont l'interrupteur **Sélection** est allumé : le bouton
  s'appelle alors _Nettoyer la sélection_. Un robot en pause propose _Reprendre_.
  La carte est relue toutes les minutes pendant un nettoyage, toutes les 30
  minutes sinon, et seulement quand un tableau de bord l'affiche. Les noms des
  pièces n'y figurent pas.
- **Réglage du robot** — un seul réglage en grands boutons, le choix en cours coché,
  pour l'avoir à portée de doigt sur une tablette : **Mode de nettoyage**,
  **Puissance d'aspiration**, **Puissance d'aspiration maximale**, **Itinéraire**,
  **Humidité de la serpillière** (_Légèrement sèche_, _Humide_, _Mouillée_) ou
  **Fréquence de lavage de la serpillière**, choisi dans les paramètres du widget.
  Le mode _Personnaliser le nettoyage des pièces_, la valeur exacte de l'humidité
  et l'intervalle de lavage se règlent dans la boîte **Appareils**.
- **Nettoyage express** — jusqu'à quatre boutons. Sans réglage, ce sont les
  raccourcis de l'application Dreamehome ; sinon, écrivez dans **Bouton 1** à **4**
  le nom d'un raccourci ou d'une pièce tel que Gladys l'affiche (majuscules et
  accents indifférents), plusieurs pièces séparées par « + » (« Cuisine + Salon »),
  ou « Nettoyer la sélection ». Un nom qui ne correspond à rien est signalé dans le
  widget, avec la liste des noms reconnus. Le bouton de la tâche en cours est coché.
  Pratique sur une tablette murale. Gladys affiche quatre boutons au plus par widget : pour
  en avoir davantage, ajoutez un second **Nettoyage express** et nommez ses
  boutons.
- **Entretien du robot** — les trois pièces les plus usées en jauges, puis toutes
  les pièces suivies, de la plus usée à la moins usée : en rouge sous 10 %, en
  orange sous 30 %.

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

Quand une mise à jour de l'intégration ajoute des fonctionnalités, ou que vous
créez un raccourci ou une pièce dans l'application, l'onglet **Découverte**
propose de **mettre à jour** l'appareil (les pièces et raccourcis sont relus toutes
les 6 heures, ou tout de suite avec **Rechercher**).

## Dans les scènes

- Déclencheur sur l'**état** : par exemple, être prévenu quand le robot passe
  « Erreur », puis lire le message de la fonctionnalité **Erreur**.
- Action « Contrôler un appareil » : **Nettoyage** sur _Nettoyer_ pour lancer le
  robot, **Pièce à nettoyer** sur une pièce, ou un bouton de **Raccourci**.
- Plusieurs pièces : allumer leurs interrupteurs **Sélection**, puis appuyer sur
  **Nettoyer la sélection**. Le mode et les réglages se posent de la même façon,
  avant de lancer le nettoyage.

## Signaler un problème

L'action **Diagnostic** affiche ce que l'intégration voit de vos robots : modèle,
firmware, valeurs brutes, lecture de la carte. Copiez son résultat dans un message
du forum Gladys ou une issue GitHub. Il ne contient ni e-mail, ni identifiant, ni
nom de pièce.

## Limites

- Le mode de nettoyage et les réglages de serpillière ne sont proposés qu'aux
  modèles dont l'intégration connaît le codage (celui de la table de modèles de
  l'intégration Home Assistant) : une écriture erronée modifierait vos réglages.
  Un raccourci de l'application couvre les autres cas.
- La cartographie se lance depuis l'application Dreamehome, pas depuis Gladys.
- Les robots des applications MOVAhome et Trouver ne sont pas pris en charge.
- Cette intégration a été écrite sans robot sous la main, à partir du protocole de
  l'intégration Home Assistant de référence : vos retours (et le résultat du
  **Diagnostic**) permettent de la valider modèle par modèle.
