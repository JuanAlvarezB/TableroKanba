// Texts shown by the app. The ones the app already centralizes are reused, so a copy change breaks the
// suite only where the behavior changed.
export { BOARD_MESSAGES, LOGIN_MESSAGES } from '../../../src/shared/constants/messages.js';
export {
  COLUMN_NAMES,
  LABEL_MENU_NAMES,
  PRIORITIES,
  STATUS_LABELS,
} from '../../../src/presentation/format/labels.js';

export const BOARD_TEXTS = {
  dueSoon: '⏳ Vence en 2 días',
  overdue: '⛔ Venció hace 3 días',
  noPriority: 'Sin etiqueta',
} as const;
