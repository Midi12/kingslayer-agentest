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
  readonly settingsModeAuto: string;
  readonly settingsModeManual: string;
  readonly settingsModeMaintenance: string;
  readonly settingsNotify: string;
  readonly settingsAccessCode: string;
  readonly settingsSave: string;
  readonly settingsError: string;
  readonly modalTitle: string;
  readonly modalOpen: string;
  readonly modalClose: string;
  readonly modalConfirm: string;
  readonly modalBody: string;
  readonly errorToast: string;
  readonly blockingModalTitle: string;
  readonly blockingModalBody: string;
  /** Alarm message templates, one per `AlarmKind`; `{conveyor}` is replaced with the conveyor id. */
  readonly alarmJamMessage: string;
  readonly alarmBlockedMessage: string;
  readonly alarmOverrunMessage: string;
  readonly alarmSensorMessage: string;
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
  settingsModeAuto: 'auto',
  settingsModeManual: 'manual',
  settingsModeMaintenance: 'maintenance',
  settingsNotify: 'Notify on fault',
  settingsAccessCode: 'Access code',
  settingsSave: 'Save',
  settingsError: 'Label and threshold are required.',
  modalTitle: 'Modal demo',
  modalOpen: 'Open modal',
  modalClose: 'Close',
  modalConfirm: 'Confirm',
  modalBody: 'This is a modal dialog used to test overlay handling.',
  errorToast: 'An unexpected error occurred while contacting the PLC.',
  blockingModalTitle: 'System busy',
  blockingModalBody: 'A blocking operation is in progress. Please wait.',
  alarmJamMessage: 'Jam detected on {conveyor}',
  alarmBlockedMessage: 'Conveyor blocked on {conveyor}',
  alarmOverrunMessage: 'Overrun on {conveyor}',
  alarmSensorMessage: 'Sensor fault on {conveyor}',
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
  settingsModeAuto: 'automatique',
  settingsModeManual: 'manuel',
  settingsModeMaintenance: 'maintenance',
  settingsNotify: 'Notifier en cas de défaut',
  settingsAccessCode: "Code d'accès",
  settingsSave: 'Enregistrer',
  settingsError: 'Le libellé et le seuil sont obligatoires.',
  modalTitle: 'Démonstration de fenêtre modale',
  modalOpen: 'Ouvrir la fenêtre modale',
  modalClose: 'Fermer',
  modalConfirm: 'Confirmer',
  modalBody: 'Ceci est une fenêtre modale utilisée pour tester la gestion des superpositions.',
  errorToast: "Une erreur inattendue s'est produite lors de la communication avec l'automate.",
  blockingModalTitle: 'Système occupé',
  blockingModalBody: 'Une opération bloquante est en cours. Veuillez patienter.',
  alarmJamMessage: 'Bourrage détecté sur {conveyor}',
  alarmBlockedMessage: 'Convoyeur bloqué sur {conveyor}',
  alarmOverrunMessage: 'Dépassement sur {conveyor}',
  alarmSensorMessage: 'Défaut capteur sur {conveyor}',
};

const DICTIONARIES: Record<Locale, Strings> = { en, fr };

export function stringsFor(locale: Locale): Strings {
  return DICTIONARIES[locale];
}

/** Formats a seeded alarm's message from its template and conveyor id, in the given locale. */
export function formatAlarmMessage(template: string, conveyorId: string): string {
  return template.replace('{conveyor}', conveyorId);
}
