// -----------------------------------------------------------------------------
// Messages shown in the Configuration screen (action results and the
// connection badge). Multi-language objects: Gladys shows the user's language,
// English otherwise.
// -----------------------------------------------------------------------------

export const REGION_NAMES = {
  eu: { en: 'Europe', fr: 'Europe' },
  us: { en: 'North America', fr: 'Amérique du Nord' },
  cn: { en: 'Mainland China', fr: 'Chine continentale' },
  ru: { en: 'Russia', fr: 'Russie' },
  sg: { en: 'Asia (Singapore)', fr: 'Asie (Singapour)' },
  kr: { en: 'South Korea', fr: 'Corée du Sud' },
};

const regionName = (region, language) => (REGION_NAMES[region] || REGION_NAMES.eu)[language];

export const MESSAGES = {
  linkedAccount: (username, region) => ({
    en: `Linked account: ${username} (${regionName(region, 'en')}).`,
    fr: `Compte lié : ${username} (${regionName(region, 'fr')}).`,
  }),
  linked: (count) => ({
    en: `Account linked, ${count} robot(s) found. Open the Discovery tab to add them to Gladys.`,
    fr: `Compte lié, ${count} robot(s) trouvé(s). Ouvrez l'onglet Découverte pour les ajouter à Gladys.`,
  }),
  linkedNoRobot: {
    en: 'Account linked, but it has no robot vacuum. A robot paired in the Xiaomi Home app is not on the Dreamehome cloud.',
    fr: "Compte lié, mais il ne contient aucun robot aspirateur. Un robot appairé dans l'application Xiaomi Home n'est pas sur le cloud Dreamehome.",
  },
  missingUsername: {
    en: 'Enter the email address (or phone number) of your Dreamehome account.',
    fr: "Saisissez l'adresse e-mail (ou le numéro de téléphone) de votre compte Dreamehome.",
  },
  missingPassword: {
    en: 'Enter the password of your Dreamehome account.',
    fr: 'Saisissez le mot de passe de votre compte Dreamehome.',
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
  }),
  relinkNeeded: {
    en: 'Dreame no longer accepts the stored session (password changed?). Link the account again.',
    fr: "Dreame n'accepte plus la session enregistrée (mot de passe changé ?). Liez à nouveau le compte.",
  },
  cloudUnreachable: (detail) => ({
    en: `The Dreamehome cloud could not be reached: ${detail}`,
    fr: `Le cloud Dreamehome est injoignable : ${detail}`,
  }),
  unlinked: {
    en: 'The account has been unlinked: its session and password fingerprint are erased, its robots are no longer discovered.',
    fr: "Le compte a été délié : sa session et l'empreinte du mot de passe sont effacées, ses robots ne sont plus découverts.",
  },
  notLinked: {
    en: 'No Dreamehome account is linked yet: use "Link the account" first.',
    fr: "Aucun compte Dreamehome n'est encore lié : utilisez d'abord « Lier le compte ».",
  },
};
