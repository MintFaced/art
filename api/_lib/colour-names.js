/* A hex, said in words. The studio's board keeps colours as hexes; the wire
 * wants to call them what a person would ... ≈ LIGHT GREEN, not ≈ #90C48A. So a
 * proposed hex is matched to the nearest named colour, perceptually, in the same
 * OKLab the palette rules already use. The vocabulary is the CSS colour names,
 * because that is where "powder blue" and "orchid" come from in the first place.
 *
 * A match too far from every name gets none, and the caller falls back to the
 * hex: better an honest #90C48A than a confident wrong word.
 */
import { deltaE } from './palette.js';

// name → hex. Display names carry their spaces; the copy layer upper-cases them.
const NAMED = {
  'red': '#FF0000', 'crimson': '#DC143C', 'firebrick': '#B22222', 'indian red': '#CD5C5C',
  'tomato': '#FF6347', 'salmon': '#FA8072', 'light salmon': '#FFA07A', 'dark red': '#8B0000', 'maroon': '#800000',
  'orange': '#FFA500', 'dark orange': '#FF8C00', 'coral': '#FF7F50', 'chocolate': '#D2691E',
  'peru': '#CD853F', 'sandy brown': '#F4A460', 'orange red': '#FF4500',
  'gold': '#FFD700', 'goldenrod': '#DAA520', 'dark goldenrod': '#B8860B', 'khaki': '#F0E68C',
  'dark khaki': '#BDB76B', 'olive': '#808000', 'yellow': '#FFFF00',
  'green': '#008000', 'forest green': '#228B22', 'sea green': '#2E8B57', 'medium sea green': '#3CB371',
  'light green': '#90EE90', 'lime green': '#32CD32', 'olive drab': '#6B8E23', 'dark olive green': '#556B2F',
  'yellow green': '#9ACD32', 'dark green': '#006400', 'medium aquamarine': '#66CDAA',
  'teal': '#008080', 'dark cyan': '#008B8B', 'turquoise': '#40E0D0', 'medium turquoise': '#48D1CC',
  'cadet blue': '#5F9EA0', 'steel blue': '#4682B4', 'powder blue': '#B0E0E6', 'sky blue': '#87CEEB',
  'light blue': '#ADD8E6', 'cornflower blue': '#6495ED', 'royal blue': '#4169E1', 'dodger blue': '#1E90FF',
  'blue': '#0000FF', 'navy': '#000080', 'midnight blue': '#191970', 'dark blue': '#00008B', 'slate blue': '#6A5ACD',
  'indigo': '#4B0082', 'purple': '#800080', 'dark violet': '#9400D3', 'blue violet': '#8A2BE2',
  'medium purple': '#9370DB', 'orchid': '#DA70D6', 'medium orchid': '#BA55D3', 'dark orchid': '#9932CC',
  'plum': '#DDA0DD', 'violet': '#EE82EE', 'magenta': '#FF00FF', 'thistle': '#D8BFD8', 'lavender': '#E6E6FA',
  'pink': '#FFC0CB', 'hot pink': '#FF69B4', 'deep pink': '#FF1493', 'pale violet red': '#DB7093', 'rosy brown': '#BC8F8F',
  'brown': '#A52A2A', 'sienna': '#A0522D', 'saddle brown': '#8B4513', 'tan': '#D2B48C',
  'burlywood': '#DEB887', 'wheat': '#F5DEB3', 'beige': '#F5F5DC',
  'black': '#000000', 'white': '#FFFFFF', 'gray': '#808080', 'dim gray': '#696969', 'slate gray': '#708090',
  'light slate gray': '#778899', 'dark slate gray': '#2F4F4F', 'silver': '#C0C0C0', 'light gray': '#D3D3D3', 'gainsboro': '#DCDCDC',
};
const ENTRIES = Object.entries(NAMED);

/**
 * The nearest named colour to a hex, or null when nothing is close enough.
 * @param maxDistance OKLab distance (black→white is 1). ~0.14 keeps names honest.
 */
export function nameFor(hex, { maxDistance = 0.14 } = {}) {
  if (!hex) return null;
  const h = String(hex).startsWith('#') ? String(hex) : `#${hex}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) return null;
  let best = null;
  for (const [name, ref] of ENTRIES) {
    const d = deltaE(h.toUpperCase(), ref);
    if (!best || d < best.d) best = { name, d };
  }
  return best && best.d <= maxDistance ? best.name : null;
}
