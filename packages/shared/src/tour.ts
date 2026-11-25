/** Screen ids used by web routes and Expo tabs for walkthrough step lists. */
export type TourScreen =
  | 'login'
  | 'operator'
  | 'media'
  | 'ops'
  | 'face'
  | 'audit'
  | 'assistant'
  | 'config';

/** Ordered HelpTip ids for a guided walkthrough on one screen. */
export function tourStepsFor(screen: TourScreen): string[] {
  switch (screen) {
    case 'login':
      return [
        'tour.login.language',
        'tour.login.email',
        'tour.login.password',
        'tour.login.signIn',
        'tour.login.face',
      ];
    case 'operator':
      return [
        'tour.operator.nav',
        'tour.operator.claim',
        'tour.header.voice',
        'tour.operator.banner',
        'tour.operator.plantScreens',
        'tour.operator.graphic',
        'tour.operator.safePin',
        'tour.operator.matrix',
        'tour.operator.jogSpeed',
        'tour.operator.holdHint',
      ];
    case 'media':
      return ['tour.media.camera', 'tour.media.qr', 'tour.media.voice'];
    case 'ops':
      return [
        'tour.ops.diagnostics',
        'tour.ops.alarms',
        'tour.ops.ack',
        'tour.ops.window',
        'tour.ops.history',
        'tour.ops.frequency',
        'tour.ops.trends',
      ];
    case 'face':
      return ['tour.face.title', 'tour.face.enroll', 'tour.face.login'];
    case 'audit':
      return ['tour.audit.title', 'tour.audit.filters', 'tour.audit.list'];
    case 'assistant':
      return [
        'tour.assistant.title',
        'tour.assistant.docs',
        'tour.assistant.suggestions',
        'tour.assistant.ask',
      ];
    case 'config':
      return [
        'tour.config.users',
        'tour.config.plc',
        'tour.config.registers',
        'tour.config.cells',
        'tour.config.labels',
        'tour.config.background',
        'tour.config.codes',
        'tour.config.alarms',
        'tour.config.safety',
      ];
    default:
      return [];
  }
}

/** Config section id for a tour tip (web query + Expo section picker). */
export function configSectionForTourTip(
  tipId: string,
):
  | 'users'
  | 'plc'
  | 'registers'
  | 'cells'
  | 'labels'
  | 'background'
  | 'codes'
  | 'alarms'
  | 'safety'
  | null {
  switch (tipId) {
    case 'tour.config.users':
      return 'users';
    case 'tour.config.plc':
      return 'plc';
    case 'tour.config.registers':
      return 'registers';
    case 'tour.config.cells':
      return 'cells';
    case 'tour.config.labels':
      return 'labels';
    case 'tour.config.background':
      return 'background';
    case 'tour.config.codes':
      return 'codes';
    case 'tour.config.alarms':
      return 'alarms';
    case 'tour.config.safety':
      return 'safety';
    default:
      return null;
  }
}
