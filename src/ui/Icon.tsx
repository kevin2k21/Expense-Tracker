import React from 'react';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

export type IconName =
  | 'home'
  | 'activity'
  | 'plan'
  | 'insights'
  | 'settings'
  | 'back'
  | 'chevron'
  | 'plus'
  | 'search'
  | 'note'
  | 'calendar'
  | 'alert';

export function Icon({ name, size = 22, color = '#123E31', strokeWidth = 1.9 }: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const common = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
    {name === 'home' && <><Path d="M3.5 10.5 12 3.5l8.5 7" {...common} /><Path d="M5.5 9.5V20h13V9.5M9.5 20v-6h5v6" {...common} /></>}
    {name === 'activity' && <><Line x1="5" y1="6" x2="19" y2="6" {...common} /><Line x1="5" y1="12" x2="19" y2="12" {...common} /><Line x1="5" y1="18" x2="14" y2="18" {...common} /><Circle cx="3" cy="6" r="0.6" fill={color} /><Circle cx="3" cy="12" r="0.6" fill={color} /><Circle cx="3" cy="18" r="0.6" fill={color} /></>}
    {name === 'plan' && <><Rect x="4" y="4" width="16" height="16" rx="4" {...common} /><Path d="M8 15.5v-3M12 15.5V8.5M16 15.5v-5" {...common} /></>}
    {name === 'insights' && <><Path d="M4 19V5" {...common} /><Path d="M4 19h16" {...common} /><Polyline points="7,15 11,11 14,13 19,7" {...common} /></>}
    {name === 'settings' && <><Circle cx="12" cy="12" r="3" {...common} /><Path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 14.7 6L14.4 3h-4.8l-.3 3a8 8 0 0 0-1.8 1.1l-2.4-1-2 3.4L5.1 11A7 7 0 0 0 5 12c0 .3 0 .7.1 1l-2 1.5 2 3.4 2.4-1A8 8 0 0 0 9.3 18l.3 3h4.8l.3-3a8 8 0 0 0 1.8-1.1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z" {...common} /></>}
    {name === 'back' && <><Line x1="19" y1="12" x2="5" y2="12" {...common} /><Polyline points="11,6 5,12 11,18" {...common} /></>}
    {name === 'chevron' && <Polyline points="9,6 15,12 9,18" {...common} />}
    {name === 'plus' && <><Line x1="12" y1="5" x2="12" y2="19" {...common} /><Line x1="5" y1="12" x2="19" y2="12" {...common} /></>}
    {name === 'search' && <><Circle cx="10.5" cy="10.5" r="6" {...common} /><Line x1="15" y1="15" x2="20" y2="20" {...common} /></>}
    {name === 'note' && <><Path d="M5 4h14v16H5z" {...common} /><Line x1="8" y1="9" x2="16" y2="9" {...common} /><Line x1="8" y1="13" x2="16" y2="13" {...common} /></>}
    {name === 'calendar' && <><Rect x="4" y="5" width="16" height="15" rx="3" {...common} /><Line x1="8" y1="3" x2="8" y2="7" {...common} /><Line x1="16" y1="3" x2="16" y2="7" {...common} /><Line x1="4" y1="10" x2="20" y2="10" {...common} /></>}
    {name === 'alert' && <><Path d="M12 4 21 20H3L12 4Z" {...common} /><Line x1="12" y1="9" x2="12" y2="14" {...common} /><Circle cx="12" cy="17" r="0.7" fill={color} /></>}
  </Svg>;
}
