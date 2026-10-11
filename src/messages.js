// -----------------------------------------------------------------------------
// Messages shown in the Configuration screen (action results and the
// connection badge). Multi-language objects: Gladys shows the user's language,
// English otherwise.
// -----------------------------------------------------------------------------

export const REGION_NAMES = {
  eu: { en: 'Europe', fr: 'Europe', de: 'Europa', es: 'Europa' },
  us: { en: 'North America', fr: 'Amérique du Nord', de: 'Nordamerika', es: 'Norteamérica' },
  cn: {
    en: 'Mainland China',
    fr: 'Chine continentale',
    de: 'Festlandchina',
    es: 'China continental',
  },
  ru: { en: 'Russia', fr: 'Russie', de: 'Russland', es: 'Rusia' },
  sg: {
    en: 'Asia (Singapore)',
    fr: 'Asie (Singapour)',
    de: 'Asien (Singapur)',
    es: 'Asia (Singapur)',
  },
  kr: { en: 'South Korea', fr: 'Corée du Sud', de: 'Südkorea', es: 'Corea del Sur' },
};

const regionName = (region, language) => (REGION_NAMES[region] || REGION_NAMES.eu)[language];

export const MESSAGES = {
  linkedAccount: (username, region) => ({
    en: `Linked account: ${username} (${regionName(region, 'en')}).`,
    fr: `Compte lié : ${username} (${regionName(region, 'fr')}).`,
    de: `Verknüpftes Konto: ${username} (${regionName(region, 'de')}).`,
    es: `Cuenta vinculada: ${username} (${regionName(region, 'es')}).`,
  }),
  linked: (count) => ({
    en: `Account linked, ${count} robot(s) found. Open the Discovery tab to add them to Gladys.`,
    fr: `Compte lié, ${count} robot(s) trouvé(s). Ouvrez l'onglet Découverte pour les ajouter à Gladys.`,
    de: `Konto verknüpft, ${count} Roboter gefunden. Öffne den Tab „Entdecken“, um sie zu Gladys hinzuzufügen.`,
    es: `Cuenta vinculada, ${count} robot(s) encontrado(s). Abra la pestaña Descubrir para añadirlos a Gladys.`,
  }),
  linkedNoRobot: {
    en: 'Account linked, but it has no robot vacuum. A robot paired in the Xiaomi Home app is not on the Dreamehome cloud.',
    fr: "Compte lié, mais il ne contient aucun robot aspirateur. Un robot appairé dans l'application Xiaomi Home n'est pas sur le cloud Dreamehome.",
    de: 'Konto verknüpft, aber es enthält keinen Saugroboter. Ein in der Xiaomi-Home-App gekoppelter Roboter ist nicht in der Dreamehome-Cloud.',
    es: 'Cuenta vinculada, pero no contiene ningún robot aspirador. Un robot emparejado en la aplicación Xiaomi Home no está en la nube Dreamehome.',
  },
  missingUsername: {
    en: 'Enter the email address (or phone number) of your Dreamehome account.',
    fr: "Saisissez l'adresse e-mail (ou le numéro de téléphone) de votre compte Dreamehome.",
    de: 'Gib die E-Mail-Adresse (oder Telefonnummer) deines Dreamehome-Kontos ein.',
    es: 'Introduzca la dirección de correo electrónico (o el número de teléfono) de su cuenta Dreamehome.',
  },
  missingPassword: {
    en: 'Enter the password of your Dreamehome account.',
    fr: 'Saisissez le mot de passe de votre compte Dreamehome.',
    de: 'Gib das Passwort deines Dreamehome-Kontos ein.',
    es: 'Introduzca la contraseña de su cuenta Dreamehome.',
  },
  credentialsRefused: (region) => ({
    en:
      `Dreame refused these credentials in the ${regionName(region, 'en')} region. Check the email or phone number, ` +
      'the password and the region (the one chosen in the app when the account was created). An account created ' +
      'with Google, Apple or a code received by text message has no password: set one first in the Dreamehome app.',
    fr:
      `Dreame a refusé ces identifiants dans la région ${regionName(region, 'fr')}. Vérifiez l'e-mail ou le numéro, ` +
      "le mot de passe et la région (celle choisie dans l'application à la création du compte). Un compte créé " +
      "avec Google, Apple ou un code reçu par SMS n'a pas de mot de passe : définissez-en un d'abord dans l'application Dreamehome.",
    de:
      `Dreame hat diese Zugangsdaten in der Region ${regionName(region, 'de')} abgelehnt. Prüfe die E-Mail-Adresse oder ` +
      'Telefonnummer, das Passwort und die Region (die bei der Kontoerstellung in der App gewählte). Ein mit Google, ' +
      'Apple oder einem SMS-Code erstelltes Konto hat kein Passwort: Lege zuerst eines in der Dreamehome-App fest.',
    es:
      `Dreame ha rechazado estas credenciales en la región ${regionName(region, 'es')}. Compruebe el correo electrónico o el ` +
      'número de teléfono, la contraseña y la región (la elegida en la aplicación al crear la cuenta). Una cuenta creada ' +
      'con Google, Apple o un código recibido por SMS no tiene contraseña: defina una primero en la aplicación Dreamehome.',
  }),
  relinkNeeded: {
    en: 'Dreame no longer accepts the stored session (password changed?). Link the account again.',
    fr: "Dreame n'accepte plus la session enregistrée (mot de passe changé ?). Liez à nouveau le compte.",
    de: 'Dreame akzeptiert die gespeicherte Sitzung nicht mehr (Passwort geändert?). Verknüpfe das Konto erneut.',
    es: 'Dreame ya no acepta la sesión guardada (¿ha cambiado la contraseña?). Vuelva a vincular la cuenta.',
  },
  cloudUnreachable: (detail) => ({
    en: `The Dreamehome cloud could not be reached: ${detail}`,
    fr: `Le cloud Dreamehome est injoignable : ${detail}`,
    de: `Die Dreamehome-Cloud ist nicht erreichbar: ${detail}`,
    es: `No se puede acceder a la nube Dreamehome: ${detail}`,
  }),
  unlinked: {
    en: 'The account has been unlinked: its session and password fingerprint are erased, its robots are no longer discovered.',
    fr: "Le compte a été délié : sa session et l'empreinte du mot de passe sont effacées, ses robots ne sont plus découverts.",
    de: 'Die Verknüpfung des Kontos wurde aufgehoben: Sitzung und Passwort-Fingerabdruck sind gelöscht, seine Roboter werden nicht mehr entdeckt.',
    es: 'La cuenta se ha desvinculado: su sesión y la huella de la contraseña se han borrado, sus robots ya no se descubren.',
  },
  notLinked: {
    en: 'No Dreamehome account is linked yet: use "Link the account" first.',
    fr: "Aucun compte Dreamehome n'est encore lié : utilisez d'abord « Lier le compte ».",
    de: 'Es ist noch kein Dreamehome-Konto verknüpft: Verwende zuerst „Konto verknüpfen“.',
    es: 'Todavía no hay ninguna cuenta Dreamehome vinculada: use primero «Vincular la cuenta».',
  },
};
