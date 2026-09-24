/**
 * UI strings in English and French. The `locale-fr` fault swaps every page's dictionary;
 * `data-testid` values never change with locale, only the text nodes.
 */
export type Locale = 'en' | 'fr';

export interface Strings {
  readonly navConveyors: string;
  readonly navSynopticSvg: string;
  readonly navSynopticCanvas: string;
  readonly navAlarms: string;
  readonly navTrends: string;
  readonly navSettings: string;
  readonly navModal: string;
  readonly navLogout: string;
  readonly loginTitle: string;
  readonly loginUser: string;
  readonly loginPassword: string;
  readonly loginSubmit: string;
  readonly loginError: string;
  readonly conveyorsTitle: string;
  readonly colId: string;
  readonly colName: string;
  readonly colStatus: string;
  readonly colSpeed: string;
  readonly colActions: string;
  readonly start: string;
  readonly stop: string;
  readonly statusStopped: string;
  readonly statusRunning: string;
  readonly statusFault: string;
  readonly alarmsTitle: string;
  readonly colAlarm: string;
  readonly colConveyor: string;
  readonly colRaised: string;
  readonly colAck: string;
  readonly acknowledge: string;
  readonly acknowledged: string;
  readonly trendsTitle: string;
  readonly colTime: string;
  readonly colValue: string;
  readonly settingsTitle: string;
  readonly settingsLabel: string;
  readonly settingsThreshold: string;
  readonly settingsMode: string;
  readonly settingsNotify: string;
  readonly settingsAccessCode: string;
  readonly settingsSave: string;
  readonly modalTitle: string;
  readonly modalOpen: string;
  readonly modalClose: string;
  readonly modalConfirm: string;
  readonly modalBody: string;
  readonly errorToast: string;
  readonly blockingModalTitle: string;
  readonly blockingModalBody: string;
}

const en: Strings = {
  navConveyors: 'Conveyors',
  navSynopticSvg: 'Synoptic (SVG)',
  navSynopticCanvas: 'Synoptic (Canvas)',
  navAlarms: 'Alarms',
  navTrends: 'Trends',
  navSettings: 'Settings',
  navModal: 'Modal',
  navLogout: 'Log out',
  loginTitle: 'Operator login',
  loginUser: 'User',
  loginPassword: 'Password',
  loginSubmit: 'Log in',
  loginError: 'Invalid user or password',
  conveyorsTitle: 'Conveyors',
  colId: 'Id',
  colName: 'Name',
  colStatus: 'Status',
  colSpeed: 'Speed (m/s)',
  colActions: 'Actions',
  start: 'Start',
  stop: 'Stop',
  statusStopped: 'Stopped',
  statusRunning: 'Running',
  statusFault: 'Fault',
  alarmsTitle: 'Alarms',
  colAlarm: 'Alarm',
  colConveyor: 'Conveyor',
  colRaised: 'Raised',
  colAck: 'Acknowledged',
  acknowledge: 'Acknowledge',
  acknowledged: 'Acknowledged',
  trendsTitle: 'Trends',
  colTime: 'Time (s)',
  colValue: 'Value',
  settingsTitle: 'Settings',
  settingsLabel: 'Label',
  settingsThreshold: 'Threshold',
  settingsMode: 'Mode',
  settingsNotify: 'Notify on fault',
  settingsAccessCode: 'Access code',
  settingsSave: 'Save',
  modalTitle: 'Modal demo',
  modalOpen: 'Open modal',
  modalClose: 'Close',
  modalConfirm: 'Confirm',
  modalBody: 'This is a modal dialog used to test overlay handling.',
  errorToast: 'An unexpected error occurred while contacting the PLC.',
  blockingModalTitle: 'System busy',
  blockingModalBody: 'A blocking operation is in progress. Please wait.',
};

const fr: Strings = {
  navConveyors: 'Convoyeurs',
  navSynopticSvg: 'Synoptique (SVG)',
  navSynopticCanvas: 'Synoptique (Canvas)',
  navAlarms: 'Alarmes',
  navTrends: 'Tendances',
  navSettings: 'Réglages',
  navModal: 'Fenêtre modale',
  navLogout: 'Déconnexion',
  loginTitle: 'Connexion opérateur',
  loginUser: 'Utilisateur',
  loginPassword: 'Mot de passe',
  loginSubmit: 'Se connecter',
  loginError: 'Utilisateur ou mot de passe invalide',
  conveyorsTitle: 'Convoyeurs',
  colId: 'Id',
  colName: 'Nom',
  colStatus: 'État',
  colSpeed: 'Vitesse (m/s)',
  colActions: 'Actions',
  start: 'Démarrer',
  stop: 'Arrêter',
  statusStopped: 'Arrêté',
  statusRunning: 'En marche',
  statusFault: 'Défaut',
  alarmsTitle: 'Alarmes',
  colAlarm: 'Alarme',
  colConveyor: 'Convoyeur',
  colRaised: 'Déclenchée',
  colAck: 'Acquittée',
  acknowledge: 'Acquitter',
  acknowledged: 'Acquittée',
  trendsTitle: 'Tendances',
  colTime: 'Temps (s)',
  colValue: 'Valeur',
  settingsTitle: 'Réglages',
  settingsLabel: 'Libellé',
  settingsThreshold: 'Seuil',
  settingsMode: 'Mode',
  settingsNotify: 'Notifier en cas de défaut',
  settingsAccessCode: "Code d'accès",
  settingsSave: 'Enregistrer',
  modalTitle: 'Démonstration de fenêtre modale',
  modalOpen: 'Ouvrir la fenêtre modale',
  modalClose: 'Fermer',
  modalConfirm: 'Confirmer',
  modalBody: 'Ceci est une fenêtre modale utilisée pour tester la gestion des superpositions.',
  errorToast: "Une erreur inattendue s'est produite lors de la communication avec l'automate.",
  blockingModalTitle: 'Système occupé',
  blockingModalBody: 'Une opération bloquante est en cours. Veuillez patienter.',
};

const DICTIONARIES: Record<Locale, Strings> = { en, fr };

export function stringsFor(locale: Locale): Strings {
  return DICTIONARIES[locale];
}
