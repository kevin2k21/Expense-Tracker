export const colors = {
  ink: '#15211B',
  muted: '#66736C',
  subtle: '#8A958F',
  canvas: '#F6F8F4',
  surface: '#FFFFFF',
  primary: '#123E31',
  action: '#176B4D',
  lime: '#BFE66A',
  limeSoft: '#EFF8DA',
  line: '#DDE6DF',
  lineSoft: '#EDF2EE',
  warning: '#B86A2D',
  warningSoft: '#FFF3E7',
  danger: '#B84C48',
  dangerSoft: '#FCECEA',
  blue: '#4E7DB8',
  purple: '#8068AE',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  pill: 999,
} as const;

export const typeScale = {
  display: 32,
  title: 24,
  heading: 20,
  body: 16,
  label: 14,
  caption: 12,
} as const;

export const shadows = {
  card: {
    shadowColor: '#123E31',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.055,
    shadowRadius: 14,
    elevation: 2,
  },
  navigation: {
    shadowColor: '#123E31',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 12,
  },
} as const;

export const motion = {
  fast: 140,
  standard: 220,
} as const;
